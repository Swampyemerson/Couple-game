// Getaway road graph: the AI's map and traffic's junction list, built from geo.roads (no THREE).
// Nodes are points on roads (junctions, road ends, dead ends). Edges run along a road between
// consecutive nodes (one per direction; one-way roads only forward) or link two roads at a
// junction. Junctions come from road-end snaps (an open end within hw + 4 m of another road)
// and from same-level crossings (bridge decks join only at their ends). A road span whose
// right-hand lane runs into a non-breakable solid (a median barrier, a building a map put on the
// road) is blocked in that direction. Everything is a pure function of the map, so both devices
// build the same graph (traffic's signals depend on it).
//
// Planning: Dijkstra over typed arrays (≈0.2–1.5 ms on the biggest maps). Routes come back as a
// list of spans { road, s0, s1 } and are turned into a lane-offset polyline for following.

export const ROAD_SPEED = { highway: 33, arterial: 22, ramp: 20, street: 15, alley: 9, dirt: 11 };
const BLOCK_KINDS = { building: 1, wall: 1, rock: 1, barrier: 1 };

/** Build the graph in one go. geo: from createGeo. Returns the graph object (see the end). */
export function buildRoadGraph(geo) { const res = {}; const it = graphBuild(geo, res); while (!it.next().done); return res.g; }
/** The same in slices: step(ms) works for about ms milliseconds and returns the graph when done
 *  (else null), so a loader can keep frames flowing on a phone. */
