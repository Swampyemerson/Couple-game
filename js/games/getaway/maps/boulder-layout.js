// Boulder for Getaway: deterministic layout of everything that stands on the ground — landmark
// buildings, frontage buildings by district, street trees, lamps, signals, bollards, rails, sound
// walls, rocks — as collision solids (contract) plus the decor list build() draws. No THREE.
// Computed once, lazily (the first read of BOULDER.solids or the first build()).
import {
  ROADS, OPEN, WATER, BOUNDS, X, Z, HOME, HOME_T, MALL, US36, NE, usPt, moorPt, footX, rawHeight, CREEK, FLAGSTAFF,
} from './boulder-data.js';

// ── PRNG (same algorithm the engine uses; fixed seeds, never Math.random) ───────────
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── road smoothing identical to the engine's geo.js (uniform Catmull-Rom, ~5 m) ─────
export function smooth(pts, closed, step = 5) {
  const n = pts.length;
  const Pp = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const xs = []; const zs = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = Pp(i - 1); const p1 = Pp(i); const p2 = Pp(i + 1); const p3 = Pp(i + 2);
    const Lg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(1, Math.ceil(Lg / step));
    for (let j = 0; j < k; j++) {
      const t = j / k; const t2 = t * t; const t3 = t2 * t;
      const c = (a, b, c2, d) => 0.5 * ((2 * b) + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
      xs.push(c(p0[0], p1[0], p2[0], p3[0])); zs.push(c(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  if (closed) { xs.push(xs[0]); zs.push(zs[0]); } else { xs.push(pts[n - 1][0]); zs.push(pts[n - 1][1]); }
  return { x: xs, z: zs };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]; const zi = poly[i][1]; const xj = poly[j][0]; const zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

// ── smoothed roads + a segment grid ───────────────────────────────────────────
let SM = null;
export function smoothedRoads() {
  if (SM) return SM;
  const list = ROADS.map((r, i) => {
    const s = smooth(r.pts, !!r.closed); const n = s.x.length;
    const cum = [0]; for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(s.x[k] - s.x[k - 1], s.z[k] - s.z[k - 1]));
    return { i, src: r, name: r.name, kind: r.kind, hw: r.width / 2, bridge: !!r.bridge, closed: !!r.closed, x: s.x, z: s.z, n, cum, len: cum[n - 1] };
  });
  const CELL = 24; const gx0 = BOUNDS.x0 - 60; const gz0 = BOUNDS.z0 - 60;
  const GW = Math.ceil((BOUNDS.x1 - BOUNDS.x0 + 120) / CELL); const GH = Math.ceil((BOUNDS.z1 - BOUNDS.z0 + 120) / CELL);
  const cells = new Map();
  for (const r of list) for (let k = 0; k < r.n - 1; k++) {
    const pad = r.hw + 2;
    const xa = Math.min(r.x[k], r.x[k + 1]) - pad; const xb = Math.max(r.x[k], r.x[k + 1]) + pad;
    const za = Math.min(r.z[k], r.z[k + 1]) - pad; const zb = Math.max(r.z[k], r.z[k + 1]) + pad;
    for (let cz = Math.floor((za - gz0) / CELL); cz <= Math.floor((zb - gz0) / CELL); cz++) for (let cx = Math.floor((xa - gx0) / CELL); cx <= Math.floor((xb - gx0) / CELL); cx++) {
      if (cx < 0 || cz < 0 || cx >= GW || cz >= GH) continue;
      const key = cz * GW + cx; let l = cells.get(key); if (!l) { l = []; cells.set(key, l); } l.push(r.i, k);
    }
  }
  /** Nearest road (optionally filtered): { r, k, t, d, px, pz, tx, tz, s }. */
  function nearest(x, z, maxD = 40, filter = null) {
    const out = { r: null, d: Infinity };
    const rc = Math.ceil(maxD / CELL); const cx0 = Math.floor((x - gx0) / CELL); const cz0 = Math.floor((z - gz0) / CELL);
    for (let cz = cz0 - rc; cz <= cz0 + rc; cz++) for (let cx = cx0 - rc; cx <= cx0 + rc; cx++) {
      if (cx < 0 || cz < 0 || cx >= GW || cz >= GH) continue;
      const l = cells.get(cz * GW + cx); if (!l) continue;
      for (let q = 0; q < l.length; q += 2) {
        const r = list[l[q]]; const k = l[q + 1]; if (filter && !filter(r)) continue;
        const ax = r.x[k]; const az = r.z[k]; const dx = r.x[k + 1] - ax; const dz = r.z[k + 1] - az; const L2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + dx * t; const pz = az + dz * t; const d = Math.hypot(x - px, z - pz);
        if (d < out.d) { const Lg = Math.sqrt(L2); Object.assign(out, { r, k, t, d, px, pz, tx: dx / Lg, tz: dz / Lg, s: r.cum[k] + Lg * t }); }
      }
    }
    return out;
  }
  /** Clearance from (x, z) to the nearest asphalt edge (negative = on a road). */
  function clearance(x, z, filter = null) {
    let best = Infinity;
    const cx0 = Math.floor((x - gx0) / CELL); const cz0 = Math.floor((z - gz0) / CELL);
    for (let cz = cz0 - 1; cz <= cz0 + 1; cz++) for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
      if (cx < 0 || cz < 0 || cx >= GW || cz >= GH) continue;
      const l = cells.get(cz * GW + cx); if (!l) continue;
      for (let q = 0; q < l.length; q += 2) {
        const r = list[l[q]]; const k = l[q + 1]; if (filter && !filter(r)) continue;
        const ax = r.x[k]; const az = r.z[k]; const dx = r.x[k + 1] - ax; const dz = r.z[k + 1] - az; const L2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - r.hw; if (d < best) best = d;
      }
    }
    return best;
  }
  SM = { list, nearest, clearance };
  return SM;
}

// ── terrain: raw relief with the roads levelled into it (8 m grid, bilinear) ─────────
const HC = 8;
const HX0 = BOUNDS.x0 - 40; const HZ0 = BOUNDS.z0 - 40;
const HW = Math.ceil((BOUNDS.x1 - BOUNDS.x0 + 80) / HC) + 1; const HH = Math.ceil((BOUNDS.z1 - BOUNDS.z0 + 80) / HC) + 1;
let HG = null;
function buildHeightGrid() { const it = heightGridGen(); while (!it.next().done); return HG; }
function* heightGridGen() {
  if (HG) return;
  const g = new Float32Array(HW * HH);
  for (let j = 0; j < HH; j++) { for (let i = 0; i < HW; i++) g[j * HW + i] = rawHeight(HX0 + i * HC, HZ0 + j * HC); if (j % 16 === 0) yield; }
  const { list } = smoothedRoads();
  // road profiles: raw height along the centreline, smoothed (±30 m) and grade-limited
  const best = new Float32Array(HW * HH).fill(1e9); const target = new Float32Array(HW * HH);
  const live = list.filter((r) => !r.bridge);
  const gmaxOf = (r) => (r.kind === 'highway' ? 0.05 : 0.072);
  const limit = (r, sm) => {
    const n = r.n; const gmax = gmaxOf(r);
    for (let k = 1; k < n; k++) { const ds = r.cum[k] - r.cum[k - 1]; sm[k] = Math.min(sm[k], sm[k - 1] + gmax * ds); }
    for (let k = n - 2; k >= 0; k--) { const ds = r.cum[k + 1] - r.cum[k]; sm[k] = Math.min(sm[k], sm[k + 1] + gmax * ds); }
  };
  for (const r of live) {
    const n = r.n; const h = new Float32Array(n);
    for (let k = 0; k < n; k++) h[k] = rawHeight(r.x[k], r.z[k]);
    const sm = new Float32Array(n);
    for (let k = 0; k < n; k++) { const W = r.closed ? 6 : Math.min(6, k, n - 1 - k); let a = 0; let w = 0; for (let q = k - W; q <= k + W; q++) { a += h[(q + n) % n]; w++; } sm[k] = a / w; }
    limit(r, sm); r.prof = sm;
    if (r.closed) { let m = 0; for (let k = 0; k < n; k++) m += sm[k]; sm.fill(m / n); } // loops are level plateaus
  }
  // a loop's plateau sits at the level of the road that climbs to it
  for (const r of live) {
    if (!r.closed) continue;
    for (const o of live) {
      if (o === r || o.closed) continue;
      for (const end of [0, o.n - 1]) {
        let bd = Infinity; for (let k = 0; k < r.n; k++) bd = Math.min(bd, Math.hypot(r.x[k] - o.x[end], r.z[k] - o.z[end]));
        if (bd < r.hw + o.hw) r.prof.fill(o.prof[end]);
      }
    }
  }
  yield;
  // where a road ends on another, bend its last ~60 m onto the other road's level (no steps)
  const profAt = (o, x, z) => { let bi = 0; let bd = Infinity; for (let k = 0; k < o.n; k++) { const d = (o.x[k] - x) ** 2 + (o.z[k] - z) ** 2; if (d < bd) { bd = d; bi = k; } } return [o.prof[bi], Math.sqrt(bd), !o.closed && (bi < 2 || bi > o.n - 3)]; };
  for (let pass = 0; pass < 2; pass++) for (const r of live) {
    if (r.closed) continue;
    for (const end of [0, r.n - 1]) {
      let tgt = null; let bestD = Infinity; let both = false;
      for (const o of live) { if (o === r) continue; const [hv, d, atEnd] = profAt(o, r.x[end], r.z[end]); if (d < o.hw + r.hw && d < bestD) { bestD = d; tgt = hv; both = atEnd; } }
      if (tgt == null) continue;
      const delta = (tgt - r.prof[end]) * (both ? 0.5 : 1); if (Math.abs(delta) < 0.05) continue;
      const span = Math.max(40, Math.abs(delta) / 0.045);
      for (let k = 0; k < r.n; k++) { const s2 = Math.abs(r.cum[k] - r.cum[end]); if (s2 < span) r.prof[k] += delta * (1 - s2 / span); }
    }
  }
  yield;
  for (const r of live) {
    const n = r.n; const sm = r.prof;
    const R = r.hw + 20;
    for (let k = 0; k < n; k++) {
      const x = r.x[k]; const z = r.z[k];
      const i0 = Math.max(0, Math.floor((x - R - HX0) / HC)); const i1 = Math.min(HW - 1, Math.ceil((x + R - HX0) / HC));
      const j0 = Math.max(0, Math.floor((z - R - HZ0) / HC)); const j1 = Math.min(HH - 1, Math.ceil((z + R - HZ0) / HC));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(HX0 + i * HC - x, HZ0 + j * HC - z) - r.hw; const q = j * HW + i;
        if (d < best[q]) { best[q] = d; target[q] = sm[k]; }
      }
    }
    yield;
  }
  for (let q = 0; q < g.length; q++) {
    if (best[q] > 1e8) continue;
    const w = best[q] <= 6 ? 1 : 1 - clamp01((best[q] - 6) / 14);
    const ww = w * w * (3 - 2 * w);
    g[q] = g[q] * (1 - ww) + target[q] * ww;
  }
  HG = g;
}
/** Terrain height (the contract's height(x, z)): bilinear on the levelled grid. */
export function height(x, z) {
  const g = HG || buildHeightGrid();
  let fx = (x - HX0) / HC; let fz = (z - HZ0) / HC;
  if (fx < 0) fx = 0; else if (fx > HW - 1.001) fx = HW - 1.001;
  if (fz < 0) fz = 0; else if (fz > HH - 1.001) fz = HH - 1.001;
  const i = fx | 0; const j = fz | 0; const u = fx - i; const v = fz - j; const q = j * HW + i;
  return (g[q] * (1 - u) + g[q + 1] * u) * (1 - v) + (g[q + HW] * (1 - u) + g[q + HW + 1] * u) * v;
}
export const HEIGHT_GRID = { HC, HX0, HZ0, HW, HH, get g() { return HG || buildHeightGrid(); } };

// ── districts ───────────────────────────────────────────────────────────────
/** Broadway's x at z (south of the creek it bends SE; north of it it is x = 0). */
const BWY_PTS = ROADS.filter((r) => r.name === 'Broadway').slice(-1)[0].pts;
export function broadwayX(z) {
  if (z <= BWY_PTS[0][1]) return 0;
  for (let i = 1; i < BWY_PTS.length; i++) if (z <= BWY_PTS[i][1]) { const [x0, z0] = BWY_PTS[i - 1]; const [x1, z1] = BWY_PTS[i]; return x0 + (x1 - x0) * (z - z0) / (z1 - z0); }
  return BWY_PTS[BWY_PTS.length - 1][0];
}
/** Signed distance NE of US-36's centreline (positive = north-east side). */
export const usV = (x, z) => (x - US36.x) * NE[0] + (z - US36.z) * NE[1];
export const usU = (x, z) => (x - US36.x) * US36.dx + (z - US36.z) * US36.dz;
export function zoneAt(x, z) {
  if (x < footX(z) - 4) return 'mtn';
  if (z > Z.baseline + 6) {
    if (x < 30 && z < 1150) return 'chautauqua';
    if (x < broadwayX(z) - 8) return x < 120 ? 'mesa' : 'southres';
    if (usV(x, z) < -14) return 'martin';
    if (usV(x, z) > 14) return x < 1180 && z < 1080 ? 'willvill' : 'eastres';
    return 'none';
  }
  if (x > 1520 && z < -265) return 'valmont';
  if (z > 205) {
    if (x < broadwayX(z) - 8) return z < 250 ? 'westres' : 'hill';
    if (x < 820) return 'campus';
    if (x < X.st30 + 70) return 'commercial';
    if (x < X.foothills - 10) return 'eastres';
    return 'east';
  }
  if (z > 125) return x < X.folsom ? 'civic' : x < X.st30 + 30 ? 'commercial' : 'east';
  if (z > -76) {
    if (x < X.st9 - 4) return 'westpearl';
    if (x < X.st21 + 30) return 'downtown';
    if (x < X.st28 - 10) return 'eastpearl';
    if (x < X.st30 + 8) return 'twentyninth';
    return x < 1450 ? 'junction' : 'east';
  }
  if (x < X.folsom - 6) return 'whittier';
  if (x < X.st28 - 90) return 'eastres';
  if (x < X.st30 + 60) return 'commercial';
  return z > -300 && x < 1450 ? 'junction' : 'east';
}
/** Mountain flank far from any road: drawn by the (fog-free) backdrop, not the town terrain. */
export function isFarMtn(x, z) { return x < footX(z) - 30 && smoothedRoads().clearance(x, z) > 42; }

// district frontage styles: type, width, depth, floors, setback, gap
const ZS = {
  downtown: { types: ['brick', 'brick', 'sandstone', 'brickB'], w: [8, 18], d: [17, 23], f: [2, 3.4], set: 0, gap: [0, 0.4], walk: 3.2 },
  westpearl: { types: ['brick', 'house', 'brickB'], w: [8, 14], d: [12, 17], f: [1, 2], set: 1.5, gap: [1, 4], walk: 2.6 },
  eastpearl: { types: ['brick', 'office', 'shop'], w: [14, 30], d: [16, 24], f: [2, 3], set: 3, gap: [3, 8], walk: 2.6 },
  twentyninth: { types: ['shop', 'shopB'], w: [18, 34], d: [15, 19], f: [1, 2], set: 1, gap: [3, 7], walk: 3.2 },
  junction: { types: ['apartment', 'office'], w: [28, 48], d: [16, 20], f: [3, 5], set: 5, gap: [8, 16], walk: 2.6 },
  whittier: { types: ['victorian'], w: [9, 12], d: [11, 14], f: [2, 2], set: 6, gap: [5, 9], walk: 2.2, trees: 'cottonwood' },
  westres: { types: ['victorian', 'house'], w: [9, 12], d: [11, 14], f: [2, 2], set: 6, gap: [5, 9], walk: 2.2, trees: 'cottonwood' },
  hill: { types: ['house', 'house', 'apartmentS', 'victorian'], w: [10, 16], d: [11, 15], f: [1, 3], set: 4.5, gap: [4, 8], walk: 2.2, trees: 'cottonwood' },
  campus: { types: ['cu'], w: [24, 48], d: [14, 22], f: [3, 4], set: 9, gap: [12, 24], walk: 2.6, trees: 'aspen' },
  commercial: { types: ['box', 'shop', 'office'], w: [26, 52], d: [20, 32], f: [1, 2], set: 16, gap: [12, 24], walk: 2.4 },
  east: { types: ['office', 'box', 'glass'], w: [30, 56], d: [20, 30], f: [2, 3], set: 16, gap: [16, 30], walk: 2.2 },
  martin: { types: ['ranch'], w: [11, 14], d: [8.5, 10], f: [1, 1], set: 6.5, gap: [5, 8], walk: 0, trees: 'cottonwood' },
  southres: { types: ['house', 'ranch'], w: [11, 15], d: [10, 13], f: [1, 2], set: 7, gap: [5, 9], walk: 1.8, trees: 'cottonwood' },
  eastres: { types: ['ranch', 'house', 'apartmentS'], w: [11, 16], d: [9, 13], f: [1, 2], set: 7, gap: [5, 9], walk: 1.8, trees: 'cottonwood' },
  willvill: { types: ['apartmentS'], w: [24, 36], d: [14, 18], f: [3, 4], set: 10, gap: [14, 22], walk: 2.2, trees: 'pine' },
  chautauqua: { types: ['cottage'], w: [6.5, 8.5], d: [8, 10], f: [1, 1], set: 4, gap: [5, 8], walk: 0, trees: 'pine' },
  mesa: { types: ['house'], w: [11, 15], d: [10, 13], f: [1, 2], set: 9, gap: [9, 16], walk: 0, trees: 'pine' },
};
export const SIDEWALK = (zone) => (ZS[zone] ? ZS[zone].walk : 0);

// ── occupancy raster (2 m) ───────────────────────────────────────────────────
const RC = 2; const RX0 = BOUNDS.x0; const RZ0 = BOUNDS.z0;
const RW = Math.ceil((BOUNDS.x1 - BOUNDS.x0) / RC); const RH = Math.ceil((BOUNDS.z1 - BOUNDS.z0) / RC);
const FREE = 0; const ROAD = 1; const WATERC = 2; const LOT = 3; const BLD = 4; const SMALL = 5;

let LAYOUT = null;
export function layout() {
  if (!LAYOUT) { const it = layoutGen(); while (!it.next().done); }
  return LAYOUT;
}
/** The layout as a generator: yields often so prepare() can slice it (see boulder.js). */
export function* layoutGen() {
  if (LAYOUT) return;
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  yield* heightGridGen();
  const sm = smoothedRoads();
  const ras = new Uint8Array(RW * RH);
  const rIdx = (x, z) => { const i = Math.floor((x - RX0) / RC); const j = Math.floor((z - RZ0) / RC); return i < 0 || j < 0 || i >= RW || j >= RH ? -1 : j * RW + i; };
  const disk = (x, z, r, v) => {
    const i0 = Math.max(0, Math.floor((x - r - RX0) / RC)); const i1 = Math.min(RW - 1, Math.floor((x + r - RX0) / RC));
    const j0 = Math.max(0, Math.floor((z - r - RZ0) / RC)); const j1 = Math.min(RH - 1, Math.floor((z + r - RZ0) / RC));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) { const cz = RZ0 + (j + 0.5) * RC - z; for (let i = i0; i <= i1; i++) { const cx = RX0 + (i + 0.5) * RC - x; if (cx * cx + cz * cz <= r2) { const q = j * RW + i; if (ras[q] < v || v === ROAD) ras[q] = Math.max(ras[q] === BLD ? BLD : 0, v); } } }
  };
  // roads + sidewalks (bridge decks too: nothing should stand on or under them)
  const walkOf = (r) => (r.kind === 'highway' ? 3 : r.kind === 'ramp' ? 2 : r.kind === 'alley' ? 0.8 : 3.4);
  for (const r of sm.list) {
    const rad = r.hw + walkOf(r);
    for (let k = 0; k < r.n - 1; k++) {
      const L = Math.hypot(r.x[k + 1] - r.x[k], r.z[k + 1] - r.z[k]); const m = Math.max(1, Math.ceil(L / 1.5));
      for (let q = 0; q < m; q++) disk(r.x[k] + (r.x[k + 1] - r.x[k]) * q / m, r.z[k] + (r.z[k + 1] - r.z[k]) * q / m, rad, ROAD);
    }
    yield;
  }
  const fillPoly = (poly, v) => {
    let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let z = z0 - 2; z <= z1 + 2; z += RC) for (let x = x0 - 2; x <= x1 + 2; x += RC) {
      if (pointInPoly(poly, x, z)) { const q = rIdx(x, z); if (q >= 0 && ras[q] < v) ras[q] = v; }
    }
  };
  for (const w of WATER) fillPoly(w.poly, WATERC);
  // creek corridor (banks + cottonwoods, keep buildings back)
  for (let k = 0; k < CREEK.length - 1; k++) {
    const [ax, az] = CREEK[k]; const [bx, bz] = CREEK[k + 1]; const L = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s < L; s += 2) disk(ax + (bx - ax) * s / L, az + (bz - az) * s / L, 6.5, WATERC);
  }
  for (const o of OPEN) fillPoly(o.poly, LOT);

  const solids = []; const buildings = []; const decor = []; const props = []; const lots = [];
  const rnd = mulberry(0xB0B1DE5);
  const R = (a, b) => a + (b - a) * rnd();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

  /** OBB cells: test (returns true when every cell is free) and stamp. */
  function obbCells(x, z, w, d, rot, pad, fn) {
    const c = Math.cos(rot); const s = Math.sin(rot);
    const hw = w / 2 + pad; const hd = d / 2 + pad; const rr = Math.hypot(hw, hd);
    const i0 = Math.max(0, Math.floor((x - rr - RX0) / RC)); const i1 = Math.min(RW - 1, Math.floor((x + rr - RX0) / RC));
    const j0 = Math.max(0, Math.floor((z - rr - RZ0) / RC)); const j1 = Math.min(RH - 1, Math.floor((z + rr - RZ0) / RC));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const ax = RX0 + (i + 0.5) * RC - x; const az = RZ0 + (j + 0.5) * RC - z;
      const lx = ax * c - az * s; const lz = ax * s + az * c;
      if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) { if (fn(j * RW + i) === false) return false; }
    }
    return true;
  }
  const inBounds = (x, z, m = 6) => x > BOUNDS.x0 + m && x < BOUNDS.x1 - m && z > BOUNDS.z0 + m && z < BOUNDS.z1 - m;
  const isFree = (x, z, w, d, rot, pad, allowLot = false) => inBounds(x, z, Math.max(w, d) / 2 + 2) && obbCells(x, z, w, d, rot, pad, (q) => !(ras[q] === FREE || (allowLot && ras[q] === LOT)) ? false : undefined);
  const stamp = (x, z, w, d, rot, pad, v = BLD) => obbCells(x, z, w, d, rot, pad, (q) => { if (ras[q] < v) ras[q] = v; });
  const solid = (o) => { solids.push(o); return o; };
  /** A building: collision + decor record. `forced` skips the free test (hand-placed). */
  function building(b, forced = false, allowLot = false) {
    const pad = b.pad == null ? 0.6 : b.pad;
    if (!forced && !isFree(b.x, b.z, b.w, b.d, b.rot, pad, allowLot)) return null;
    stamp(b.x, b.z, b.w, b.d, b.rot, pad);
    b.y = b.y == null ? groundUnder(b.x, b.z, b.w, b.d, b.rot) : b.y;
    buildings.push(b);
    if (!b.noSolid) solid({ kind: 'building', x: r2(b.x), z: r2(b.z), w: r2(b.w), d: r2(b.d), rot: r4(b.rot), h: r2(b.h + (b.roofH || 0)), y: r2(b.y), drawn: true });
    return b;
  }
  const r2 = (v) => Math.round(v * 100) / 100; const r4 = (v) => Math.round(v * 10000) / 10000;
  function groundUnder(x, z, w, d, rot) {
    const c = Math.cos(rot); const s = Math.sin(rot); let lo = Infinity;
    for (const [a, b] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) lo = Math.min(lo, height(x + a * c + b * s, z - a * s + b * c));
    return lo;
  }
  /** rot that turns local +x to (ax, az)-perpendicular: local +z → (ax, az). */
  const rotFacing = (ax, az) => Math.atan2(ax, az);
  const tree = (x, z, style, h, color, force = false) => {
    if (!inBounds(x, z, 3)) return null;
    const q = rIdx(x, z); if (q < 0 || (ras[q] !== FREE && !(force && ras[q] === LOT))) return null;
    disk(x, z, 2.2, SMALL);
    return solid({ kind: 'tree', x: r2(x), z: r2(z), w: 0.9, d: 0.9, rot: 0, h: r2(h), y: r2(height(x, z)), style, ...(color ? { color } : {}) });
  };
  const decorTree = (x, z, type, s) => { const q = rIdx(x, z); if (q < 0 || ras[q] !== FREE) return false; disk(x, z, 1.6, SMALL); decor.push({ type, x: r2(x), z: r2(z), y: r2(height(x, z)), s: r2(s), c: rnd(), far: isFarMtn(x, z) }); return true; };

  // ── 1. landmarks (hand-placed, real positions) ──────────────────────────────
  const B = (o) => building({ rot: 0, pad: 0.4, ...o }, true);
  // downtown: the Courthouse (WPA Moderne, cream stone, tower block) on its plaza north of Pearl
  B({ x: 65, z: -43, w: 31, d: 22, h: 13, style: 'courthouse', color: '#efe3c8', roof: 'flat', roofColor: '#cfc3a6', landmark: 'Courthouse' });
  B({ x: 65, z: -45, w: 11, d: 11, h: 21, style: 'courthouseTower', color: '#f3e8cf', roof: 'flat', roofColor: '#cfc3a6', noSolid: true });
  B({ x: 64, z: -79, w: 28, d: 22, h: 18, style: 'hotel', color: '#b5523b', roof: 'flat', roofColor: '#6e3a2c', floors: 5 }); // the historic hotel at 13th & Spruce
  B({ x: 105, z: -42, w: 22, d: 20, h: 11, style: 'theater', color: '#d9c8a0', roof: 'flat', roofColor: '#8e8467', rot: -Math.PI / 2 }); // the art-deco theatre, facing 14th
  // Central Park / civic area: bandshell, teahouse, library, municipal building
  B({ x: 22, z: 146, w: 14, d: 7, h: 6, style: 'bandshell', color: '#e9e4d8', roof: 'none', rot: Math.PI }); // faces north into the park
  B({ x: 64, z: 140, w: 17, d: 13, h: 5.5, style: 'teahouse', color: '#c96a3a', roof: 'pagoda', roofColor: '#2f6f6a', roofH: 3 });
  B({ x: -42, z: 140, w: 38, d: 17, h: 9, style: 'glass', color: '#d8d3c5', roof: 'flat', roofColor: '#b0aa98', floors: 2 }); // main library (north wing)
  B({ x: -96, z: 139, w: 30, d: 14, h: 9, style: 'brick', color: '#c98b5e', roof: 'flat', roofColor: '#8a6a4e', floors: 2 }); // municipal building
  // Boulder High (brick, crenellated), its field south of it
  B({ x: 262, z: 236, w: 66, d: 26, h: 14, style: 'school', color: '#a5523a', roof: 'flat', roofColor: '#6a3c2c', floors: 3, landmark: 'Boulder High' });
  B({ x: 262, z: 234, w: 12, d: 12, h: 20, style: 'school', color: '#a5523a', roof: 'flat', roofColor: '#6a3c2c', noSolid: true });
  // CU: Norlin Library facing west over the quad; Old Main; Macky; UMC; Engineering; events centre
  B({ x: 352, z: 496, w: 24, d: 48, h: 15, style: 'cu', color: '#d8a07c', roof: 'hip', roofColor: '#b5482f', roofH: 5, floors: 4, landmark: 'Norlin Library', portico: true, rot: 0 });
  B({ x: 238, z: 470, w: 34, d: 15, h: 13, style: 'oldmain', color: '#a7553f', roof: 'hip', roofColor: '#7a3b2b', roofH: 4, floors: 3 });
  B({ x: 247, z: 470, w: 6, d: 6, h: 25, style: 'oldmain', color: '#a7553f', roof: 'spire', roofColor: '#7a3b2b', roofH: 6, noSolid: true });
  B({ x: 185, z: 412, w: 36, d: 22, h: 15, style: 'cu', color: '#d49d78', roof: 'gable', roofColor: '#b5482f', roofH: 6, floors: 3 }); // Macky
  B({ x: 228, z: 556, w: 40, d: 22, h: 12, style: 'cu', color: '#dcae86', roof: 'hip', roofColor: '#b5482f', roofH: 4, floors: 3 }); // UMC
  B({ x: 300, z: 548, w: 28, d: 18, h: 13, style: 'cu', color: '#d39c79', roof: 'hip', roofColor: '#b5482f', roofH: 4, floors: 3 });
  B({ x: 690, z: 300, w: 70, d: 30, h: 16, style: 'cu', color: '#d6a07c', roof: 'hip', roofColor: '#b5482f', roofH: 5, floors: 4 }); // engineering centre
  B({ x: 730, z: 700, w: 60, d: 60, h: 16, style: 'arena', color: '#cfa07e', roof: 'dome', roofColor: '#c9c3b3', roofH: 6 }); // the events centre
  // Folsom Field: horseshoe bowl open to the north; the field inside is drivable
  {
    const cx = 470; const cz = 470; const W = 116; const D = 144; const t = 14; const h = 14;
    B({ x: cx - W / 2 + t / 2, z: cz + 6, w: t, d: D - 12, h, style: 'stands', color: '#c8b9a2', roof: 'none', side: 'west', landmark: 'Folsom Field' });
    B({ x: cx + W / 2 - t / 2, z: cz + 6, w: t, d: D - 12, h, style: 'stands', color: '#c8b9a2', roof: 'none', side: 'east' });
    B({ x: cx, z: cz + D / 2 - t / 2, w: W - 2 * t, d: t, h: h - 2, style: 'stands', color: '#c8b9a2', roof: 'none', side: 'south' });
    B({ x: cx - W / 2 - 4, z: cz + 6, w: 8, d: 60, h: 24, style: 'pressbox', color: '#d3c5ae', roof: 'flat', roofColor: '#7a7368' });
    stamp(cx, cz + 6, W - 2 * t, D - 14, 0, 0, LOT); // the turf: keep fill out
    props.push({ type: 'field', x: cx, z: cz + 2, w: W - 2 * t - 2, d: D - 2 * t + 10 });
  }
  // Chautauqua: the auditorium (big brown barn), dining hall, ranger cottage
  B({ x: -18, z: 1042, w: 38, d: 44, h: 11, style: 'auditorium', color: '#7a4a2e', roof: 'hip', roofColor: '#4d6b3c', roofH: 7, landmark: 'Chautauqua Auditorium' });
  B({ x: -128, z: 1038, w: 32, d: 13, h: 6, style: 'cottage', color: '#6f5236', roof: 'gable', roofColor: '#3e5a35', roofH: 3.5, porch: true });
  // Twenty Ninth Street anchors, Williams Village towers, Boulder Junction, Table Mesa shops
  B({ x: 905, z: 120 - 22, w: 60, d: 26, h: 9, style: 'shop', color: '#d7c4a4', roof: 'flat', roofColor: '#8f8778', floors: 2, noAuto: true, pad: 0 });
  B({ x: 1095, z: 965, w: 22, d: 22, h: 40, style: 'tower', color: '#d9cdb7', roof: 'flat', roofColor: '#8c8576', floors: 12 });
  B({ x: 1145, z: 1012, w: 22, d: 22, h: 40, style: 'tower', color: '#d9cdb7', roof: 'flat', roofColor: '#8c8576', floors: 12 });
  B({ x: 982, z: 1771, w: 86, d: 18, h: 9, style: 'box', color: '#cbb48d', roof: 'flat', roofColor: '#8f8778' });
  // NCAR's Mesa Lab (pink sandstone towers) inside its loop on the mesa
  B({ x: 252, z: 1600, w: 40, d: 26, h: 14, style: 'ncar', color: '#c9876c', roof: 'flat', roofColor: '#9e6650', landmark: 'NCAR' });
  B({ x: 238, z: 1592, w: 10, d: 10, h: 21, style: 'ncar', color: '#c48068', roof: 'flat', roofColor: '#9e6650', noSolid: true });
  B({ x: 266, z: 1607, w: 10, d: 10, h: 21, style: 'ncar', color: '#c48068', roof: 'flat', roofColor: '#9e6650', noSolid: true });
  // ── 3865 Moorhead Ave: the home (ranch house on the NE side, garage, driveway, porch) ──
  {
    const rot = Math.atan2(-NE[0], -NE[1]) + Math.PI; // local +z points NE (away from Moorhead)
    const [hx, hz] = moorPt(HOME_T + 2.5, 19.5);
    B({ x: hx, z: hz, w: 15, d: 10, h: 3.3, rot, style: 'home', color: '#7fb3c9', roof: 'hip', roofColor: '#4b4f5a', roofH: 2.6, landmark: '3865 Moorhead', home: true });
    const [gx, gz] = moorPt(HOME_T - 9.5, 19.5);
    B({ x: gx, z: gz, w: 6.2, d: 7.5, h: 3.0, rot, style: 'garage', color: '#7fb3c9', roof: 'gable', roofColor: '#4b4f5a', roofH: 1.6, home: true });
    const [mx, mz] = moorPt(HOME_T - 14, 5.8);
    solid({ kind: 'pole', x: r2(mx), z: r2(mz), w: 0.4, d: 0.4, rot: 0, h: 1.3, style: 'mailbox', color: '#2f5f8a' });
    props.push({ type: 'homeDetail', x: hx, z: hz, rot });
    const [tx, tz] = moorPt(HOME_T + 6, 10.5); tree(tx, tz, 'cottonwood', 13, '#5c8f3e');
    const [bx, bz] = moorPt(HOME_T + 4, 31); decorTree(bx, bz, 'broad', 1.15);
  }

  yield;
  // ── 2. Pearl Street Mall: bollards at every entrance, planters, kiosks, performers ──────
  {
    const ends = [MALL.x0 + 1.2, -9.5, 9.5, MALL.x1 - 1.2];
    for (const x of ends) for (let z = -7.5; z <= 7.6; z += 3) solid({ kind: 'bollard', x, z, w: 0.45, d: 0.45, rot: 0, h: 1.0, style: 'bollard', color: '#3a3a3a' });
    const runs = [[MALL.x0 + 6, -14], [16, MALL.x1 - 6]];
    for (const [a, b] of runs) for (let x = a; x < b; x += 15) {
      for (const side of [-1, 1]) {
        const pz = side * 6.4; const w = 6 + rnd() * 2;
        solid({ kind: 'wall', x: r2(x + 3.5), z: pz, w: r2(w), d: 2.4, rot: 0, h: 0.6, drawn: true });
        props.push({ type: 'planter', x: x + 3.5, z: pz, w, d: 2.4 });
        tree(x + 3.5 + w / 2 + 1.6, side * 6.6, 'aspen', 7.5, '#7ea34a', true);
      }
      props.push({ type: rnd() < 0.5 ? 'bench' : 'kiosk', x: x + 11, z: (rnd() < 0.5 ? -1 : 1) * 4.2, rot: 0 });
    }
    // performers' props (cosmetic, knockable signs/bollards): the box act, a piano, the juggler
    props.push({ type: 'busker', act: 'box', x: 30, z: -2.2 }, { type: 'busker', act: 'piano', x: 74, z: 2.5 }, { type: 'busker', act: 'juggler', x: -26, z: 1.8 }, { type: 'busker', act: 'guitar', x: 110, z: -2.6 });
    solid({ kind: 'pole', x: 74, z: 2.5, w: 1.6, d: 0.8, rot: 0, h: 1.3, style: 'sign', color: '#2b2b2b' });
    // the play-area boulders (Lyons sandstone) at 13th
    for (const [x, z, s] of [[48, 4.5, 1.6], [51, 3.6, 1.1], [45.5, 3.8, 0.9]]) { solid({ kind: 'rock', x, z, w: s * 1.6, d: s * 1.3, rot: 0.4, h: s, drawn: true }); props.push({ type: 'boulder', x, z, s }); }
    stamp((MALL.x0 + MALL.x1) / 2, 0, MALL.x1 - MALL.x0, 20, 0, 0, LOT);
    // the Courthouse plaza lawn: honey locusts + lamps
    for (const [x, z] of [[40, -20], [52, -16], [78, -16], [90, -20]]) tree(x, z, 'cottonwood', 10, '#6b9a44', true);
  }

  // ── 3. frontage fill by district ─────────────────────────────────────────────
  const skip = (r) => r.kind === 'highway' || r.kind === 'ramp' || r.bridge || r.kind === 'alley';
  const frontRoads = sm.list.filter((r) => !skip(r));
  // the mall frontage behaves like a road of half width 10 with no sidewalk
  const mallLine = { x: [MALL.x0, MALL.x1], z: [0, 0], n: 2, cum: [0, MALL.x1 - MALL.x0], len: MALL.x1 - MALL.x0, hw: 10, kind: 'mall', name: 'Pearl St Mall' };
  const order = [mallLine, ...frontRoads.filter((r) => r.kind === 'arterial'), ...frontRoads.filter((r) => r.kind !== 'arterial')];
  const pt = (r, s) => {
    let k = 0; while (k < r.n - 2 && r.cum[k + 1] < s) k++;
    const L = r.cum[k + 1] - r.cum[k] || 1; const t = (s - r.cum[k]) / L;
    return { x: r.x[k] + (r.x[k + 1] - r.x[k]) * t, z: r.z[k] + (r.z[k + 1] - r.z[k]) * t, tx: (r.x[k + 1] - r.x[k]) / L, tz: (r.z[k + 1] - r.z[k]) / L };
  };
  const PALETTE = {
    brick: ['#b4573f', '#a44b37', '#c0684a', '#9b4a3a', '#b86b4f', '#c97b56'],
    brickB: ['#7f8c6a', '#c99a5b', '#8f5a45', '#d4b07a', '#6f7f8f'],
    sandstone: ['#d9a68c', '#cf9878', '#e0b493', '#c78a6d'],
    cu: ['#e8c0a4', '#e2b496', '#ecc9ae', '#deae92', '#e4b89c'],
    house: ['#e9d9b8', '#9fb7a0', '#c9b48a', '#e4c58f', '#b8c6d4', '#d7a98d', '#f0e6d2', '#a9b59a'],
    victorian: ['#d9805f', '#6f9a8d', '#e8c25e', '#8e7cb0', '#5f86a8', '#c95f62', '#e6dcc0', '#7aa36a'],
    ranch: ['#e6d3ae', '#b9c9b4', '#d8b892', '#c6d0d9', '#e9e1cf', '#c4a585', '#a7b7a2', '#dcc39a'],
    cottage: ['#6b5137', '#4f6b45', '#7a5a3a', '#5d4a3a', '#3f5a52'],
    shop: ['#d8c6a6', '#c9b18b', '#e2d3b5', '#bfae94'], shopB: ['#a8b6a0', '#d39f7b', '#c6c0b0'],
    box: ['#d1c2a5', '#c4b8a2', '#dccfb4', '#b9ad96'],
    office: ['#cfd3cf', '#c4c9cc', '#ddd3c0', '#b8bfc4'], glass: ['#9fb7c4', '#a9bcc0', '#8fa8b8'],
    apartment: ['#d7c3a3', '#c79c7c', '#b9c0b5', '#e0d2b8'], apartmentS: ['#d9c9ad', '#c7a58a', '#bec7b9', '#e3d6bd'],
  };
  const ROOF = {
    house: ['#5d5a5f', '#6e5547', '#4f5560', '#7a4d3f', '#5f6650'], victorian: ['#4a4650', '#5f4c45', '#3f4a52', '#6b4b45'],
    ranch: ['#57585f', '#6d5d52', '#4e5560', '#7a6a5a', '#505a52'], cottage: ['#3e5a35', '#5c3b2b', '#3a4a44'],
    cu: ['#b5482f', '#a8432d', '#bf5236'], apartmentS: ['#6b5a50', '#555b63'],
  };
  for (const r of order) {
    const zMid = pt(r, r.len / 2);
    void zMid;
    for (const side of [-1, 1]) {
      let s = 6 + rnd() * 6;
      while (s < r.len - 6) {
        const p = pt(r, s);
        const nx = -p.tz * side; const nz = p.tx * side; // away from the road on this side
        const zone = zoneAt(p.x + nx * (r.hw + 12), p.z + nz * (r.hw + 12));
        const Z0 = r.kind === 'mall' ? ZS.downtown : ZS[zone];
        if (!Z0) { s += 10; continue; }
        const type = pick(Z0.types);
        const w = R(Z0.w[0], Z0.w[1]); const d = R(Z0.d[0], Z0.d[1]);
        const floors = Math.round(R(Z0.f[0], Z0.f[1] + 0.49));
        const walk = r.kind === 'mall' ? 0 : Z0.walk;
        const off = r.hw + walk + Z0.set + d / 2 + 0.6;
        const cx = p.x + nx * off + p.tx * w / 2; const cz = p.z + nz * off + p.tz * w / 2;
        const rot = rotFacing(nx, nz);
        const isHouse = /house|victorian|ranch|cottage/.test(type);
        const fh = type === 'cottage' ? 3.2 : isHouse ? 3.0 : type === 'box' ? 7 : 3.7;
        const h = (type === 'box' ? 7.5 + rnd() * 2 : floors * fh + (isHouse ? 0.4 : 0.8));
        const roof = isHouse ? (type === 'ranch' ? (rnd() < 0.55 ? 'hip' : 'gable') : 'gable') : type === 'cu' ? (rnd() < 0.6 ? 'hip' : 'gable') : 'flat';
        const roofH = roof === 'flat' ? 0 : type === 'ranch' ? 1.6 + rnd() * 0.6 : type === 'cu' ? 4 + rnd() : type === 'cottage' ? 3.6 : 2.6 + rnd() * 1.6;
        const pal = PALETTE[type] || PALETTE.box;
        const b = building({ x: cx, z: cz, w, d, rot, h, floors, style: type, color: pick(pal), roof, roofH, roofColor: roof === 'flat' ? '#7d766b' : pick(ROOF[type] || ROOF.house), zone, seed: rnd(), porch: isHouse && rnd() < 0.45, chimney: isHouse && rnd() < 0.35 }, false, r.kind === 'mall');
        if (b) {
          s += w + R(Z0.gap[0], Z0.gap[1]);
          if ((zone === 'commercial' || zone === 'east') && Z0.set > 8) { // a parking lot out front
            const ld = Z0.set - 1.5; const lo = r.hw + walk + 0.8 + ld / 2;
            const lx = p.x + nx * lo + p.tx * w / 2; const lz = p.z + nz * lo + p.tz * w / 2; const lw = w + 4;
            const c2 = Math.cos(rot); const s2 = Math.sin(rot); const P2 = (a, bb) => [lx + a * c2 + bb * s2, lz - a * s2 + bb * c2];
            const poly = [P2(-lw / 2, -ld / 2), P2(lw / 2, -ld / 2), P2(lw / 2, ld / 2), P2(-lw / 2, ld / 2)].map(([u, v]) => [r2(u), r2(v)]);
            if (obbCells(lx, lz, lw, ld, rot, 0, (q) => (ras[q] === BLD || ras[q] === WATERC ? false : undefined))) { lots.push({ kind: 'lot', poly, paint: 'asphalt', rot }); stamp(lx, lz, lw, ld, rot, 0, LOT); }
          }
          // a front-yard street tree and a backyard tree for houses
          if (Z0.trees && rnd() < 0.62) {
            const tOff = r.hw + walk + 1.8; const tt = s - R(0, 4);
            const q2 = pt(r, Math.min(r.len - 1, tt));
            const tStyle = Z0.trees === 'cottonwood' ? pick(['cottonwood', 'cottonwood', 'aspen', 'pine']) : Z0.trees;
            tree(q2.x + nx * tOff, q2.z + nz * tOff, tStyle, tStyle === 'pine' ? R(9, 14) : R(9, 15), pick(['#5c8f3e', '#6b9a44', '#4f8a3c', '#7ea34a']));
          }
          if (isHouse && rnd() < 0.75) decorTree(cx + nx * (d / 2 + R(4, 9)) + p.tx * R(-3, 3), cz + nz * (d / 2 + R(4, 9)) + p.tz * R(-3, 3), zone === 'chautauqua' || zone === 'mesa' ? 'pine' : 'broad', R(0.8, 1.3));
        } else s += 4;
      }
    }
    yield;
  }

  // ── 3b. campus infill: sandstone halls between the campus roads; office parks out east ────
  for (const [zn, x0, x1, z0, z1, step, style] of [['campus', 200, 830, 205, 905, 36, 'cu'], ['east', 1260, 1900, -470, 905, 64, 'office']]) {
    for (let z = z0; z < z1; z += step) for (let x = x0; x < x1; x += step) {
      const cx = x + R(-6, 6); const cz = z + R(-6, 6); if (zoneAt(cx, cz) !== zn) continue;
      const w = zn === 'campus' ? R(22, 38) : R(30, 50); const d = zn === 'campus' ? R(13, 19) : R(20, 28); const rot = rnd() < 0.5 ? 0 : Math.PI / 2;
      const floors = zn === 'campus' ? (rnd() < 0.5 ? 3 : 4) : 2 + (rnd() < 0.4 ? 1 : 0);
      if (((x / step) | 0) % 4 === 0) yield;
      building({ x: cx, z: cz, w, d, rot, h: floors * 3.7 + 0.8, floors, style, color: pick(PALETTE[style]), roof: zn === 'campus' ? (rnd() < 0.6 ? 'hip' : 'gable') : 'flat', roofH: zn === 'campus' ? 4 + rnd() : 0, roofColor: zn === 'campus' ? pick(ROOF.cu) : '#7d766b', zone: zn, seed: rnd(), pad: zn === 'campus' ? 5 : 8 });
    }
  }

  // ── 4. street furniture: lamps on arterials/downtown, signals at big crossings ─────────
  const lampy = new Set(['downtown', 'eastpearl', 'twentyninth', 'junction', 'commercial', 'campus', 'civic', 'westpearl', 'east']);
  for (const r of sm.list) {
    yield;
    if (r.bridge || r.kind === 'alley') continue;
    const every = r.kind === 'highway' ? 70 : r.kind === 'arterial' ? 42 : 55;
    let flip = 1;
    for (let s = 14; s < r.len - 10; s += every) {
      const p = pt(r, s); flip = -flip;
      const zone = zoneAt(p.x, p.z);
      if (r.kind === 'street' && !lampy.has(zone)) continue;
      if (zone === 'mtn' && r.name !== 'Flagstaff Rd') continue;
      const off = r.hw + (r.kind === 'highway' ? 2.2 : 0.9);
      const x = p.x - p.tz * flip * off; const z = p.z + p.tx * flip * off;
      if (sm.clearance(x, z, (o) => o !== r) < 3.5) continue;
      const q = rIdx(x, z); if (q < 0 || ras[q] === BLD || ras[q] === SMALL || ras[q] === WATERC) continue;
      disk(x, z, 1.2, SMALL);
      solids.push({ kind: 'pole', x: r2(x), z: r2(z), w: 0.35, d: 0.35, rot: 0, h: r.kind === 'highway' ? 11 : 8, y: r2(height(x, z)), style: 'lamp', color: zone === 'downtown' || zone === 'westpearl' ? '#2e3b33' : '#6d7175' });
    }
  }
  // signals: where an arterial meets another road (one pair of poles per crossing)
  const seen = new Set();
  const crossOk = (a) => (o) => o !== a && !o.bridge && o.name !== a.name && o.kind !== 'alley' && o.kind !== 'highway' && o.kind !== 'ramp';
  for (const a of sm.list.filter((r) => r.kind === 'arterial' && !r.bridge)) {
    yield;
    for (let k = 0; k < a.n - 1; k++) {
      const ax = a.x[k]; const az = a.z[k]; const n1 = sm.nearest(ax, az, 4, crossOk(a));
      if (!n1.r || n1.d > 2.6) continue;
      const b = n1.r; if (b.kind !== 'arterial' && !/Broadway|28th|Baseline|Arapahoe|Canyon|Folsom|30th/.test(a.name)) continue;
      const key = `${Math.round(n1.px / 25)},${Math.round(n1.pz / 25)}`; if (seen.has(key)) continue; seen.add(key);
      const tx = a.x[k + 1] - ax; const tz = a.z[k + 1] - az; const tl = Math.hypot(tx, tz) || 1; const ux = tx / tl; const uz = tz / tl;
      for (const sg of [1, -1]) {
        const x = n1.px + ux * sg * (b.hw + 2) - uz * sg * (a.hw + 1.4); const z = n1.pz + uz * sg * (b.hw + 2) + ux * sg * (a.hw + 1.4);
        const q = rIdx(x, z); if (q < 0 || ras[q] === BLD || ras[q] === WATERC) continue;
        if (sm.clearance(x, z) < 0.6) continue;
        disk(x, z, 1, SMALL);
        solids.push({ kind: 'pole', x: r2(x), z: r2(z), w: 0.4, d: 0.4, rot: r4(Math.atan2(-uz * sg, -ux * sg)), h: 6.5, y: r2(height(x, z)), style: 'signal', color: '#3b3f3a' });
      }
    }
  }

  yield;
  // ── 5. barriers: US-36 median + sound walls, Flagstaff guard rails, mountain rocks ───────
  const segWall = (ax, az, bx, bz, kind, h, styleName, thick = 0.5) => {
    const L = Math.hypot(bx - ax, bz - az); const rot = Math.atan2(-(bz - az), bx - ax);
    const o = solid({ kind, x: r2((ax + bx) / 2), z: r2((az + bz) / 2), w: r2(L), d: thick, rot: r4(rot), h, y: r2(Math.min(height(ax, az), height(bx, bz))), drawn: true });
    props.push({ type: styleName, ax, az, bx, bz, h, ya: height(ax, az), yb: height(bx, bz), thick });
    return o;
  };
  // median barrier (gaps none; the turnpike is divided) and sound walls on the Martin Acres side
  for (let u = 40; u < 1250; u += 14) { if (u > 690 && u < 830) continue; const [ax, az] = usPt(u); const [bx, bz] = usPt(Math.min(u + 14, 1252)); segWall(ax, az, bx, bz, 'barrier', 0.9, 'jersey', 0.7); }
  for (let u = 60; u < 1050; u += 20) {
    const [ax, az] = usPt(u, -15); const [bx, bz] = usPt(u + 20, -15);
    if (sm.clearance((ax + bx) / 2, (az + bz) / 2, (o) => o.kind !== 'highway') < 1.5) continue;
    segWall(ax, az, bx, bz, 'wall', 3.6, 'soundwall', 0.5); stamp((ax + bx) / 2, (az + bz) / 2, 20, 2, Math.atan2(-(bz - az), bx - ax), 0.5);
  }
  for (let u = 60; u < 1250; u += 20) {
    if ((u > 680 && u < 820) || (u > 880 && u < 1110) || u > 1170) continue;
    const [ax, az] = usPt(u, 15); const [bx, bz] = usPt(u + 20, 15);
    if (sm.clearance((ax + bx) / 2, (az + bz) / 2, (o) => o.kind !== 'highway') < 1.5) continue;
    segWall(ax, az, bx, bz, 'wall', 3.2, 'soundwall', 0.5);
  }
  // Flagstaff Rd + summit loop: guard rails on both edges (gaps at the junctions)
  for (const r of sm.list.filter((o) => /Flagstaff/.test(o.name))) {
    for (const side of [-1, 1]) {
      let prev = null;
      for (let s = r.name === 'Flagstaff Rd' ? 30 : 0; s <= r.len; s += 7) {
        const p = pt(r, Math.min(s, r.len - 0.01)); const off = r.hw + 0.7;
        const x = p.x - p.tz * side * off; const z = p.z + p.tx * side * off;
        const clear = sm.clearance(x, z, (o) => o !== r);
        if (clear < 1 || (r.name !== 'Flagstaff Rd' && side === -1)) { prev = null; continue; }
        if (prev) segWall(prev[0], prev[1], x, z, 'barrier', 0.8, 'rail', 0.35);
        prev = [x, z];
      }
    }
  }
  // the foot of the mountains: a line of sandstone boulders (no driving up the Flatirons)
  for (let z = BOUNDS.z0 + 8; z < BOUNDS.z1 - 6; z += 9) {
    const x = footX(z) - 14 - rnd() * 6;
    if (Math.abs(z - 150) < 26) continue; // Boulder Canyon mouth stays open to the creek
    if (sm.clearance(x, z) < 8) continue;
    const s = R(3.5, 7);
    solid({ kind: 'rock', x: r2(x), z: r2(z), w: r2(s * 1.6), d: r2(s * 1.3), rot: r4(rnd() * 3), h: r2(s * 0.9), y: r2(height(x, z) - 0.5), drawn: true });
    props.push({ type: 'rock', x, z, s, rot: rnd() * 6, y: height(x, z) - 0.5 });
    stamp(x, z, s * 1.6, s * 1.3, 0, 1);
  }

  yield;
  // ── 6. trees: the creek's cottonwoods, parks, the quad, Chautauqua, the foothill forest ──
  for (let k = 0; k < CREEK.length - 1; k++) {
    const [ax, az] = CREEK[k]; const [bx, bz] = CREEK[k + 1]; const L = Math.hypot(bx - ax, bz - az);
    for (let s = rnd() * 10; s < L; s += 11 + rnd() * 9) {
      const side = rnd() < 0.5 ? -1 : 1; const off = 8 + rnd() * 7;
      const x = ax + (bx - ax) * s / L + (-(bz - az) / L) * side * off * (side < 0 ? 1.3 : 1); const z = az + (bz - az) * s / L + ((bx - ax) / L) * side * off;
      if (x < footX(z) - 30) { decorTree(x, z, 'pine', R(0.9, 1.3)); continue; }
      if (sm.clearance(x, z) < 1.2) continue;
      const q = rIdx(x, z); if (q < 0 || (ras[q] !== FREE && ras[q] !== WATERC)) continue;
      ras[q] = FREE; tree(x, z, 'cottonwood', R(13, 19), pick(['#6d9a3f', '#7aa64a', '#5f8f3a']));
    }
  }
  const scatter = (poly, n, style, hr, col) => {
    let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = 0; i < n * 3 && n > 0; i++) {
      const x = R(x0, x1); const z = R(z0, z1); if (!pointInPoly(poly, x, z)) continue;
      if (sm.clearance(x, z) < 2) continue;
      if (tree(x, z, style, R(hr[0], hr[1]), col ? pick(col) : null)) n--;
    }
  };
  const rect = (a, b, c, d) => [[a, b], [c, b], [c, d], [a, d]];
  scatter(rect(10, 128, 36, 154), 6, 'cottonwood', [11, 16]); // Central Park
  scatter(rect(222, 448, 330, 540), 14, 'cottonwood', [10, 15], ['#6b9a44', '#5c8f3e']); // Norlin Quad elms
  scatter(rect(230, 270, 300, 300), 4, 'aspen', [8, 11]); // Boulder High lawn
  scatter([[-185, 935], [-70, 935], [-70, 995], [-185, 995]], 8, 'pine', [10, 15]); // inside Kinnikinic loop
  scatter([[-200, 1000], [-30, 1060], [-90, 1180], [-260, 1100]], 10, 'pine', [10, 16]); // Chautauqua meadow edge
  scatter([[-460, 700], [-400, 700], [-400, 900], [-460, 900]], 10, 'pine', [10, 14]);
  scatter(rect(-660, 640, -600, 780), 8, 'pine', [10, 14]);
  scatter(rect(1580, -260, 1840, -150), 14, 'cottonwood', [10, 15]); // Valmont park edge
  yield;
  // foothill forest (decor only: behind the boulder line or between switchbacks)
  {
    let placed = 0;
    for (let i = 0; i < 9000 && placed < 1500; i++) {
      if (i % 600 === 0) yield;
      const z = R(BOUNDS.z0 + 4, BOUNDS.z1 - 4); const x = R(BOUNDS.x0 + 4, footX(z) + 10);
      if (x > footX(z) - 18 && rnd() < 0.7) continue;
      if (sm.clearance(x, z) < 4) continue;
      if (decorTree(x, z, rnd() < 0.85 ? 'pine' : 'broad', R(0.9, 1.6))) placed++;
    }
  }
  // fields and mesas: sparse pines on the Table Mesa/NCAR bump and the Chautauqua meadow
  for (let i = 0, n = 0; i < 900 && n < 160; i++) {
    const x = R(-120, 560); const z = R(1180, 1780);
    if (sm.clearance(x, z) < 3 || x < footX(z)) continue;
    if (tree(x, z, 'pine', R(8, 14))) n++;
  }
  // east-side shelterbelts and Martin Acres backyards are handled by the frontage pass

  const ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  LAYOUT = { solids, buildings, decor, props, lots, ms, ras, RC, RX0, RZ0, RW, RH };
}

