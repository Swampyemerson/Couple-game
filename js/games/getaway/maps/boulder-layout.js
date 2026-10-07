// Boulder for Getaway: deterministic layout of everything that stands on the ground — landmark
// buildings, frontage buildings by district, street trees, lamps, signals, bollards, rails, sound
// walls, rocks — as collision solids (contract) plus the decor list build() draws. No THREE.
// Computed once, lazily (the first read of BOULDER.solids or the first build()).
import {
  ROADS, OPEN, WATER, BOUNDS, X, Z, HOME, HOME_T, MALL, US36, NE, usPt, moorPt, footX, rawHeight, CREEK, FLAGSTAFF, MOOR_T0, MOOR_T1,
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
/** A time-gated yield test for the layout generators: true once ~5 ms of work has run since the
 *  last resume (the first test after a yield restarts the clock, so waiting time doesn't count).
 *  prepare() then hands the browser back every few ms instead of at fixed, uneven steps. */
function yielder(ms = 5) {
  const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  let t = now(); let pend = false;
  return () => { const n = now(); if (pend) { pend = false; t = n; return false; } if (n - t > ms) { pend = true; return true; } return false; };
}
function buildHeightGrid() { const it = heightGridGen(); while (!it.next().done); return HG; }
function* heightGridGen() {
  if (HG) return;
  const g = new Float32Array(HW * HH); const yd = yielder();
  for (let j = 0; j < HH; j++) { for (let i = 0; i < HW; i++) g[j * HW + i] = rawHeight(HX0 + i * HC, HZ0 + j * HC); if (yd()) yield; }
  yield; const { list } = smoothedRoads(); yield;
  // road profiles: raw height along the centreline, smoothed (±30 m) and grade-limited
  const best = new Float32Array(HW * HH).fill(1e9); const target = new Float32Array(HW * HH);
  const live = list.filter((r) => !r.bridge);
  const gmaxOf = (r) => (r.kind === 'highway' ? 0.05 : 0.072);
  const limit = (r, sm) => {
    const n = r.n; const gmax = gmaxOf(r);
    for (let k = 1; k < n; k++) { const ds = r.cum[k] - r.cum[k - 1]; sm[k] = Math.min(sm[k], sm[k - 1] + gmax * ds); }
    for (let k = n - 2; k >= 0; k--) { const ds = r.cum[k + 1] - r.cum[k]; sm[k] = Math.min(sm[k], sm[k + 1] + gmax * ds); }
  };
  for (const r of live) { if (yd()) yield;
    const n = r.n; const h = new Float32Array(n);
    for (let k = 0; k < n; k++) h[k] = rawHeight(r.x[k], r.z[k]);
    const sm = new Float32Array(n);
    for (let k = 0; k < n; k++) { const W = r.closed ? 6 : Math.min(6, k, n - 1 - k); let a = 0; let w = 0; for (let q = k - W; q <= k + W; q++) { a += h[(q + n) % n]; w++; } sm[k] = a / w; }
    limit(r, sm); r.prof = sm;
    if (r.closed) { let m = 0; for (let k = 0; k < n; k++) m += sm[k]; sm.fill(m / n); } // loops are level plateaus
  }
  // a loop's plateau sits at the level of the road that climbs to it
  for (const r of live) { if (yd()) yield;
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
  for (let pass = 0; pass < 2; pass++) for (const r of live) { if (yd()) yield;
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
    const R = r.hw + 15;
    for (let k = 0; k < n; k++) {
      if ((k & 7) === 0 && yd()) yield;
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
  for (let q = 0; q < g.length; q++) { if ((q & 8191) === 0 && yd()) yield;
    if (best[q] > 1e8) continue;
    const w = best[q] <= 6 ? 1 : 1 - clamp01((best[q] - 6) / 9);
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
  mall: { types: ['brick', 'brick', 'sandstone', 'brickB', 'brick'], w: [7, 14], d: [12.5, 16], f: [2, 3.4], set: 0, gap: [0, 0.25], walk: 0 },
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

// ── sidewalks: the ENGINE draws them (roads[i].sidewalk, concrete behind its curb) and drives them
// as concrete; we pick each street's width from the districts along it (majority of samples taken
// just off both edges). Paths, mountain roads and loops get none. Mutates ROADS once, at load.
const WALK_BY_ZONE = { downtown: 3.0, westpearl: 2.6, eastpearl: 2.6, civic: 2.6, twentyninth: 2.6, campus: 2.4, commercial: 2.2, junction: 2.4, east: 2.0, whittier: 1.8, westres: 1.8, hill: 1.8, southres: 1.6, eastres: 1.6, willvill: 1.8, martin: 1.5, valmont: 1.6 };
for (const r of ROADS) {
  if (r.sidewalk != null) continue;
  if ((r.kind !== 'street' && r.kind !== 'arterial') || r.bridge || r.closed || /Flagstaff|Kinnikinic|NCAR/.test(r.name)) { r.sidewalk = 0; continue; }
  const cnt = new Map(); const pts = r.pts; const hw = r.width / 2 + 8;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]; const [bx, bz] = pts[i + 1]; const l = Math.hypot(bx - ax, bz - az) || 1;
    const mx = (ax + bx) / 2; const mz = (az + bz) / 2; const nx = -(bz - az) / l; const nz = (bx - ax) / l;
    for (const sd of [-1, 1]) { const zn = zoneAt(mx + nx * hw * sd, mz + nz * hw * sd); cnt.set(zn, (cnt.get(zn) || 0) + l); }
  }
  let best = 'none'; let bl = -1; for (const [zn, l] of cnt) if (l > bl) { bl = l; best = zn; }
  const w = WALK_BY_ZONE[best] || 0;
  r.sidewalk = r.kind === 'arterial' && best !== 'mtn' && best !== 'mesa' && best !== 'chautauqua' ? Math.max(2.0, w) : w;
}
const walkOfR = (r) => (r.src && r.src.sidewalk) || 0;

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
  const yd = yielder();
  const sm = smoothedRoads();
  yield;
  const ras = new Uint8Array(RW * RH);
  const rIdx = (x, z) => { const i = Math.floor((x - RX0) / RC); const j = Math.floor((z - RZ0) / RC); return i < 0 || j < 0 || i >= RW || j >= RH ? -1 : j * RW + i; };
  const disk = (x, z, r, v) => {
    const i0 = Math.max(0, Math.floor((x - r - RX0) / RC)); const i1 = Math.min(RW - 1, Math.floor((x + r - RX0) / RC));
    const j0 = Math.max(0, Math.floor((z - r - RZ0) / RC)); const j1 = Math.min(RH - 1, Math.floor((z + r - RZ0) / RC));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) { const cz = RZ0 + (j + 0.5) * RC - z; for (let i = i0; i <= i1; i++) { const cx = RX0 + (i + 0.5) * RC - x; if (cx * cx + cz * cz <= r2) { const q = j * RW + i; if (ras[q] < v || v === ROAD) ras[q] = Math.max(ras[q] === BLD ? BLD : 0, v); } } }
  };
  // roads + sidewalks (bridge decks too: nothing should stand on or under them)
  // (the 2 m raster + a 0.6 m pad can creep ~1 m closer than this: keep solids off sidewalks and asphalt)
  const walkOf = (r) => (r.kind === 'highway' ? 3 : r.kind === 'ramp' ? 2 : r.kind === 'alley' ? 1.8 : Math.max(1.8, 0.75 + walkOfR(r)));
  for (const r of sm.list) {
    const rad = r.hw + walkOf(r);
    for (let k = 0; k < r.n - 1; k++) {
      const L = Math.hypot(r.x[k + 1] - r.x[k], r.z[k + 1] - r.z[k]); const m = Math.max(1, Math.ceil(L / 3));
      for (let q = 0; q < m; q++) disk(r.x[k] + (r.x[k + 1] - r.x[k]) * q / m, r.z[k] + (r.z[k + 1] - r.z[k]) * q / m, rad, ROAD);
      if (yd()) yield;
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
  for (const w of WATER) { fillPoly(w.poly, WATERC); if (yd()) yield; }
  // creek corridor (banks + cottonwoods, keep buildings back)
  for (let k = 0; k < CREEK.length - 1; k++) {
    const [ax, az] = CREEK[k]; const [bx, bz] = CREEK[k + 1]; const L = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s < L; s += 2) disk(ax + (bx - ax) * s / L, az + (bz - az) * s / L, 6.5, WATERC);
    if (yd()) yield;
  }
  for (const o of OPEN) { fillPoly(o.poly, LOT); if (yd()) yield; }

  const solids = []; const buildings = []; const decor = []; const props = []; const lots = []; const parked = []; const stripes = [];
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

  const CAR_COL = ['#b8bcc0', '#2b2d31', '#f0efea', '#8e9196', '#7a1f24', '#24395e', '#3d5a45', '#c9c3b5', '#5c636b', '#a33a2e', '#2f6f8f', '#d9d4c8', '#4a4f57'];
  /** Is a w × d box (rot) at least m metres from every road's asphalt? (outline samples) */
  const clearOBB = (x, z, w, d, rot, m) => {
    const c = Math.cos(rot); const s2 = Math.sin(rot); const nu = Math.max(1, Math.ceil(w / 1.5)); const nv = Math.max(1, Math.ceil(d / 1.5));
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      if (i > 0 && i < nu && j > 0 && j < nv) continue;
      const lx = (i / nu - 0.5) * w; const lz = (j / nv - 0.5) * d;
      if (sm.clearance(x + lx * c + lz * s2, z - lx * s2 + lz * c) < m) return false;
    }
    return true;
  };
  /** Place several buildings only if all of them fit (tested before any is stamped). */
  const placeAll = (list, allowLot = false) => {
    for (const b of list) if (!isFree(b.x, b.z, b.w, b.d, b.rot, b.pad == null ? 0.6 : b.pad, allowLot)) return null;
    const out = []; for (const b of list) out.push(building(b, true)); return out;
  };
  /** A parked car: collision box (kind 'car', drawn by us) + the draw record. */
  const parkCar = (x, z, rot, shape, color, y) => {
    const w = shape === 'pickup' || shape === 'suv' ? 1.95 : 1.85; const d = shape === 'pickup' ? 5.2 : shape === 'suv' ? 4.7 : 4.5;
    const yy = y == null ? height(x, z) : y;
    solid({ kind: 'car', x: r2(x), z: r2(z), w, d, rot: r4(rot), h: shape === 'suv' || shape === 'pickup' ? 1.8 : 1.45, y: r2(yy), drawn: true });
    parked.push({ x, z, y: yy, rot, shape, color, w, d });
  };
  // ── 1. landmarks (hand-placed, real positions) ──────────────────────────────
  const B = (o) => building({ rot: 0, pad: 0.4, ...o }, true);
  // downtown: the Courthouse (WPA Moderne, cream stone, tower block) on its plaza north of Pearl
  B({ x: 65, z: -43, w: 31, d: 22, h: 13, style: 'courthouse', color: '#efe3c8', roof: 'flat', roofColor: '#cfc3a6', landmark: 'Courthouse' });
  B({ x: 65, z: -45, w: 11, d: 11, h: 21, style: 'courthouseTower', color: '#f3e8cf', roof: 'flat', roofColor: '#cfc3a6', noSolid: true });
  B({ x: 64, z: -79, w: 28, d: 22, h: 18, style: 'hotel', color: '#b5523b', roof: 'flat', roofColor: '#6e3a2c', floors: 5 }); // the historic hotel at 13th & Spruce
  B({ x: 105, z: -44, w: 18, d: 18, h: 11, style: 'theater', color: '#d9c8a0', roof: 'flat', roofColor: '#8e8467', rot: -Math.PI / 2 }); // the art-deco theatre, facing 14th
  if (yd()) yield;
  // Central Park / civic area: bandshell, teahouse, library, municipal building
  B({ x: 22, z: 146, w: 14, d: 11, h: 6, style: 'bandshell', color: '#e9e4d8', roof: 'none', rot: Math.PI }); // faces north into the park
  B({ x: 64, z: 140, w: 17, d: 13, h: 5.5, style: 'teahouse', color: '#c96a3a', roof: 'pagoda', roofColor: '#2f6f6a', roofH: 3 });
  B({ x: -42, z: 140, w: 38, d: 17, h: 9, style: 'glass', color: '#d8d3c5', roof: 'flat', roofColor: '#b0aa98', floors: 2 }); // main library (north wing)
  B({ x: -96, z: 139, w: 30, d: 14, h: 9, style: 'brick', color: '#c98b5e', roof: 'flat', roofColor: '#8a6a4e', floors: 2 }); // municipal building
  if (yd()) yield;
  // Boulder High (brick, crenellated), its field south of it
  B({ x: 262, z: 236, w: 66, d: 26, h: 14, style: 'school', color: '#a5523a', roof: 'flat', roofColor: '#6a3c2c', floors: 3, landmark: 'Boulder High' });
  B({ x: 262, z: 234, w: 12, d: 12, h: 20, style: 'school', color: '#a5523a', roof: 'flat', roofColor: '#6a3c2c', noSolid: true });
  if (yd()) yield;
  // CU: Norlin Library facing west over the quad; Old Main; Macky; UMC; Engineering; events centre
  B({ x: 352, z: 496, w: 24, d: 48, h: 15, style: 'cu', color: '#d8a07c', roof: 'hip', roofColor: '#b5482f', roofH: 5, floors: 4, landmark: 'Norlin Library', portico: true, rot: 0 });
  solid({ kind: 'wall', x: 338.4, z: 496, w: 3.2, d: 22, rot: 0, h: 13, y: r2(height(338, 496)), drawn: true }); // Norlin's west portico
  B({ x: 238, z: 470, w: 34, d: 15, h: 13, style: 'oldmain', color: '#a7553f', roof: 'hip', roofColor: '#7a3b2b', roofH: 4, floors: 3 });
  B({ x: 247, z: 470, w: 6, d: 6, h: 25, style: 'oldmain', color: '#a7553f', roof: 'spire', roofColor: '#7a3b2b', roofH: 6, noSolid: true });
  B({ x: 185, z: 412, w: 36, d: 22, h: 15, style: 'cu', color: '#d49d78', roof: 'gable', roofColor: '#b5482f', roofH: 6, floors: 3 }); // Macky
  B({ x: 228, z: 556, w: 40, d: 22, h: 12, style: 'cu', color: '#dcae86', roof: 'hip', roofColor: '#b5482f', roofH: 4, floors: 3 }); // UMC
  B({ x: 300, z: 548, w: 28, d: 18, h: 13, style: 'cu', color: '#d39c79', roof: 'hip', roofColor: '#b5482f', roofH: 4, floors: 3 });
  B({ x: 690, z: 300, w: 70, d: 30, h: 16, style: 'cu', color: '#d6a07c', roof: 'hip', roofColor: '#b5482f', roofH: 5, floors: 4 }); // engineering centre
  B({ x: 730, z: 700, w: 60, d: 60, h: 16, style: 'arena', color: '#cfa07e', roof: 'dome', roofColor: '#c9c3b3', roofH: 6 }); // the events centre
  // open spaces kept clear of buildings: the Norlin Quad lawn, Boulder High's field
  stamp(276, 494, 98, 84, 0, 0, LOT);
  stamp(262, 282, 78, 40, 0, 0, LOT);
  props.push({ type: 'field', x: 262, z: 283, w: 70, d: 34, plain: true });
  if (yd()) yield;
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
  if (yd()) yield;
  // Chautauqua: the auditorium (big brown barn), dining hall, ranger cottage
  B({ x: -18, z: 1042, w: 38, d: 44, h: 11, style: 'auditorium', color: '#7a4a2e', roof: 'hip', roofColor: '#4d6b3c', roofH: 7, landmark: 'Chautauqua Auditorium' });
  B({ x: -128, z: 1038, w: 32, d: 13, h: 6, style: 'cottage', color: '#6f5236', roof: 'gable', roofColor: '#3e5a35', roofH: 3.5, porch: true });
  if (yd()) yield;
  // Twenty Ninth Street anchors, Williams Village towers, Boulder Junction, Table Mesa shops
  B({ x: 1095, z: 965, w: 22, d: 22, h: 40, style: 'tower', color: '#d9cdb7', roof: 'flat', roofColor: '#8c8576', floors: 12 });
  B({ x: 1145, z: 1012, w: 22, d: 22, h: 40, style: 'tower', color: '#d9cdb7', roof: 'flat', roofColor: '#8c8576', floors: 12 });
  B({ x: 982, z: 1771, w: 86, d: 18, h: 9, style: 'box', color: '#cbb48d', roof: 'flat', roofColor: '#8f8778' });
  if (yd()) yield;
  // NCAR's Mesa Lab (pink sandstone towers) inside its loop on the mesa
  B({ x: 252, z: 1600, w: 40, d: 26, h: 14, style: 'ncar', color: '#c9876c', roof: 'flat', roofColor: '#9e6650', landmark: 'NCAR' });
  B({ x: 238, z: 1592, w: 10, d: 10, h: 21, style: 'ncar', color: '#c48068', roof: 'flat', roofColor: '#9e6650', noSolid: true });
  B({ x: 266, z: 1607, w: 10, d: 10, h: 21, style: 'ncar', color: '#c48068', roof: 'flat', roofColor: '#9e6650', noSolid: true });
  if (yd()) yield;
  // ── 3865 Moorhead Ave: the home (ranch house on the NE side, garage, driveway, porch) ──
  {
    const rot = Math.atan2(-NE[0], -NE[1]) + Math.PI; // local +z points NE (away from Moorhead)
    const [hx, hz] = moorPt(HOME_T + 2.5, 19.5);
    B({ x: hx, z: hz, w: 15, d: 10, h: 3.3, rot, style: 'home', color: '#7fb3c9', roof: 'hip', roofColor: '#4b4f5a', roofH: 2.6, landmark: '3865 Moorhead', home: true });
    const [gx, gz] = moorPt(HOME_T - 9.5, 19.5);
    B({ x: gx, z: gz, w: 6.2, d: 7.5, h: 3.0, rot, style: 'garage', color: '#7fb3c9', roof: 'gable', roofColor: '#4b4f5a', roofH: 1.6, home: true });
    const [mx, mz] = moorPt(HOME_T - 14, 7.0);
    solid({ kind: 'pole', x: r2(mx), z: r2(mz), w: 0.4, d: 0.4, rot: 0, h: 1.3, style: 'mailbox', color: '#2f5f8a' });
    props.push({ type: 'homeDetail', x: hx, z: hz, rot });
    { // the detail's colliders: porch, flower beds, side fence, the hoop by the drive
      const c = Math.cos(rot); const s2 = Math.sin(rot); const Wl = (lx, lz) => [hx + lx * c + lz * s2, hz - lx * s2 + lz * c]; const y = r2(height(hx, hz));
      for (const [lx, lz, w, d, h] of [[3.4, -6.0, 4.6, 2.1, 3.0], [-2.2, -5.7, 5.2, 1.1, 0.35], [6.6, -5.7, 4.2, 1.1, 0.35], [8.2, 0.2, 0.16, 9.9, 1.0], [-13.6, -3.4, 0.3, 0.3, 3.4]]) { const [x, z] = Wl(lx, lz); solid({ kind: 'wall', x: r2(x), z: r2(z), w, d, rot: r4(rot), h, y, drawn: true }); }
      const [kx, kz] = moorPt(HOME_T - 9.5, 11.2); parkCar(kx, kz, rot, 'wagon', '#3f6f8f'); // our car in the drive
    }
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
      { const kind = rnd() < 0.5 ? 'bench' : 'kiosk'; const kz = (rnd() < 0.5 ? -1 : 1) * 4.2; if (Math.abs(x + 11) > 14) props.push({ type: kind, x: x + 11, z: kz, rot: 0 });
        if (Math.abs(x + 11) > 14) solid(kind === 'kiosk' ? { kind: 'wall', x: x + 11, z: kz, w: 1.7, d: 1.7, rot: 0, h: 3.2, y: r2(height(x + 11, kz)), drawn: true } : { kind: 'wall', x: x + 11, z: kz, w: 2.2, d: 0.62, rot: 0, h: 0.85, y: r2(height(x + 11, kz)), drawn: true }); }
      { const lx = x + 7.5; const lz = (((x / 15) | 0) % 2 ? -1 : 1) * 8.7; solid({ kind: 'wall', x: lx, z: lz, w: 0.36, d: 0.36, rot: 0, h: 4.5, y: r2(height(lx, lz)), drawn: true }); props.push({ type: 'mallLamp', x: lx, z: lz }); }
    }
    // performers' props (cosmetic, knockable signs/bollards): the box act, a piano, the juggler
    props.push({ type: 'busker', act: 'box', x: 30, z: -2.2 }, { type: 'busker', act: 'piano', x: 74, z: 2.5 }, { type: 'busker', act: 'juggler', x: -26, z: 1.8 }, { type: 'busker', act: 'guitar', x: 110, z: -2.6 });
    solid({ kind: 'pole', x: 74, z: 2.5, w: 1.6, d: 0.8, rot: 0, h: 1.3, style: 'sign', color: '#2b2b2b' });
    // the play-area boulders (Lyons sandstone) at 13th
    for (const [x, z, s] of [[48, 4.5, 1.6], [51, 3.6, 1.1], [45.5, 3.8, 0.9]]) { solid({ kind: 'rock', x, z, w: s * 1.6, d: s * 1.3, rot: 0.4, h: s, drawn: true }); props.push({ type: 'rock', x, z, s, w: s * 1.6, d: s * 1.3, h: s * 0.75, rot: 0.4, y: height(x, z), sand: true }); }
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
    brick: ['#a65a43', '#9b5240', '#b06a4f', '#8f4c3c', '#a8664c', '#b77656', '#94584a'],
    brickB: ['#7f8a6c', '#bf9a66', '#8a5c4a', '#cdb184', '#6f7d88', '#9a8f7a'],
    sandstone: ['#cfa488', '#c79a7c', '#d6b094', '#bf9174'],
    cu: ['#d8b996', '#d1b08e', '#dcc0a0', '#cdaa88', '#d6b292', '#e0c6a6'], // Lyons sandstone (buff-pink) over limestone trim
    house: ['#e6d8bb', '#a3b5a0', '#c6b38e', '#ddc394', '#b4c2cf', '#d2aa90', '#ece4d2', '#a8b39a', '#c9c0b0', '#8fa3ad'],
    victorian: ['#c97f63', '#6f9a8d', '#dcc070', '#8e7cb0', '#5f86a8', '#b9666a', '#e2d9c0', '#7aa36a'],
    ranch: ['#e2d1ae', '#b5c4b0', '#d4b893', '#c2ccd4', '#e6dfcf', '#c0a387', '#a5b4a0', '#d8c19c', '#b9a99a', '#9fb2bf', '#d9cfc0', '#c9b79f'],
    cottage: ['#6b5137', '#4f6b45', '#7a5a3a', '#5d4a3a', '#3f5a52'],
    shop: ['#d2c3a6', '#c4ae8c', '#ddd0b5', '#bba995', '#b8bdb7'], shopB: ['#a6b39f', '#cc9f80', '#c2bdaf', '#9fa9b3'],
    box: ['#cdbfa4', '#c1b6a2', '#d8cdb5', '#b6ab97'],
    office: ['#cbd0cc', '#c1c6c9', '#d8cfbf', '#b6bdc1'], glass: ['#9fb4c0', '#a6b8bc', '#8fa6b5'],
    apartment: ['#d2c0a3', '#c29c7f', '#b6bdb2', '#dbcfb7', '#b98d6f'], apartmentS: ['#d6c7ad', '#c3a68c', '#bbc4b7', '#ded2bb'],
  };
  const ROOF = {
    house: ['#5d5a5f', '#6e5547', '#4f5560', '#7a4d3f', '#5f6650', '#47494f'], victorian: ['#4a4650', '#5f4c45', '#3f4a52', '#6b4b45'],
    ranch: ['#57585f', '#6d5d52', '#4e5560', '#7a6a5a', '#505a52', '#3f4247', '#6a6e72'], cottage: ['#3e5a35', '#5c3b2b', '#3a4a44'],
    cu: ['#b4553a', '#a94e35', '#bb5e40', '#b05035'], apartmentS: ['#6b5a50', '#555b63'],
  };
  const CU_TYPES = new Set(['cu']);
  for (const r of order) {
    for (const side of [-1, 1]) {
      let s = 6 + rnd() * 6;
      while (s < r.len - 6) {
        if (yd()) yield;
        const p = pt(r, s);
        const nx = -p.tz * side; const nz = p.tx * side; // away from the road on this side
        const zone = zoneAt(p.x + nx * (r.hw + 12), p.z + nz * (r.hw + 12));
        const Z0 = r.kind === 'mall' ? ZS.mall : ZS[zone];
        if (!Z0) { s += 10; continue; }
        const type = pick(Z0.types);
        const w = R(Z0.w[0], Z0.w[1]); let d = R(Z0.d[0], Z0.d[1]);
        const floors = Math.round(R(Z0.f[0], Z0.f[1] + 0.49));
        const walk = r.kind === 'mall' ? 0 : 0.35 + walkOfR(r);
        const rot = rotFacing(nx, nz);
        const isHouse = /house|victorian|ranch|cottage/.test(type);
        const fh = type === 'cottage' ? 3.2 : isHouse ? 3.0 : type === 'box' ? 7 : 3.7;
        const h = (type === 'box' ? 7.5 + rnd() * 2 : floors * fh + (isHouse ? 0.4 : 0.8));
        const roof = isHouse ? (type === 'ranch' ? (rnd() < 0.55 ? 'hip' : 'gable') : 'gable') : CU_TYPES.has(type) ? (rnd() < 0.6 ? 'hip' : 'gable') : 'flat';
        const roofH = roof === 'flat' ? 0 : type === 'ranch' ? 1.6 + rnd() * 0.6 : type === 'cu' ? 4 + rnd() : type === 'cottage' ? 3.6 : 2.6 + rnd() * 1.6;
        const pal = PALETTE[type] || PALETTE.box;
        const color = pick(pal); const roofColor = roof === 'flat' ? pick(['#7d766b', '#8a8379', '#6f6a62']) : pick(ROOF[type] || ROOF.house);
        const seed = rnd(); const porch = isHouse && rnd() < 0.3 && Z0.set >= 3; const chimney = isHouse && rnd() < 0.35;
        // Martin Acres / south + east Boulder: an attached garage with a driveway (and often a car)
        const garage = (type === 'ranch' && rnd() < 0.72) || (type === 'house' && /southres|eastres|hill/.test(zone) && rnd() < 0.45);
        const gw = 6.4; const gFirst = rnd() < 0.5;
        const front = r.hw + walk + Z0.set + 0.6; // the house front's distance from the centre line
        const at = (along, off) => [p.x + nx * off + p.tx * along, p.z + nz * off + p.tz * along];
        const list = [];
        const aH = garage && gFirst ? gw + w / 2 : w / 2;
        let [cx, cz] = at(aH, front + d / 2);
        list.push({ x: cx, z: cz, w, d, rot, h, floors, style: type, color, roof, roofH, roofColor, zone, seed, porch, chimney });
        let gd = 0; let aG = 0;
        if (garage) {
          gd = Math.min(d, 7.2); aG = gFirst ? gw / 2 : w + gw / 2;
          const [gx, gz] = at(aG, front + 0.7 + gd / 2);
          list.push({ x: gx, z: gz, w: gw, d: gd, rot, h: 2.9, style: 'garage', color, roof: type === 'ranch' && roof === 'hip' ? 'hip' : 'gable', roofH: 1.3, roofColor, zone, seed: rnd(), attached: true, pad: 0.4 });
        }
        if (r.kind === 'mall') { // the mall: a continuous wall of shopfronts; shallower lots where the alley is close
          let got = placeAll(list, true);
          for (let k = 0; !got && k < 3; k++) { d = 14 - k * 1.6; [cx, cz] = at(aH, front + d / 2); Object.assign(list[0], { x: cx, z: cz, d }); got = placeAll(list, true); }
          if (got) s += w + R(Z0.gap[0], Z0.gap[1]); else s += 3;
          continue;
        }
        const got = placeAll(list, false);
        if (!got) { s += 4; continue; }
        const b = got[0];
        if (b.porch) { const pw = Math.min(b.w * 0.55, 6); const [px, pz] = at(aH, front - 1.2); if (!clearOBB(px, pz, pw + 0.4, 2.4, rot, 0.6)) b.porch = false; else solid({ kind: 'wall', x: r2(px), z: r2(pz), w: r2(pw + 0.4), d: 2.4, rot: r4(rot), h: 3.0, y: r2(b.y), drawn: true }); }
        s += w + (garage ? gw : 0) + R(Z0.gap[0], Z0.gap[1]);
        if (garage) {
          // driveway: asphalt edge → garage door (concrete, a lot surface)
          const o0 = r.hw + 0.15; const o1 = front + 0.75;
          const poly = [at(aG - 1.8, o0), at(aG + 1.8, o0), at(aG + 1.8, o1), at(aG - 1.8, o1)].map(([u, v]) => [r2(u), r2(v)]);
          lots.push({ kind: 'lot', poly, paint: 'concrete', drive: true });
          const [dx, dz] = at(aG, (o0 + o1) / 2); stamp(dx, dz, 3.6, o1 - o0, rot, 0, LOT);
          if (rnd() < 0.36) { const [kx, kz] = at(aG + (rnd() - 0.5) * 0.4, o1 - 2.9); parkCar(kx, kz, rot + (rnd() < 0.5 ? Math.PI : 0), pick(['sedan', 'sedan', 'suv', 'suv', 'pickup', 'wagon']), pick(CAR_COL)); }
          // the mailbox by the drive (where there's no sidewalk to walk to the door)
          if (rnd() < 0.16) { const [mx, mz] = at(aG + (gFirst ? -2.6 : 2.6), r.hw + walk + 0.55); const q = rIdx(mx, mz); if (q >= 0 && ras[q] !== BLD && sm.clearance(mx, mz) > 0.5) solid({ kind: 'pole', x: r2(mx), z: r2(mz), w: 0.4, d: 0.4, rot: r4(rot), h: 1.25, style: 'mailbox', color: pick(['#2b2b2b', '#2f5f8a', '#6b4a35', '#3d3d42']) }); }
        }
        if (isHouse && /martin|southres|eastres|hill|whittier|westres/.test(zone) && rnd() < 0.4) {
          // a wood side-yard fence from the house's back corner (the side away from the garage); its
          // collider's base sits 0.62 m up so the engine bakes no shadow decal for it (triangle budget)
          const aF = garage && gFirst ? gw + w + 1.0 : (garage ? -1.0 : (rnd() < 0.5 ? -1.0 : w + 1.0));
          const f0 = front + d * 0.55; const f1 = front + d + 5; const [fx, fz] = at(aF, (f0 + f1) / 2);
          if (isFree(fx, fz, 0.2, f1 - f0, rot, 0.1) && clearOBB(fx, fz, 0.2, f1 - f0, rot, 1.2)) { stamp(fx, fz, 0.2, f1 - f0, rot, 0.1, SMALL); solid({ kind: 'wall', x: r2(fx), z: r2(fz), w: 0.14, d: r2(f1 - f0), rot: r4(rot), h: 1.2, y: r2(height(fx, fz) + 0.62), drawn: true }); props.push({ type: 'fence', x: fx, z: fz, len: f1 - f0, rot, col: pick(['#8a6a4a', '#9c7b55', '#76593e', '#b39b78', '#e9e4da']) }); }
        }
        if ((zone === 'commercial' || zone === 'east') && Z0.set > 8) { // a parking lot out front
          const ld = Z0.set - 1.5; const lo = r.hw + walk + 0.8 + ld / 2;
          const [lx, lz] = at(w / 2, lo); const lw = w + 4;
          const c2 = Math.cos(rot); const s2 = Math.sin(rot); const P2 = (a, bb) => [lx + a * c2 + bb * s2, lz - a * s2 + bb * c2];
          const poly = [P2(-lw / 2, -ld / 2), P2(lw / 2, -ld / 2), P2(lw / 2, ld / 2), P2(-lw / 2, ld / 2)].map(([u, v]) => [r2(u), r2(v)]);
          if (obbCells(lx, lz, lw, ld, rot, 0, (q) => (ras[q] === BLD || ras[q] === WATERC ? false : undefined))) { lots.push({ kind: 'lot', poly, paint: 'asphalt', rot }); stamp(lx, lz, lw, ld, rot, 0, LOT); }
        }
        // a front-yard street tree and a backyard tree for houses
        if (Z0.trees && rnd() < 0.26) {
          const tOff = r.hw + walk + 1.8; const tt = s - R(0, 4);
          const q2 = pt(r, Math.min(r.len - 1, tt));
          const tStyle = Z0.trees === 'cottonwood' ? pick(['aspen', 'aspen', 'pine', 'cottonwood']) : Z0.trees;
          tree(q2.x + nx * tOff, q2.z + nz * tOff, tStyle, tStyle === 'pine' ? R(9, 14) : R(9, 15), pick(['#5c8f3e', '#6b9a44', '#4f8a3c', '#7ea34a']));
        }
        if (isHouse && rnd() < 0.62) decorTree(b.x + nx * (d / 2 + R(4, 9)) + p.tx * R(-3, 3), b.z + nz * (d / 2 + R(4, 9)) + p.tz * R(-3, 3), zone === 'chautauqua' || zone === 'mesa' ? 'pine' : pick(['broad', 'broad', 'spruce', 'ash']), R(0.8, 1.3));
      }
    }
    yield;
  }

  // ── 3b. campus infill: sandstone halls between the campus roads; office parks out east ────
  for (const [zn, x0, x1, z0, z1, step, style] of [['campus', 200, 830, 205, 905, 44, 'cu'], ['east', 1260, 1900, -470, 905, 64, 'office']]) {
    for (let z = z0; z < z1; z += step) for (let x = x0; x < x1; x += step) {
      const cx = x + R(-6, 6); const cz = z + R(-6, 6); if (zoneAt(cx, cz) !== zn) continue;
      const w = zn === 'campus' ? R(22, 38) : R(30, 50); const d = zn === 'campus' ? R(13, 19) : R(20, 28); const rot = rnd() < 0.5 ? 0 : Math.PI / 2;
      const floors = zn === 'campus' ? (rnd() < 0.5 ? 3 : 4) : 2 + (rnd() < 0.4 ? 1 : 0);
      if (yd()) yield;
      const main = { x: cx, z: cz, w, d, rot, h: floors * 3.7 + 0.8, floors, style, color: pick(PALETTE[style]), roof: zn === 'campus' ? (rnd() < 0.7 ? 'hip' : 'gable') : 'flat', roofH: zn === 'campus' ? 4 + rnd() : 0, roofColor: zn === 'campus' ? pick(ROOF.cu) : pick(['#7d766b', '#8a8379', '#6f6a62']), zone: zn, seed: rnd(), pad: zn === 'campus' ? 5 : 8 };
      const list = [main];
      if (zn === 'campus') {
        // CU's Tuscan-vernacular massing: a cross wing off one end, sometimes a stair tower
        const c = Math.cos(rot); const s2 = Math.sin(rot); const Wl = (lx, lz) => [cx + lx * c + lz * s2, cz - lx * s2 + lz * c];
        const ww = R(9, 13); const wd = R(8, 13); const end = rnd() < 0.5 ? -1 : 1; const back = rnd() < 0.5 ? -1 : 1;
        const [wx, wz] = Wl(end * (w / 2 - ww / 2), back * (d / 2 + wd / 2 - 0.02));
        if (rnd() < 0.8) list.push({ x: wx, z: wz, w: ww, d: wd, rot, h: main.h - 3.7, floors: floors - 1, style, color: main.color, roof: 'hip', roofH: 3.4, roofColor: main.roofColor, zone: zn, seed: rnd(), pad: 4 });
        if (rnd() < 0.35) { const [tx, tz] = Wl(-end * (w / 2 - 3.4), -back * (d / 2 - 3.4)); list.push({ x: tx, z: tz, w: 6, d: 6, rot, h: main.h + 5.5, floors: floors + 1, style, color: main.color, roof: 'hip', roofH: 3, roofColor: main.roofColor, zone: zn, seed: rnd(), pad: 0, noSolid: true, tower: true }); }
      }
      // towers stand inside the hall's footprint: test only the hall and its wing
      const test = list.filter((b) => !b.tower);
      let ok = true; for (const b of test) if (!isFree(b.x, b.z, b.w, b.d, b.rot, b.pad, false)) { ok = false; break; }
      if (ok) for (const b of list) building(b, true);
    }
  }

  // ── 4. street furniture: lamps on arterials/downtown, signals at big crossings ─────────
  for (const r of sm.list) {
    yield;
    if (r.bridge || r.kind === 'alley') continue;
    const every = r.kind === 'highway' ? 110 : r.kind === 'arterial' ? 75 : 60;
    let flip = 1;
    for (let s = 14; s < r.len - 10; s += every) {
      if (yd()) yield;
      const p = pt(r, s); flip = -flip;
      const zone = zoneAt(p.x, p.z);
      if (r.kind === 'street' && zone !== 'downtown' && zone !== 'westpearl' && zone !== 'civic') continue;
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
    const ok = crossOk(a);
    for (let k = 0; k < a.n - 1; k++) {
      if ((k & 7) === 0 && yd()) yield;
      const ax = a.x[k]; const az = a.z[k]; const n1 = sm.nearest(ax, az, 4, ok);
      if (!n1.r || n1.d > 2.6) continue;
      const b = n1.r; if (b.kind !== 'arterial') continue;
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
  for (let u = 40; u < 1250; u += 14) { if (u > 690 && u < 830) continue; if (sm.clearance(...usPt(u + 7), (o) => o.bridge) < 4) continue; const [ax, az] = usPt(u); const [bx, bz] = usPt(Math.min(u + 14, 1252)); segWall(ax, az, bx, bz, 'barrier', 0.9, 'jersey', 0.7); }
  for (let u = 60; u < 1050; u += 20) {
    if (yd()) yield;
    const [ax, az] = usPt(u, -15); const [bx, bz] = usPt(u + 20, -15);
    if (sm.clearance((ax + bx) / 2, (az + bz) / 2, (o) => o.kind !== 'highway') < 1.5) continue;
    segWall(ax, az, bx, bz, 'wall', 3.6, 'soundwall', 0.5); stamp((ax + bx) / 2, (az + bz) / 2, 20, 2, Math.atan2(-(bz - az), bx - ax), 0.5);
  }
  for (let u = 60; u < 1250; u += 20) {
    if (yd()) yield;
    if ((u > 590 && u < 830) || (u > 880 && u < 1110) || u > 1170) continue;
    const [ax, az] = usPt(u, 15); const [bx, bz] = usPt(u + 20, 15);
    if (sm.clearance((ax + bx) / 2, (az + bz) / 2, (o) => o.kind !== 'highway') < 1.5) continue;
    segWall(ax, az, bx, bz, 'wall', 3.2, 'soundwall', 0.5);
  }
  // Flagstaff Rd + summit loop: guard rails on both edges (gaps at the junctions)
  for (const r of sm.list.filter((o) => /Flagstaff/.test(o.name))) {
    for (const side of [-1, 1]) {
      let prev = null;
      for (let s = r.name === 'Flagstaff Rd' ? 30 : 0; s <= r.len; s += 7) {
        if (yd()) yield;
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
  for (let z0 = BOUNDS.z0 + 8; z0 < BOUNDS.z1 - 6; z0 += 9) {
    if (yd()) yield;
    const z = z0 + R(-2.2, 2.2); const x = footX(z) - 11 - rnd() * 12;
    if (Math.abs(z - 150) < 26) continue; // Boulder Canyon mouth stays open to the creek
    if (sm.clearance(x, z) < 8) continue;
    const s = rnd() < 0.3 ? R(5.5, 8.5) : R(2.8, 5.5);
    const rr = r4(rnd() * 3);
    solid({ kind: 'rock', x: r2(x), z: r2(z), w: r2(s * 1.6), d: r2(s * 1.3), rot: rr, h: r2(s * 0.9), y: r2(height(x, z) - 0.5), drawn: true });
    props.push({ type: 'rock', x, z, s, w: r2(s * 1.6), d: r2(s * 1.3), h: s * 0.9, rot: rr, y: height(x, z) - 0.5, lean: rnd() * 0.35 });
    stamp(x, z, s * 1.6, s * 1.3, rr, 1);
  }

  yield;
  // ── 6. trees: the creek's cottonwoods, parks, the quad, Chautauqua, the foothill forest ──
  for (let k = 0; k < CREEK.length - 1; k++) {
    const [ax, az] = CREEK[k]; const [bx, bz] = CREEK[k + 1]; const L = Math.hypot(bx - ax, bz - az);
    for (let s = rnd() * 10; s < L; s += 20 + rnd() * 14) {
      const side = rnd() < 0.5 ? -1 : 1; const off = 8 + rnd() * 7;
      const x = ax + (bx - ax) * s / L + (-(bz - az) / L) * side * off * (side < 0 ? 1.3 : 1); const z = az + (bz - az) * s / L + ((bx - ax) / L) * side * off;
      if (x < footX(z) - 30) { decorTree(x, z, 'pine', R(0.9, 1.3)); continue; }
      if (sm.clearance(x, z) < 1.2) continue;
      const q = rIdx(x, z); if (q < 0 || (ras[q] !== FREE && ras[q] !== WATERC)) continue;
      ras[q] = FREE; tree(x, z, 'cottonwood', R(13, 19), pick(['#6d9a3f', '#7aa64a', '#5f8f3a']));
    }
  }
  const scatter = (poly, n, style, hr, col, force = false) => {
    let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = 0; i < n * 3 && n > 0; i++) {
      const x = R(x0, x1); const z = R(z0, z1); if (!pointInPoly(poly, x, z)) continue;
      if (sm.clearance(x, z) < 2) continue;
      if (tree(x, z, style, R(hr[0], hr[1]), col ? pick(col) : null, force)) n--;
    }
  };
  const rect = (a, b, c, d) => [[a, b], [c, b], [c, d], [a, d]];
  scatter(rect(10, 128, 36, 154), 6, 'cottonwood', [11, 16]); // Central Park
  for (const [x0, x1] of [[232, 250], [302, 322]]) scatter(rect(x0, 456, x1, 532), 5, 'cottonwood', [10, 15], ['#6b9a44', '#5c8f3e'], true); // Norlin Quad elms
  props.push({ type: 'quadPaths', x: 276, z: 494, w: 92, d: 78 });
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
    for (let i = 0; i < 9000 && placed < 1250; i++) {
      if (yd()) yield;
      const z = R(BOUNDS.z0 + 4, BOUNDS.z1 - 4); const x = R(BOUNDS.x0 + 4, footX(z) + 10);
      if (x > footX(z) - 18 && rnd() < 0.7) continue;
      if (sm.clearance(x, z) < 4) continue;
      if (decorTree(x, z, ((q) => (q < 0.48 ? 'pine' : q < 0.88 ? 'ponderosa' : q < 0.93 ? 'spruce' : 'broad'))(rnd()), R(0.9, 1.6))) placed++;
    }
  }
  // fields and mesas: sparse pines on the Table Mesa/NCAR bump and the Chautauqua meadow
  for (let i = 0, n = 0; i < 900 && n < 160; i++) {
    if (yd()) yield;
    const x = R(-120, 560); const z = R(1180, 1780);
    if (sm.clearance(x, z) < 3 || x < footX(z)) continue;
    if (decorTree(x, z, rnd() < 0.8 ? 'ponderosa' : 'pine', R(0.95, 1.45))) n++;
  }
  // east-side shelterbelts and Martin Acres backyards are handled by the frontage pass

  yield;
  // ── 7. US-36: two overhead sign gantries over both carriageways ─────────────────────
  for (const u of [330, 612]) {
    for (const v of [-13.9, 13.9]) { const [x, z] = usPt(u, v); solid({ kind: 'wall', x: r2(x), z: r2(z), w: 0.6, d: 0.6, rot: r4(Math.atan2(-US36.dz, US36.dx)), h: 8.6, y: r2(height(x, z)), drawn: true }); disk(x, z, 1, SMALL); }
    { const [gx, gz] = usPt(u, 0); props.push({ type: 'gantry', u, v0: -13.9, v1: 13.9, x: gx, z: gz }); }
  }
  // ── 8. Flagstaff Rd: sandstone outcrops (tilted slabs, like the Flatirons in miniature) ──
  {
    let n = 0;
    for (const r of sm.list.filter((o) => /Flagstaff/.test(o.name))) {
      for (let s = 40; s < r.len - 20 && n < 34; s += R(28, 46)) {
        if (yd()) yield;
        const p = pt(r, s); const side = rnd() < 0.5 ? -1 : 1; const off = r.hw + R(4.5, 10);
        const x = p.x - p.tz * side * off; const z = p.z + p.tx * side * off;
        const w = R(3, 7.5); const d = R(2.4, 4.8); const rot = rnd() * Math.PI;
        if (sm.clearance(x, z) < Math.max(w, d) / 2 + 2.5 || !isFree(x, z, w, d, rot, 0.8)) continue;
        stamp(x, z, w, d, rot, 0.8);
        const h = R(2.2, 5.5); const y = groundUnder(x, z, w, d, rot) - 0.4;
        solid({ kind: 'rock', x: r2(x), z: r2(z), w: r2(w), d: r2(d), rot: r4(rot), h: r2(h + 0.4), y: r2(y), drawn: true });
        props.push({ type: 'rock', x, z, w, d, h: h + 0.4, rot, y, lean: R(0.15, 0.45), s: Math.max(w, d), outcrop: true });
        n++;
      }
    }
  }
  yield;
  // ── 9. curb parking downtown (Walnut, West Pearl, Pearl east of the mall) ──────────────
  for (const r of sm.list.filter((o) => o.src.parking && !o.bridge)) {
    const rng = Array.isArray(r.src.parking) ? r.src.parking : [-1e9, 1e9];
    for (const side of [-1, 1]) {
      for (let s = 9; s < r.len - 9; s += 6.6) {
        if (yd()) yield;
        const p = pt(r, s); if (p.x < rng[0] || p.x > rng[1]) continue;
        if (p.z > MALL.z0 - 2 && p.z < MALL.z1 + 2 && p.x > MALL.x0 - 10 && p.x < MALL.x1 + 10) continue;
        // tight to the kerb (the body's outer side ~0.05 m off it), and clear of the corners: no
        // parking within ~12 m of a cross street (a turning car cuts in towards the kerb there;
        // AI drivers on the pursuit line used to clip the last car before the junction at speed)
        const nx = -p.tz * side; const nz = p.tx * side; const off = r.hw - 1.02;
        const x = p.x + nx * off; const z = p.z + nz * off;
        if (sm.clearance(x, z, (o) => o !== r && !o.bridge && o.kind !== 'alley') < 12) continue;
        if (sm.clearance(x, z, (o) => o.kind === 'alley') < 3) continue; // alley mouths stay open
        if (rnd() > 0.64) continue;
        parkCar(x, z, Math.atan2(p.tx * side, p.tz * side), pick(['sedan', 'sedan', 'suv', 'wagon', 'sedan', 'pickup']), pick(CAR_COL));
      }
    }
  }
  // ── 10. parking lots: stall stripes + parked cars (big-box, Twenty Ninth St, Table Mesa …) ──
  for (const o of [...OPEN, ...lots]) {
    if (yd()) yield;
    if ((o.paint || 'asphalt') !== 'asphalt' || o.poly.length !== 4 || o.drive) continue;
    const poly = o.poly; const cx = poly.reduce((a, q) => a + q[0], 0) / 4; const cz = poly.reduce((a, q) => a + q[1], 0) / 4;
    let ux; let uz;
    if (o.rot != null) { ux = Math.cos(o.rot); uz = -Math.sin(o.rot); } else { const l = Math.hypot(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]) || 1; ux = (poly[1][0] - poly[0][0]) / l; uz = (poly[1][1] - poly[0][1]) / l; }
    const vx = -uz; const vz = ux;
    let a0 = Infinity; let a1 = -Infinity; let b0 = Infinity; let b1 = -Infinity;
    for (const [px, pz] of poly) { const a = (px - cx) * ux + (pz - cz) * uz; const b = (px - cx) * vx + (pz - cz) * vz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    // rows run along the long axis A; stalls stand across it (along B)
    const longU = a1 - a0 >= b1 - b0;
    const Ax = longU ? ux : vx; const Az = longU ? uz : vz; const Bx = longU ? vx : ux; const Bz = longU ? vz : uz;
    const A0 = longU ? a0 : b0; const A1 = longU ? a1 : b1; const B0 = longU ? b0 : a0; const B1 = longU ? b1 : a1;
    const W = (a, b) => [cx + Ax * a + Bx * b, cz + Az * a + Bz * b];
    const occ = /Chautauqua/.test(o.name || '') ? 0.7 : /Twenty Ninth|Table Mesa|Basemar/.test(o.name || '') ? 0.5 : o.name ? 0.3 : 0.1;
    const carRot = Math.atan2(Bx, Bz); let cap = o.name ? 26 : 1;
    for (let row = B0 + 6; row < B1 - 5; row += 16) {
      for (let a = A0 + 3; a < A1 - 2; a += 3) {
        { const [x0, z0] = W(a, row - 5); const [x1, z1] = W(a, row + 5); stripes.push([r2(x0), r2(z0), r2(x1), r2(z1)]); }
        for (const sd of [-1, 1]) {
          if (a + 3 >= A1 - 2 || rnd() > occ || cap <= 0) continue;
          const [px, pz] = W(a + 1.5, row + sd * 2.65);
          if (!pointInPoly(poly, ...W(a + 1.5, row + sd * 4.9)) || sm.clearance(px, pz) < 2.6) continue;
          const q = rIdx(px, pz); if (q < 0 || ras[q] === BLD || ras[q] === WATERC) continue;
          cap--; parkCar(px + Ax * R(-0.15, 0.15), pz + Az * R(-0.15, 0.15), carRot + (sd > 0 ? 0 : Math.PI) + R(-0.04, 0.04), pick(['sedan', 'sedan', 'suv', 'suv', 'wagon', 'pickup', 'van']), pick(CAR_COL));
        }
      }
    }
  }
  yield;
  // ── 11. bus stops on the arterials (shelter behind the sidewalk + the stop sign) ─────────
  for (const r of sm.list.filter((o) => o.kind === 'arterial' && !o.bridge && /Broadway|28th|Baseline|Table Mesa|Arapahoe|30th|Folsom|Canyon|Colorado|Pearl/.test(o.name))) {
    let side = rnd() < 0.5 ? -1 : 1;
    for (let s = 70 + rnd() * 80; s < r.len - 40; s += R(260, 380)) {
      if (yd()) yield;
      side = -side;
      const p = pt(r, s); const nx = -p.tz * side; const nz = p.tx * side;
      const zone = zoneAt(p.x + nx * 20, p.z + nz * 20); if (zone === 'mtn' || zone === 'mesa' || zone === 'none') continue;
      const off = r.hw + 0.35 + walkOfR(r) + 1.15; const x = p.x + nx * off; const z = p.z + nz * off; const rot = rotFacing(nx, nz);
      if (sm.clearance(x, z, (o) => o !== r) < 5) continue;
      if (!obbCells(x, z, 4.2, 1.9, rot, 0.3, (q) => (ras[q] === BLD || ras[q] === SMALL || ras[q] === WATERC ? false : undefined))) continue;
      stamp(x, z, 4.2, 1.9, rot, 0.3, BLD);
      solid({ kind: 'wall', x: r2(x), z: r2(z), w: 3.9, d: 1.6, rot: r4(rot), h: 2.7, y: r2(height(x, z)), drawn: true });
      props.push({ type: 'busstop', x, z, rot });
      const sx = p.x + nx * (r.hw + 0.8) + p.tx * 3.2; const sz = p.z + nz * (r.hw + 0.8) + p.tz * 3.2;
      solid({ kind: 'pole', x: r2(sx), z: r2(sz), w: 0.3, d: 0.3, rot: r4(rot), h: 2.8, y: r2(height(sx, sz)), style: 'sign', color: '#2f5d8a' });
    }
  }
  // ── 12. power lines: the downtown alleys and Moorhead's back-lot line under US-36 ────────
  {
    const line = (pts) => { if (pts.length >= 2) props.push({ type: 'power', pts }); };
    const pole = (x, z) => { solid({ kind: 'wall', x: r2(x), z: r2(z), w: 0.34, d: 0.34, rot: 0, h: 9, y: r2(height(x, z)), drawn: true }); disk(x, z, 0.8, SMALL); return [x, z, height(x, z)]; };
    for (const r of sm.list.filter((o) => o.kind === 'alley' && /Pearl St alley/.test(o.name))) {
      let cur = [];
      for (let s = 4; s < r.len - 2; s += 30) {
        if (yd()) yield;
        const p = pt(r, s); const off = r.hw + 0.5; const x = p.x + p.tz * off; const z = p.z - p.tx * off;
        const q = rIdx(x, z); if (q < 0 || ras[q] === BLD || sm.clearance(x, z, (o) => o !== r) < 1) { line(cur); cur = []; continue; }
        cur.push(pole(x, z));
      }
      line(cur);
    }
    let cur = [];
    for (let t = MOOR_T0 + 40; t < MOOR_T1 - 10; t += 34) {
      if (yd()) yield;
      const [x, z] = moorPt(t, 31.2); const q = rIdx(x, z);
      if (q < 0 || ras[q] === BLD || ras[q] === WATERC || sm.clearance(x, z) < 2) { line(cur); cur = []; continue; }
      cur.push(pole(x, z));
    }
    line(cur);
  }
  yield;
  // ── 13. downtown street trees in grates (honey locusts) along the wide sidewalks ──────────
  {
    let n = 0;
    for (const r of sm.list.filter((o) => !o.bridge && walkOfR(o) >= 2.9)) {
      for (const side of [-1, 1]) for (let s = 8 + rnd() * 6; s < r.len - 6 && n < 40; s += R(19, 27)) {
        const p = pt(r, s); const nx = -p.tz * side; const nz = p.tx * side; const off = r.hw + 0.35 + 1.05;
        const x = p.x + nx * off; const z = p.z + nz * off;
        if (!/downtown|westpearl|eastpearl|civic|twentyninth|campus/.test(zoneAt(x + nx * 8, z + nz * 8))) continue;
        if (sm.clearance(x, z, (o) => o !== r) < 4) continue;
        let bad = false; for (let dj = -1; dj <= 1 && !bad; dj++) for (let di = -1; di <= 1; di++) { const q = rIdx(x + di * RC, z + dj * RC); if (q < 0 || ras[q] === BLD || ras[q] === SMALL || ras[q] === WATERC) { bad = true; break; } }
        if (bad) continue;
        disk(x, z, 1.6, SMALL);
        solid({ kind: 'tree', x: r2(x), z: r2(z), w: 0.6, d: 0.6, rot: 0, h: r2(R(7.5, 10)), y: r2(height(x, z)), style: 'aspen', color: pick(['#86a54a', '#7d9c45', '#93ad55']) });
        props.push({ type: 'grate', x, z });
        n++;
      }
    }
  }
  // ── 14. trunk colliders for the decor trees anyone can reach (forest beyond the boulder line has none) ──
  for (const d of decor) {
    if (d.far) continue;
    // backyard trees stand behind houses and fences; colliders where a car can actually get to them
    const cl = sm.clearance(d.x, d.z); const open = /mesa|chautauqua|mtn|none|valmont/.test(zoneAt(d.x, d.z));
    if (!(cl < 20 || (open && cl < 45 && d.x > footX(d.z) - 12))) continue;
    const tw = r2((d.type === 'spruce' ? 0.44 : d.type === 'pine' ? 0.52 : 0.6) * d.s);
    // base 0.65 m up (still hit by any car body): the engine then skips its baked shadow decal for
    // the trunk stub, which would cost ~18 triangles each for nothing the canopy doesn't cover
    solid({ kind: 'wall', x: d.x, z: d.z, w: tw, d: tw, rot: 0, h: 1.4, y: r2(d.y + 0.65), drawn: true, trunk: true });
    d.solid = true;
  }

  const ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  LAYOUT = { solids, buildings, decor, props, lots, parked, stripes, ms, ras, RC, RX0, RZ0, RW, RH };
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