export function roadGraphBuilder(geo) {
  const res = {}; const it = graphBuild(geo, res); let done = false;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return { step(ms = 8) { const t0 = now(); while (!done && now() - t0 < ms) done = !!it.next().done; return done ? res.g : null; } };
}
function* graphBuild(geo, res) {
  let wk = 0;
  const roads = geo.roads;
  const NR = roads.length;
  const splits = roads.map((r) => (r.closed ? [] : [0, r.len]));
  const links = []; // [roadA, sA, roadB, sB, kind] kind: 0 cross, 1 end-snap
  const nq = { road: -1 };
  // ── end snaps ──
  for (const r of roads) {
    if (r.closed) continue;
    for (const end of [0, 1]) {
      const i = end ? r.n - 1 : 0; const s = end ? r.len : 0;
      geo.nearestRoad(r.x[i], r.z[i], nq, 44, (o) => o !== r);
      if (nq.road < 0) continue;
      const o = roads[nq.road];
      if (nq.d > o.hw + 4) continue;
      // a bridge deck is joined only near its ends (its middle is above everything else)
      if (o.bridge && !r.bridge && nq.s > 14 && nq.s < o.len - 14) continue;
      if (r.bridge && !o.bridge && false) continue;
      splits[o.idx].push(nq.s);
      links.push(r.idx, s, o.idx, nq.s, 1);
    }
  }
  // ── crossings (segment grid) ──
  const C = 40;
  const cells = new Map();
  for (const r of roads) {
    for (let i = 0; i < r.n - 1; i++) {
      const x0 = Math.min(r.x[i], r.x[i + 1]); const x1 = Math.max(r.x[i], r.x[i + 1]);
      const z0 = Math.min(r.z[i], r.z[i + 1]); const z1 = Math.max(r.z[i], r.z[i + 1]);
      for (let cz = Math.floor(z0 / C); cz <= Math.floor(z1 / C); cz++) {
        for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++) {
          const k = cx * 73856093 ^ cz * 19349663;
          let l = cells.get(k); if (!l) { l = []; cells.set(k, l); }
          l.push(r.idx, i);
        }
      }
    }
  }
  const seenPair = new Set();
  const keys = Array.from(cells.keys()).sort((a, b) => a - b); // deterministic order
  for (const k of keys) {
    if (++wk % 48 === 0) yield;
    const l = cells.get(k);
    for (let p = 0; p < l.length; p += 2) {
      const A = roads[l[p]]; const i = l[p + 1];
      for (let q = p + 2; q < l.length; q += 2) {
        const B = roads[l[q]]; const j = l[q + 1];
        if (A === B) continue;
        const pk = A.idx < B.idx ? `${A.idx}:${i}:${B.idx}:${j}` : `${B.idx}:${j}:${A.idx}:${i}`;
        if (seenPair.has(pk)) continue; seenPair.add(pk);
        const ax = A.x[i]; const az = A.z[i]; const bx = A.x[i + 1]; const bz = A.z[i + 1];
        const cx = B.x[j]; const cz = B.z[j]; const dx = B.x[j + 1]; const dz = B.z[j + 1];
        const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
        if (Math.abs(den) < 1e-9) continue;
        const u = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den;
        const v = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const sa = A.cum[i] + u * (A.cum[i + 1] - A.cum[i]);
        const sb = B.cum[j] + v * (B.cum[j + 1] - B.cum[j]);
        // grade separation: a deck only meets roads at its ends
        const aEnd = sa < 14 || sa > A.len - 14; const bEnd = sb < 14 || sb > B.len - 14;
        if (A.bridge !== B.bridge && !((A.bridge && aEnd) || (B.bridge && bEnd))) continue;
        if (A.bridge && B.bridge && !(aEnd || bEnd)) continue;
        // ramps cross highways on their own level only at the ends
        if ((A.kind === 'ramp' && B.kind === 'highway' && !aEnd) || (B.kind === 'ramp' && A.kind === 'highway' && !bEnd)) continue;
        splits[A.idx].push(sa); splits[B.idx].push(sb);
        links.push(A.idx, sa, B.idx, sb, 0);
      }
    }
  }
  // ── nodes per road (splits merged within 5 m) ──
  const nodeRoad = []; const nodeS = []; const nodeX = []; const nodeZ = [];
  const roadNodes = new Array(NR);
  const tmp = { x: 0, z: 0, tx: 0, tz: 0, s: 0 };
  for (const r of roads) {
    const ss = splits[r.idx].slice().sort((a, b) => a - b);
    if (r.closed && !ss.length) ss.push(0);
    const list = [];
    for (const s of ss) {
      if (list.length && s - nodeS[list[list.length - 1]] < 5) continue;
      if (r.closed && list.length && r.len - s + nodeS[list[0]] < 5) continue;
      const id = nodeRoad.length;
      geo.sampleRoad(r, s, tmp);
      nodeRoad.push(r.idx); nodeS.push(s); nodeX.push(tmp.x); nodeZ.push(tmp.z);
      list.push(id);
    }
    roadNodes[r.idx] = list;
  }
  const NN = nodeRoad.length;
  const nodeAt = (ri, s) => { // nearest node on road ri to s
    const l = roadNodes[ri]; let best = l[0]; let bd = Infinity;
    for (const id of l) { const d = Math.abs(nodeS[id] - s); if (d < bd) { bd = d; best = id; } }
    return best;
  };
  // ── edges ──
  const eFrom = []; const eTo = []; const eCost = []; const eRoad = []; const eS0 = []; const eS1 = []; const eKind = [];
  const addEdge = (a, b, cost, road, s0, s1, kind) => { eFrom.push(a); eTo.push(b); eCost.push(cost); eRoad.push(road); eS0.push(s0); eS1.push(s1); eKind.push(kind); };
  // is the right-hand lane from s0 to s1 (direction by sign) blocked by a solid?
  const blocked = (r, s0, s1) => {
    const dir = s1 >= s0 ? 1 : -1; const L = Math.abs(s1 - s0);
    const off = (0.5 * (r.hw - (r.park || 0))) / r.lanes;
    let hit = 0;
    for (let d = 2; d < L - 1; d += 3) {
      let s = s0 + dir * d; if (r.closed) { s %= r.len; if (s < 0) s += r.len; }
      geo.sampleRoad(r, s, tmp);
      const tx = tmp.tx * dir; const tz = tmp.tz * dir;
      const px = tmp.x - tz * off; const pz = tmp.z + tx * off;
      let any = false;
      geo.eachSolid(px, pz, 3, (o) => {
        if (any || o.breakable || !BLOCK_KINDS[o.kind] || o.h < 0.4) return;
        if (r.bridge && o.y == null && o.h < 6) return; // under the deck
        if (!r.bridge && o.y != null && o.y > 2) return;
        const ax = px - o.x; const az = pz - o.z;
        const lx = ax * o.c - az * o.s; const lz = ax * o.s + az * o.c;
        if (Math.abs(lx) < o.hw + 1.1 && Math.abs(lz) < o.hd + 1.1) any = true;
      });
      if (any && ++hit >= 1) return true;
    }
    return false;
  };
  for (const r of roads) {
    yield;
    const l = roadNodes[r.idx]; if (!l || !l.length) continue;
    const sp = ROAD_SPEED[r.kind] || 14;
    const slow = r.kind === 'alley' || r.kind === 'dirt' ? 1.3 : 1;
    const pairs = [];
    for (let k = 0; k < l.length - 1; k++) pairs.push([l[k], l[k + 1], nodeS[l[k]], nodeS[l[k + 1]]]);
    if (r.closed) pairs.push([l[l.length - 1], l[0], nodeS[l[l.length - 1]], nodeS[l[0]] + r.len]);
    for (const [a, b, s0, s1] of pairs) {
      const L = s1 - s0; if (L <= 0.01) continue;
      const cost = (L / sp) * slow;
      const fwdBlock = blocked(r, s0, s1); const backBlock = !r.oneway && blocked(r, s1, s0);
      addEdge(a, b, fwdBlock ? cost * 40 + 60 : cost, r.idx, s0, s1, fwdBlock ? 2 : 0);
      if (!r.oneway) addEdge(b, a, backBlock ? cost * 40 + 60 : cost, r.idx, s1, s0, backBlock ? 2 : 0);
      else addEdge(b, a, cost * 4 + 20, r.idx, s1, s0, 3); // wrong way: only when it must
    }
  }
  // junction links (and junction clusters for traffic)
  const jOf = new Int32Array(NN).fill(-1); const junctions = [];
  const join = (a, b) => {
    let ja = jOf[a]; let jb = jOf[b];
    if (ja < 0 && jb < 0) { ja = junctions.length; junctions.push({ nodes: [a, b] }); jOf[a] = ja; jOf[b] = ja; return; }
    if (ja < 0) { jOf[a] = jb; junctions[jb].nodes.push(a); return; }
    if (jb < 0) { jOf[b] = ja; junctions[ja].nodes.push(b); return; }
    if (ja === jb) return;
    for (const n of junctions[jb].nodes) { jOf[n] = ja; junctions[ja].nodes.push(n); }
    junctions[jb] = null;
  };
  for (let k = 0; k < links.length; k += 5) {
    const a = nodeAt(links[k], links[k + 1]); const b = nodeAt(links[k + 2], links[k + 3]);
    if (a === b) continue;
    const d = Math.hypot(nodeX[a] - nodeX[b], nodeZ[a] - nodeZ[b]);
    const c = 0.9 + d / 12;
    addEdge(a, b, c, -1, 0, 0, 1); addEdge(b, a, c, -1, 0, 0, 1);
    join(a, b);
  }
  // ── adjacency (CSR) ──
  const NE = eFrom.length;
  const adjStart = new Int32Array(NN + 1);
  for (let e = 0; e < NE; e++) adjStart[eFrom[e] + 1]++;
  for (let i = 0; i < NN; i++) adjStart[i + 1] += adjStart[i];
  const adj = new Int32Array(NE); const fill = adjStart.slice(0, NN);
  for (let e = 0; e < NE; e++) adj[fill[eFrom[e]]++] = e;
  const E = { from: Int32Array.from(eFrom), to: Int32Array.from(eTo), cost: Float64Array.from(eCost), road: Int32Array.from(eRoad), s0: Float64Array.from(eS0), s1: Float64Array.from(eS1), kind: Uint8Array.from(eKind) };
  const degree = new Uint8Array(NN);
  for (let i = 0; i < NN; i++) { const set = new Set(); for (let k = adjStart[i]; k < adjStart[i + 1]; k++) set.add(E.to[adj[k]]); degree[i] = Math.min(255, set.size); }
  // tidy junction list: centre, radius, the roads through it
  const J = [];
  for (const j of junctions) {
    if (!j) continue;
    let x = 0; let z = 0; for (const n of j.nodes) { x += nodeX[n]; z += nodeZ[n]; } x /= j.nodes.length; z /= j.nodes.length;
    let rad = 0; const arms = [];
    for (const n of j.nodes) {
      const r = roads[nodeRoad[n]];
      rad = Math.max(rad, r.hw + 1.5);
      arms.push({ road: r.idx, s: nodeS[n], node: n, end: !r.closed && (nodeS[n] < 0.5 ? -1 : nodeS[n] > r.len - 0.5 ? 1 : 0) });
    }
    J.push({ id: J.length, x, z, r: rad, arms });
  }
  // divided carriageways: barriers along the centre line
  const divided = new Uint8Array(NR);
  for (const r of roads) {
    if (r.kind !== 'highway' && r.kind !== 'arterial') continue;
    yield;
    let n = 0; let hit = 0;
    for (let s = 10; s < r.len - 10; s += 25) {
      geo.sampleRoad(r, s, tmp); n++;
      let any = false;
      geo.eachSolid(tmp.x, tmp.z, 2, (o) => { if (!any && (o.kind === 'barrier' || o.kind === 'wall') && Math.hypot(o.x - tmp.x, o.z - tmp.z) < o.rad + 1) any = true; });
      if (any) hit++;
    }
    divided[r.idx] = n > 2 && hit / n > 0.3 ? 1 : 0;
  }

  // ── Dijkstra ──
  const heapI = new Int32Array(NE + 8 + NN); const heapF = new Float64Array(NE + 8 + NN); let hn = 0;
  const hpush = (i, f) => { let k = hn++; while (k > 0) { const p = (k - 1) >> 1; if (heapF[p] <= f) break; heapI[k] = heapI[p]; heapF[k] = heapF[p]; k = p; } heapI[k] = i; heapF[k] = f; };
  const hpop = () => {
    const top = heapI[0]; const li = heapI[--hn]; const lf = heapF[hn]; let k = 0;
    for (;;) { const l = 2 * k + 1; if (l >= hn) break; let m = l; if (l + 1 < hn && heapF[l + 1] < heapF[l]) m = l + 1; if (heapF[m] >= lf) break; heapI[k] = heapI[m]; heapF[k] = heapF[m]; k = m; }
    heapI[k] = li; heapF[k] = lf;
    return top;
  };
  /** srcs: [node, cost, node, cost…]. Fills dist (Float64Array NN) and prevE (Int32Array NN: edge
   *  into the node, −1 at a source). penalty(e) → extra cost (blocked edges, recent stucks). */
  function dijkstra(srcs, dist, prevE, penalty = null, maxCost = Infinity) {
    dist.fill(Infinity); prevE.fill(-1); hn = 0;
    for (let k = 0; k < srcs.length; k += 2) { const n = srcs[k]; const c = srcs[k + 1]; if (c < dist[n]) { dist[n] = c; hpush(n, c); } }
    while (hn) {
      const f = heapF[0]; const u = hpop();
      if (f > dist[u]) continue;
      if (f > maxCost) break;
      for (let k = adjStart[u]; k < adjStart[u + 1]; k++) {
        const e = adj[k]; const v = E.to[e];
        const w = f + E.cost[e] + (penalty ? penalty(e) : 0);
        if (w < dist[v]) { dist[v] = w; prevE[v] = e; hpush(v, w); }
      }
    }
  }

  /** Where on the graph is (x, z)? out: { road, s, d, a, b (nodes before/after s on the road),
   *  sa, sb (their arc positions, unwrapped for closed roads), dir (+1 if yaw runs with s) }. */
  function locate(x, z, yaw, out, maxD = 60, filter = null) {
    geo.nearestRoad(x, z, nq, maxD, filter);
    out.road = nq.road; out.d = nq.d;
    if (nq.road < 0) return out;
    const r = roads[nq.road]; const s = nq.s;
    out.s = s; out.px = nq.px; out.pz = nq.pz; out.tx = nq.tx; out.tz = nq.tz; out.side = nq.side;
    out.dir = yaw == null ? 1 : (Math.sin(yaw) * nq.tx - Math.cos(yaw) * nq.tz >= 0 ? 1 : -1);
    const l = roadNodes[r.idx];
    let a = -1; let b = -1;
    for (let k = 0; k < l.length; k++) { if (nodeS[l[k]] <= s) a = k; else { b = k; break; } }
    if (r.closed) {
      if (a < 0) a = l.length - 1; if (b < 0) b = 0;
      out.a = l[a]; out.b = l[b];
      out.sa = nodeS[l[a]] <= s ? nodeS[l[a]] : nodeS[l[a]] - r.len;
      out.sb = nodeS[l[b]] > s ? nodeS[l[b]] : nodeS[l[b]] + r.len;
    } else {
      if (a < 0) a = 0; if (b < 0) b = l.length - 1;
      out.a = l[a]; out.b = l[b]; out.sa = nodeS[l[a]]; out.sb = nodeS[l[b]];
    }
    return out;
  }
  const spd = (ri) => ROAD_SPEED[roads[ri].kind] || 14;
  /** Dijkstra sources for a car at loc (heading loc.dir). Going back costs a U-turn. */
  function sourcesFor(loc, speed, out) {
    out.length = 0;
    if (loc.road < 0) return out;
    const r = roads[loc.road]; const v = spd(loc.road);
    const uturn = (divided[loc.road] ? 22 : r.kind === 'highway' ? 14 : 5) * Math.min(1, 0.6 + speed / 25); // (a three-point turn isn't free either)
    const toB = (loc.sb - loc.s) / v; const toA = (loc.s - loc.sa) / v;
    const offK = 1 + Math.max(0, loc.d - r.hw) / 20; // off the road: a little extra
    if (r.oneway) { out.push(loc.b, toB * offK); out.push(loc.a, toA * offK + 30); return out; }
    if (loc.dir > 0) { out.push(loc.b, toB * offK); out.push(loc.a, toA * offK + uturn); } else { out.push(loc.a, toA * offK); out.push(loc.b, toB * offK + uturn); }
    return out;
  }
  /** Cost to reach point loc (on its road) given node costs dist; returns { cost, via, last } */
  function costTo(loc, dist, res) {
    const v = spd(loc.road);
    const ca = dist[loc.a] + (loc.s - loc.sa) / v; const cb = dist[loc.b] + (loc.sb - loc.s) / v;
    if (ca <= cb) { res.cost = ca; res.via = loc.a; res.viaS = loc.sa; } else { res.cost = cb; res.via = loc.b; res.viaS = loc.sb; }
    return res;
  }
  /** Spans from the source to node n, following prevE: [{road, s0, s1}…] (s unwrapped). */
  function spansTo(n, prevE, out) {
    const rev = [];
    let u = n; let guard = 0;
    while (prevE[u] >= 0 && guard++ < 5000) { const e = prevE[u]; rev.push(e); u = E.from[e]; }
    out.length = 0;
    for (let k = rev.length - 1; k >= 0; k--) { const e = rev[k]; if (E.road[e] >= 0) out.push({ road: E.road[e], s0: E.s0[e], s1: E.s1[e], e }); else out.push({ road: -1, x0: nodeX[E.from[e]], z0: nodeZ[E.from[e]], x1: nodeX[E.to[e]], z1: nodeZ[E.to[e]], e }); }
    return { start: u, spans: out };
  }
  /** Nodes reachable going forward from node n arriving by edge e, excluding the reverse. */
  res.g = {
    roads, nodes: { n: NN, road: nodeRoad, s: nodeS, x: nodeX, z: nodeZ, degree, junction: jOf }, roadNodes, edges: E, adjStart, adj,
    junctions: J, divided, speedOf: spd,
    dijkstra, locate, sourcesFor, costTo, spansTo,
    newDist: () => new Float64Array(NN), newPrev: () => new Int32Array(NN),
  };
}