export function pickSpawn(name, frac, gap = 80, dir = 1, nth = 0) {
  const sm = smoothedRoads();
  const r = sm.list.filter((o) => o.name === name && !o.bridge)[nth];
  if (!r) throw new Error('no road ' + name);
  const at = (s) => {
    let k = 0; while (k < r.n - 2 && r.cum[k + 1] < s) k++;
    const L = r.cum[k + 1] - r.cum[k] || 1; const t = (s - r.cum[k]) / L;
    const tx = (r.x[k + 1] - r.x[k]) / L * dir; const tz = (r.z[k + 1] - r.z[k]) / L * dir;
    // keep right: offset half a lane to the right of travel (right = (−tz, tx))
    const off = r.kind === 'highway' ? 6.5 : r.hw < 5 ? 0 : Math.min(2.6, r.hw * 0.4);
    return { x: Math.round((r.x[k] + (r.x[k + 1] - r.x[k]) * t - tz * off) * 10) / 10, z: Math.round((r.z[k] + (r.z[k + 1] - r.z[k]) * t + tx * off) * 10) / 10, yaw: Math.round(Math.atan2(tx, -tz) * 10000) / 10000 };
  };
  const s = r.len * frac;
  return { runner: at(s), cop: at(s - gap * dir) , road: name };
}
void FLAGSTAFF; void HOME; void X;
