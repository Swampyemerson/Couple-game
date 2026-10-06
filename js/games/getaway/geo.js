// Getaway world queries (no THREE): smoothed road polylines, nearest-road lookups, surfaces,
// bridges (raised decks with their own level), solids (oriented boxes) in a grid, water and open
// polygons, line of sight, and a coarse nav grid with A* for the AI. Everything is a pure
// function of the map data, so both devices agree.
//
// Solids: { x, z, w, d, rot, h } — rot is THREE's rotation.y (mesh.rotation.y = rot draws the
// same box). Local→world: x' = x cos + z sin, z' = −x sin + z cos.

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

const KIND_RANK = { highway: 5, arterial: 4, ramp: 4, street: 3, alley: 2, dirt: 1 };
export const BREAKABLE = { pole: 1, tree: 1, bollard: 1, hydrant: 1, lamp: 1, signal: 1, sign: 1, mailbox: 1, cactus: 1, shrub: 1 };
const BLOCKS_VIEW = { building: 1, wall: 1, rock: 1 };
export const OPEN_KINDS = ['lot', 'grass', 'dirt', 'sand'];

/** Centripetal-ish Catmull-Rom through pts, sampled every ~step metres. */
function smooth(pts, closed, step = 5) {
  const n = pts.length;
  const P = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const xs = []; const zs = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1); const p1 = P(i); const p2 = P(i + 1); const p3 = P(i + 2);
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j < k; j++) {
      const t = j / k; const t2 = t * t; const t3 = t2 * t;
      // uniform Catmull-Rom with tension 0.5, tangents clamped by neighbours' lengths (no loops)
      const c = (a, b, c2, d) => 0.5 * ((2 * b) + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
      xs.push(c(p0[0], p1[0], p2[0], p3[0]));
      zs.push(c(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  if (!closed) { xs.push(pts[n - 1][0]); zs.push(pts[n - 1][1]); }
  return { x: Float64Array.from(xs), z: Float64Array.from(zs) };
}

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]; const zi = poly[i][1]; const xj = poly[j][0]; const zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}
function polyBox(poly) {
  let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
  for (const p of poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  return { x0, z0, x1, z1 };
}

export function createGeo(map) {
  const B = map.bounds || { x0: -500, z0: -500, x1: 500, z1: 500 };
  const H = typeof map.height === 'function' ? map.height : null;
  const ground = H ? (x, z) => { const v = H(x, z); return Number.isFinite(v) ? v : 0; } : () => 0;

  // ── roads ──
  const roads = [];
  for (const [ri, r] of (map.roads || []).entries()) {
    if (!r || !Array.isArray(r.pts) || r.pts.length < 2) continue;
    const closed = !!r.closed && r.pts.length > 2;
    const sm = smooth(r.pts, closed);
    let n = sm.x.length;
    let x = sm.x; let z = sm.z;
    if (closed) { // repeat the first point at the end so segments wrap
      x = new Float64Array(n + 1); z = new Float64Array(n + 1); x.set(sm.x); z.set(sm.z); x[n] = sm.x[0]; z[n] = sm.z[0]; n++;
    }
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
    const kind = KIND_RANK[r.kind] ? r.kind : 'street';
    const width = Math.max(4, Math.min(40, +r.width || 10));
    roads.push({
      idx: roads.length, src: ri, name: r.name || '', kind, rank: KIND_RANK[kind], width, hw: width / 2, closed, bridge: !!r.bridge,
      n, x, z, cum, len: cum[n - 1], traffic: r.traffic !== false && kind !== 'ramp',
      lanes: r.lanes > 0 ? Math.min(3, r.lanes | 0) : (kind === 'highway' ? 2 : kind === 'arterial' && width >= 14 ? 2 : 1),
      deck: null, // bridges: { h0, h1, clear }
    });
  }

  // segment grid
  const CELL = 24;
  const gx0 = B.x0 - 100; const gz0 = B.z0 - 100;
  const GW = Math.ceil((B.x1 - B.x0 + 200) / CELL); const GH = Math.ceil((B.z1 - B.z0 + 200) / CELL);
  const segCells = new Map();
  const cellOf = (x, z) => { const cx = Math.floor((x - gx0) / CELL); const cz = Math.floor((z - gz0) / CELL); return cx < 0 || cz < 0 || cx >= GW || cz >= GH ? -1 : cz * GW + cx; };
  for (const r of roads) {
    for (let i = 0; i < r.n - 1; i++) {
      const pad = r.hw + 2;
      const xa = Math.min(r.x[i], r.x[i + 1]) - pad; const xb = Math.max(r.x[i], r.x[i + 1]) + pad;
      const za = Math.min(r.z[i], r.z[i + 1]) - pad; const zb = Math.max(r.z[i], r.z[i + 1]) + pad;
      for (let cz = Math.floor((za - gz0) / CELL); cz <= Math.floor((zb - gz0) / CELL); cz++) {
        for (let cx = Math.floor((xa - gx0) / CELL); cx <= Math.floor((xb - gx0) / CELL); cx++) {
          if (cx < 0 || cz < 0 || cx >= GW || cz >= GH) continue;
          const k = cz * GW + cx; let l = segCells.get(k); if (!l) { l = []; segCells.set(k, l); }
          l.push(r.idx, i);
        }
      }
    }
  }

  /** Nearest point on any road (or road `only` / roads passing `filter`) within `maxD` (cells
   *  limit the search). out: { road, i, t, s, d, px, pz, tx, tz, side } — side > 0 = right of travel. */
  function nearestRoad(x, z, out, maxD = 30, filter = null) {
    out.road = -1; out.d = Infinity;
    const rc = Math.ceil(maxD / CELL);
    const cx0 = Math.floor((x - gx0) / CELL); const cz0 = Math.floor((z - gz0) / CELL);
    for (let cz = cz0 - rc; cz <= cz0 + rc; cz++) {
      if (cz < 0 || cz >= GH) continue;
      for (let cx = cx0 - rc; cx <= cx0 + rc; cx++) {
        if (cx < 0 || cx >= GW) continue;
        const l = segCells.get(cz * GW + cx); if (!l) continue;
        for (let k = 0; k < l.length; k += 2) {
          const r = roads[l[k]]; const i = l[k + 1];
          if (filter && !filter(r)) continue;
          const ax = r.x[i]; const az = r.z[i]; const bx = r.x[i + 1]; const bz = r.z[i + 1];
          const dx = bx - ax; const dz = bz - az; const L2 = dx * dx + dz * dz || 1;
          let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + dx * t; const pz = az + dz * t;
          const d = Math.hypot(x - px, z - pz);
          if (d < out.d) {
            const L = Math.sqrt(L2);
            out.d = d; out.road = r.idx; out.i = i; out.t = t; out.px = px; out.pz = pz;
            out.tx = dx / L; out.tz = dz / L; out.s = r.cum[i] + L * t;
            out.side = (x - px) * -out.tz + (z - pz) * out.tx; // right = (−tz, tx)
          }
        }
      }
    }
    return out.d;
  }

  /** Position + tangent at arc length s on road r (wraps closed roads, clamps open ones). */
  function sampleRoad(r, s, out) {
    if (r.closed) { s %= r.len; if (s < 0) s += r.len; } else s = s < 0 ? 0 : s > r.len ? r.len : s;
    let lo = 0; let hi = r.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= s) lo = m; else hi = m; }
    const L = r.cum[hi] - r.cum[lo] || 1; const t = (s - r.cum[lo]) / L;
    out.x = r.x[lo] + (r.x[hi] - r.x[lo]) * t; out.z = r.z[lo] + (r.z[hi] - r.z[lo]) * t;
    out.tx = (r.x[hi] - r.x[lo]) / L; out.tz = (r.z[hi] - r.z[lo]) / L; out.s = s;
    return out;
  }

  // bridges: deck heights (ramps at 12 %, clearance 5.5 m over a crossing road, else 2.2 m)
  const tmpN = { road: -1 };
  for (const r of roads) {
    if (!r.bridge) continue;
    let crosses = false;
    for (let i = 0; i < r.n && !crosses; i += 2) {
      nearestRoad(r.x[i], r.z[i], tmpN, 24, (o) => !o.bridge && o !== r);
      if (tmpN.road >= 0 && tmpN.d < roads[tmpN.road].hw + 1) crosses = true;
    }
    const clear = r.deckClear > 0 ? r.deckClear : (map.roads[r.src].clear > 0 ? map.roads[r.src].clear : crosses ? 5.5 : 2.2);
    r.deck = { h0: ground(r.x[0], r.z[0]), h1: ground(r.x[r.n - 1], r.z[r.n - 1]), clear, slope: 0.12 };
  }
  function deckY(r, s) {
    const d = r.deck; const L = r.len; const u = L > 0 ? s / L : 0;
    const base = d.h0 + (d.h1 - d.h0) * (u < 0 ? 0 : u > 1 ? 1 : u);
    // the ground under the deck may rise above the straight line between the ends
    const rise = Math.min(d.clear, Math.max(0, s) * d.slope, Math.max(0, L - s) * d.slope);
    return base + rise;
  }

  // ── open polygons + water ──
  const opens = (map.open || []).filter((o) => o && Array.isArray(o.poly) && o.poly.length > 2 && OPEN_KINDS.includes(o.kind)).map((o) => ({ kind: o.kind, poly: o.poly, box: polyBox(o.poly) }));
  const waters = (map.water || []).filter((w) => w && Array.isArray(w.poly) && w.poly.length > 2).map((w) => ({ poly: w.poly, box: polyBox(w.poly), y: Number.isFinite(w.y) ? w.y : null }));
  const inBox = (b, x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
  function inWater(x, z) { for (const w of waters) if (inBox(w.box, x, z) && pointInPoly(w.poly, x, z)) return true; return false; }
  function openKind(x, z) {
    let k = null;
    for (const o of opens) if (inBox(o.box, x, z) && pointInPoly(o.poly, x, z)) k = o.kind; // later polys win
    return k;
  }

  const nq = { road: -1 };
  /** Ground-level surface at (x, z): 'road' | 'lot' | 'grass' | 'dirt' | 'sand' | 'water'.
   *  Bridge decks are not ground (the at-grade road below passes under). */
  function surfaceAt(x, z) {
    nearestRoad(x, z, nq, 22, (r) => !r.bridge);
    if (nq.road >= 0 && nq.d <= roads[nq.road].hw + 0.3) return roads[nq.road].kind === 'dirt' ? 'dirt' : 'road';
    const k = openKind(x, z);
    if (k) return k;
    if (inWater(x, z)) return 'water';
    return 'grass';
  }

  // ── solids ──
  const solids = [];
  for (const s of map.solids || []) {
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
    const rot = +s.rot || 0;
    const w = Math.max(0.2, +s.w || 1); const d = Math.max(0.2, +s.d || 1);
    solids.push({
      i: solids.length, kind: s.kind || 'building', x: s.x, z: s.z, hw: w / 2, hd: d / 2, rot, c: Math.cos(rot), s: Math.sin(rot),
      h: Number.isFinite(s.h) ? s.h : (BREAKABLE[s.kind] ? 6 : 8), y: Number.isFinite(s.y) ? s.y : null,
      breakable: !!BREAKABLE[s.kind], broken: false, drawn: !!s.drawn, style: s.style || null, color: s.color || null,
      rad: Math.hypot(w, d) / 2, stamp: 0,
    });
  }
  const SC = 16;
  const SW = Math.ceil((B.x1 - B.x0 + 200) / SC); const SH = Math.ceil((B.z1 - B.z0 + 200) / SC);
  const sCells = new Map();
  for (const o of solids) {
    const r = o.rad;
    for (let cz = Math.floor((o.z - r - gz0) / SC); cz <= Math.floor((o.z + r - gz0) / SC); cz++) {
      for (let cx = Math.floor((o.x - r - gx0) / SC); cx <= Math.floor((o.x + r - gx0) / SC); cx++) {
        if (cx < 0 || cz < 0 || cx >= SW || cz >= SH) continue;
        const k = cz * SW + cx; let l = sCells.get(k); if (!l) { l = []; sCells.set(k, l); }
        l.push(o);
      }
    }
  }
  let stamp = 1;
  /** Calls fn(solid) once for every solid whose cell is within r of (x, z). */
  function eachSolid(x, z, r, fn) {
    stamp++;
    for (let cz = Math.floor((z - r - gz0) / SC); cz <= Math.floor((z + r - gz0) / SC); cz++) {
      if (cz < 0 || cz >= SH) continue;
      for (let cx = Math.floor((x - r - gx0) / SC); cx <= Math.floor((x + r - gx0) / SC); cx++) {
        if (cx < 0 || cx >= SW) continue;
        const l = sCells.get(cz * SW + cx); if (!l) continue;
        for (let k = 0; k < l.length; k++) { const o = l[k]; if (o.stamp === stamp) continue; o.stamp = stamp; fn(o); }
      }
    }
  }

  /** Segment vs solid boxes: the smallest t in [0, 1] where (x0,z0)→(x1,z1) enters a solid that
   *  blocks the view (buildings, walls, rocks taller than minH), else 1. */
  function segBlocked(x0, z0, x1, z1, minH = 2.2, any = false) {
    const dx = x1 - x0; const dz = z1 - z0; const L = Math.hypot(dx, dz);
    if (L < 1e-6) return 1;
    let best = 1;
    const steps = Math.ceil(L / (SC * 0.5));
    stamp++;
    for (let k = 0; k <= steps; k++) {
      const px = x0 + (dx * k) / steps; const pz = z0 + (dz * k) / steps;
      const cx = Math.floor((px - gx0) / SC); const cz = Math.floor((pz - gz0) / SC);
      if (cx < 0 || cz < 0 || cx >= SW || cz >= SH) continue;
      const l = sCells.get(cz * SW + cx); if (!l) continue;
      for (let q = 0; q < l.length; q++) {
        const o = l[q]; if (o.stamp === stamp) continue; o.stamp = stamp;
        if (o.broken || o.h < minH || (!any && !BLOCKS_VIEW[o.kind])) continue;
        // into box space
        const ax = x0 - o.x; const az = z0 - o.z;
        const lx0 = ax * o.c - az * o.s; const lz0 = ax * o.s + az * o.c;
        const ldx = dx * o.c - dz * o.s; const ldz = dx * o.s + dz * o.c;
        let t0 = 0; let t1 = 1;
        if (Math.abs(ldx) < 1e-9) { if (lx0 < -o.hw || lx0 > o.hw) continue; } else {
          let a = (-o.hw - lx0) / ldx; let b = (o.hw - lx0) / ldx; if (a > b) { const t = a; a = b; b = t; }
          if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue;
        }
        if (Math.abs(ldz) < 1e-9) { if (lz0 < -o.hd || lz0 > o.hd) continue; } else {
          let a = (-o.hd - lz0) / ldz; let b = (o.hd - lz0) / ldz; if (a > b) { const t = a; a = b; b = t; }
          if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue;
        }
        if (t0 < best) best = t0;
      }
      if (best < (k + 1) / steps - 0.01) break;
    }
    return best;
  }

  /** Line of sight between two cars (eye height 1.4 m above the ground): solids and terrain. */
  function lineOfSight(x0, z0, y0, x1, z1, y1) {
    if (segBlocked(x0, z0, x1, z1, 2.2) < 1) return false;
    if (H) {
      const L = Math.hypot(x1 - x0, z1 - z0); const n = Math.min(40, Math.ceil(L / 15));
      for (let k = 1; k < n; k++) {
        const t = k / n; const gy = ground(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
        if (gy > y0 + (y1 - y0) * t + 1.4) return false;
      }
    }
    return true;
  }

  // ── nav grid (AI) ──
  const NC = 8;
  const NW = Math.ceil((B.x1 - B.x0) / NC); const NH = Math.ceil((B.z1 - B.z0) / NC);
  const nav = new Uint8Array(NW * NH); // 0 = unknown, 1 road, 2 lot, 3 dirt, 4 grass, 6 sand, 255 blocked
  let navDone = 0;
  const COST = { road: 1, lot: 1.4, dirt: 3, grass: 4, sand: 7 };
  /** Fill the nav grid a slice at a time; returns progress 0..1. */
  function buildNav(budgetMs = 8) {
    const t0 = performance.now();
    while (navDone < nav.length) {
      const cz = Math.floor(navDone / NW); const cx = navDone % NW;
      const x = B.x0 + (cx + 0.5) * NC; const z = B.z0 + (cz + 0.5) * NC;
      let v;
      const sf = surfaceAt(x, z);
      nearestRoad(x, z, nq, 22);
      const onBridge = nq.road >= 0 && roads[nq.road].bridge && nq.d <= roads[nq.road].hw;
      if (sf === 'water' && !onBridge) v = 255;
      else v = onBridge ? 1 : sf === 'road' ? 1 : sf === 'lot' ? 2 : sf === 'dirt' ? 3 : sf === 'sand' ? 6 : 4;
      if (v !== 255 && v !== 1) {
        let blocked = false;
        eachSolid(x, z, 4, (o) => {
          if (blocked || o.breakable) return;
          const ax = x - o.x; const az = z - o.z;
          const lx = ax * o.c - az * o.s; const lz = ax * o.s + az * o.c;
          if (Math.abs(lx) < o.hw + 2.2 && Math.abs(lz) < o.hd + 2.2) blocked = true;
        });
        if (blocked) v = 255;
      }
      nav[navDone++] = v;
      if ((navDone & 255) === 0 && performance.now() - t0 > budgetMs) break;
    }
    return navDone / nav.length;
  }
  const navCost = (v) => (v === 1 ? 1 : v === 2 ? 1.4 : v === 3 ? 3 : v === 4 ? 4 : v === 6 ? 7 : 1e9);
  // A* (binary heap over typed arrays, reused between calls)
  const gScore = new Float32Array(NW * NH); const came = new Int32Array(NW * NH); const seen = new Uint32Array(NW * NH);
  let gen = 0;
  const heap = []; const heapF = [];
  function hpush(i, f) { heap.push(i); heapF.push(f); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heapF[p] <= heapF[k]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; [heapF[p], heapF[k]] = [heapF[k], heapF[p]]; k = p; } }
  function hpop() {
    const top = heap[0]; const lastI = heap.pop(); const lastF = heapF.pop();
    if (heap.length) {
      heap[0] = lastI; heapF[0] = lastF; let k = 0;
      for (;;) { const l = 2 * k + 1; const r = l + 1; let m = k; if (l < heap.length && heapF[l] < heapF[m]) m = l; if (r < heap.length && heapF[r] < heapF[m]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; [heapF[m], heapF[k]] = [heapF[k], heapF[m]]; k = m; }
    }
    return top;
  }
  const navIdx = (x, z) => { const cx = Math.floor((x - B.x0) / NC); const cz = Math.floor((z - B.z0) / NC); return cx < 0 || cz < 0 || cx >= NW || cz >= NH ? -1 : cz * NW + cx; };
  function nearestOpen(i) {
    if (i < 0) return -1;
    if (nav[i] && nav[i] !== 255) return i;
    const cx = i % NW; const cz = (i / NW) | 0;
    for (let r = 1; r < 8; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx; const z = cz + dz; if (x < 0 || z < 0 || x >= NW || z >= NH) continue;
      const j = z * NW + x; if (nav[j] && nav[j] !== 255) return j;
    }
    return -1;
  }
  /** Path from (x0,z0) to (x1,z1) as a flat [x, z, x, z…] array of cell centres (or null). */
  function findPath(x0, z0, x1, z1, maxExpand = 30000) {
    if (navDone < nav.length) return null;
    const s = nearestOpen(navIdx(x0, z0)); const t = nearestOpen(navIdx(x1, z1));
    if (s < 0 || t < 0) return null;
    gen++; heap.length = 0; heapF.length = 0;
    const tx = t % NW; const tz = (t / NW) | 0;
    const hfn = (i) => { const dx = Math.abs((i % NW) - tx); const dz = Math.abs(((i / NW) | 0) - tz); return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)) * 1.0; };
    seen[s] = gen; gScore[s] = 0; came[s] = -1; hpush(s, hfn(s));
    let exp = 0; let found = false;
    while (heap.length && exp < maxExpand) {
      const c = hpop(); exp++;
      if (c === t) { found = true; break; }
      const cx = c % NW; const cz = (c / NW) | 0; const gc = gScore[c];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const x = cx + dx; const z = cz + dz; if (x < 0 || z < 0 || x >= NW || z >= NH) continue;
        const j = z * NW + x; const v = nav[j]; if (v === 255 || !v) continue;
        if (dx && dz && (nav[cz * NW + x] === 255 || nav[z * NW + cx] === 255)) continue; // no corner cutting
        const g = gc + navCost(v) * (dx && dz ? 1.414 : 1);
        if (seen[j] !== gen || g < gScore[j]) { seen[j] = gen; gScore[j] = g; came[j] = c; hpush(j, g + hfn(j)); }
      }
    }
    if (!found) return null;
    const out = [];
    for (let c = t; c >= 0; c = came[c]) out.push(B.x0 + ((c % NW) + 0.5) * NC, B.z0 + (((c / NW) | 0) + 0.5) * NC);
    // reverse pairs
    const res = new Float64Array(out.length);
    for (let i = 0, j = out.length - 2; j >= 0; i += 2, j -= 2) { res[i] = out[j]; res[i + 1] = out[j + 1]; }
    return res;
  }

  /** A random point on a road (deterministic given rnd), away from bridges. */
  function randomRoadPoint(rnd, out = {}) {
    const total = roads.reduce((a, r) => a + (r.bridge ? 0 : r.len), 0);
    let k = rnd() * total;
    for (const r of roads) { if (r.bridge) continue; if (k <= r.len) { sampleRoad(r, k, out); out.road = r.idx; return out; } k -= r.len; }
    const r = roads[0]; sampleRoad(r, 0, out); out.road = 0; return out;
  }

  return {
    map, bounds: B, roads, solids, opens, waters, ground, hasHeight: !!H,
    nearestRoad, sampleRoad, deckY, surfaceAt, inWater, openKind, eachSolid, segBlocked, lineOfSight,
    buildNav, findPath, navReady: () => navDone >= nav.length, randomRoadPoint,
    navInfo: { NC, NW, NH, nav },
  };
}