/**
 * Sample a route into a polyline with a lane offset to the right of travel. spans: from
 * spansTo plus a first span (from the car) and a last span (to the target). Returns
 * { x: Float64Array, z, s (cumulative), n, road (Int32Array per point) }.
 */
export function routePolyline(geo, spans, laneK = 0.5, step = 4, maxLen = 1e9, out = null) {
  const tmp = { x: 0, z: 0, tx: 0, tz: 0, s: 0 };
  const xs = []; const zs = []; const rs = [];
  let total = 0; let px = NaN; let pz = NaN;
  const push = (x, z, r) => {
    if (xs.length) { const d = Math.hypot(x - px, z - pz); if (d < 0.6) return; total += d; }
    // no out-and-back spikes (a junction node a few metres past the turn): drop the points that
    // the route would only drive to turn round and come back
    let m = xs.length;
    while (m >= 2) {
      const ax = xs[m - 1] - xs[m - 2]; const az = zs[m - 1] - zs[m - 2]; const bx = x - xs[m - 1]; const bz = z - zs[m - 1];
      const la = Math.hypot(ax, az); const lb = Math.hypot(bx, bz);
      if (la > 0 && lb > 0 && (ax * bx + az * bz) / (la * lb) < -0.5 && la < 30) { total -= la; xs.pop(); zs.pop(); rs.pop(); m--; } else break;
    }
    if (m) total += Math.hypot(x - xs[m - 1], z - zs[m - 1]) - Math.hypot(x - px, z - pz);
    xs.push(x); zs.push(z); rs.push(r); px = x; pz = z;
  };
  for (const sp of spans) {
    if (total > maxLen) break;
    if (sp.road < 0) { continue; } // junction link: the next span starts there
    const r = geo.roads[sp.road];
    const dir = sp.s1 >= sp.s0 ? 1 : -1; const L = Math.abs(sp.s1 - sp.s0);
    const hwL = r.hw - (r.park || 0); // (a parking strip is not a lane)
    const off = r.lanes > 1 ? (laneK * hwL) / r.lanes : hwL * 0.5 * Math.min(1, laneK * 2);
    const offK = r.kind === 'alley' || r.width < 7 ? 0.35 : 1;
    const nS = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k <= nS; k++) {
      let s = sp.s0 + (dir * L * k) / nS;
      if (r.closed) { s %= r.len; if (s < 0) s += r.len; }
      geo.sampleRoad(r, s, tmp);
      const tx = tmp.tx * dir; const tz = tmp.tz * dir;
      push(tmp.x - tz * off * offK, tmp.z + tx * off * offK, sp.road);
      if (total > maxLen) break;
    }
  }
  // round the corners where roads join (one Chaikin pass on sharp vertices)
  const n = xs.length;
  const X = out && out.x && out.x.length >= n * 2 ? out.x : new Float64Array(Math.max(4, n * 2));
  const Z = out && out.z && out.z.length >= n * 2 ? out.z : new Float64Array(Math.max(4, n * 2));
  const RR = out && out.road && out.road.length >= n * 2 ? out.road : new Int32Array(Math.max(4, n * 2));
  let m = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && i < n - 1) {
      const ax = xs[i] - xs[i - 1]; const az = zs[i] - zs[i - 1]; const bx = xs[i + 1] - xs[i]; const bz = zs[i + 1] - zs[i];
      const la = Math.hypot(ax, az) || 1; const lb = Math.hypot(bx, bz) || 1;
      const cos = (ax * bx + az * bz) / (la * lb);
      if (cos < 0.9) { // a corner: cut it
        const ka = Math.min(0.45, 3 / la); const kb = Math.min(0.45, 3 / lb);
        X[m] = xs[i] - ax * ka; Z[m] = zs[i] - az * ka; RR[m++] = rs[i];
        X[m] = xs[i] + bx * kb; Z[m] = zs[i] + bz * kb; RR[m++] = rs[i + 1];
        continue;
      }
    }
    X[m] = xs[i]; Z[m] = zs[i]; RR[m++] = rs[i];
  }
  const S = out && out.s && out.s.length >= m ? out.s : new Float64Array(Math.max(4, X.length));
  S[0] = 0; for (let i = 1; i < m; i++) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]);
  const res = out || {};
  res.x = X; res.z = Z; res.s = S; res.road = RR; res.n = m; res.len = m ? S[m - 1] : 0;
  return res;
}
