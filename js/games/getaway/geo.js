// Getaway world queries (no THREE): smoothed road polylines, nearest-road lookups, surfaces,
// bridges (raised decks with their own level), solids (oriented boxes) in a grid, water and open
// polygons, line of sight, and the road graph (roadgraph.js) the AI plans on and traffic takes its
// junctions from. Everything is a pure function of the map data, so both devices agree.
//
// Small breakables (trees, poles, lamps…) collide as a circle the size of the drawn trunk
// (`o.cr`, see TRUNK_R), not as their map box; shrubs are soft (no collision, they flatten).
//
// Solids: { x, z, w, d, rot, h } — rot is THREE's rotation.y (mesh.rotation.y = rot draws the
// same box). Local→world: x' = x cos + z sin, z' = −x sin + z cos.

import { buildRoadGraph, roadGraphBuilder, routePolyline } from './roadgraph.js';

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
/** Collision radius of engine-drawn breakables by style (the drawn trunk + 0.08 m). Matches the
 *  radii props.js draws with; a style not listed keeps its map box. */
export const TRUNK_R = { cottonwood: 0.4, tree: 0.32, jacaranda: 0.32, pine: 0.3, aspen: 0.23, palm: 0.28, lamp: 0.2, signal: 0.22, pole: 0.23, bollard: 0.24, hydrant: 0.3, sign: 0.16, mailbox: 0.3, cactus: 0.35 };
/** Breakables that give way at a walking pace (m/s), not at DAMAGE.breakable. */
export const FLIMSY = { mailbox: 1, hydrant: 1, bollard: 1, sign: 1, cactus: 1, shrub: 1 };
const STYLE_OF = { tree: 'tree', bollard: 'bollard', hydrant: 'hydrant', lamp: 'lamp', signal: 'signal', sign: 'sign', mailbox: 'mailbox', cactus: 'cactus', shrub: 'shrub' };
const STYLES = { cottonwood: 1, pine: 1, aspen: 1, palm: 1, jacaranda: 1, tree: 1, lamp: 1, signal: 1, bollard: 1, hydrant: 1, pole: 1, sign: 1, mailbox: 1, cactus: 1, shrub: 1 };
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
      n, x, z, cum, len: cum[n - 1], traffic: r.traffic !== false && kind !== 'ramp', oneway: !!r.oneway,
      sidewalk: Number.isFinite(r.sidewalk) ? Math.max(0, Math.min(8, r.sidewalk)) : (Number.isFinite(map.sidewalk) ? Math.max(0, Math.min(8, map.sidewalk)) : 0),
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
    for (let i = 0; i < r.n && !crosses; i++) {
      if (r.cum[i] < 14 || r.cum[i] > r.len - 14) continue; // the roads it joins at its ends
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
    if (nq.road >= 0) {
      const r = roads[nq.road];
      if (nq.d <= r.hw + 0.3) return r.kind === 'dirt' ? 'dirt' : 'road';
      if (r.sidewalk > 0 && nq.d <= r.hw + 0.3 + r.sidewalk) return 'lot'; // a drawn sidewalk drives like concrete
    }
    if (inWater(x, z)) return 'water'; // water wins over open polygons (river pools inside sand beds)
    const k = openKind(x, z);
    if (k) return k;
    return 'grass';
  }

  // ── solids ──
  const solids = [];
  for (const s of map.solids || []) {
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
    const rot = +s.rot || 0;
    const w = Math.max(0.2, +s.w || 1); const d = Math.max(0.2, +s.d || 1);
    const kind = s.kind || 'building'; const br = !!BREAKABLE[kind];
    const st = br ? (STYLES[s.style] ? s.style : (STYLE_OF[kind] || 'pole')) : null;
    // engine-drawn breakables collide as their trunk; a map-drawn one keeps its box (≤ its size)
    const cr = br && !s.drawn && TRUNK_R[st] ? Math.min(TRUNK_R[st], Math.max(w, d) / 2 + 0.08) : 0;
    solids.push({
      i: solids.length, kind, x: s.x, z: s.z, hw: w / 2, hd: d / 2, rot, c: Math.cos(rot), s: Math.sin(rot),
      h: Number.isFinite(s.h) ? s.h : (br ? 6 : 8), y: Number.isFinite(s.y) ? s.y : null,
      breakable: br, broken: false, drawn: !!s.drawn, style: s.style || null, color: s.color || null,
      rad: Math.hypot(w, d) / 2, stamp: 0, hRaw: Number.isFinite(s.h) ? s.h : NaN,
      cr, soft: kind === 'shrub', flimsy: !!FLIMSY[kind],
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

  // ── road graph (AI routing, traffic junctions) ──
  let graph = null; let builder = null;
  /** The road graph, built on first use (≈30–200 ms on the big maps: loaders should slice it
   *  with buildNav first). */
  function roadGraph() { if (!graph) { graph = buildRoadGraph(api); builder = null; } return graph; }
  /** Build the graph in slices: works for about `ms` (default: all at once) and returns 1 when
   *  the graph is ready, else 0.5. */
  function buildNav(ms) {
    if (graph) return 1;
    if (!(ms > 0)) { roadGraph(); return 1; }
    if (!builder) builder = roadGraphBuilder(api);
    const g = builder.step(ms);
    if (g) { graph = g; builder = null; return 1; }
    return 0.5;
  }
  const fpLoc = {}; const fpLoc2 = {}; const fpRes = {}; const fpSrc = [];
  /** A route from (x0, z0) to (x1, z1) along the roads as a flat [x, z, x, z…] polyline (or null). */
  function findPath(x0, z0, x1, z1) {
    const g = roadGraph();
    if (g.locate(x0, z0, null, fpLoc, 200).road < 0 || g.locate(x1, z1, null, fpLoc2, 200).road < 0) return null;
    const dist = g.newDist(); const prev = g.newPrev();
    fpSrc.length = 0; const v = g.speedOf(fpLoc.road);
    fpSrc.push(fpLoc.a, (fpLoc.s - fpLoc.sa) / v, fpLoc.b, (fpLoc.sb - fpLoc.s) / v);
    g.dijkstra(fpSrc, dist, prev);
    g.costTo(fpLoc2, dist, fpRes);
    if (!Number.isFinite(fpRes.cost)) return null;
    const { start, spans } = g.spansTo(fpRes.via, prev, []);
    spans.unshift({ road: fpLoc.road, s0: fpLoc.s, s1: start === fpLoc.a ? fpLoc.sa : fpLoc.sb });
    spans.push({ road: fpLoc2.road, s0: fpRes.viaS, s1: fpLoc2.s });
    const pl = routePolyline(api, spans, 0, 6);
    const out = new Float64Array(pl.n * 2);
    for (let i = 0; i < pl.n; i++) { out[i * 2] = pl.x[i]; out[i * 2 + 1] = pl.z[i]; }
    return out;
  }

  /** A random point on a road (deterministic given rnd), away from bridges. */
  function randomRoadPoint(rnd, out = {}) {
    const total = roads.reduce((a, r) => a + (r.bridge ? 0 : r.len), 0);
    let k = rnd() * total;
    for (const r of roads) { if (r.bridge) continue; if (k <= r.len) { sampleRoad(r, k, out); out.road = r.idx; return out; } k -= r.len; }
    const r = roads[0]; sampleRoad(r, 0, out); out.road = 0; return out;
  }

  const api = {
    map, bounds: B, roads, solids, opens, waters, ground, hasHeight: !!H,
    nearestRoad, sampleRoad, deckY, surfaceAt, inWater, openKind, eachSolid, segBlocked, lineOfSight,
    buildNav, findPath, navReady: () => !!graph, randomRoadPoint, roadGraph,
  };
  return api;
}
