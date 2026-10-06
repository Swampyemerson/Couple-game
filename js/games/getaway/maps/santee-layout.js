// Santee map: turns the authored data (santee-data.js) into the contract fields: roads (with ramps,
// bridges, cul-de-sacs, footpaths), open ground, solids, water, spawns, landmarks and the height
// field, plus a `deco` record that santee-build.js draws. Deterministic: only prng(seed) is used.
import { prng, clamp, smooth, smoothLine, segD2, polyLen, along, resample, pip, polyBox, ellipse, rectPoly, ribbon, obbHit, Grid } from './santee-util.js';
import { BOUNDS, MAJOR, RIVER, RIVER_HALF, ZONES, COLLECTORS, WESTON, CENTERS, PARKS, SCHOOLS, AIRPORT, LAKES, LAKES_LOOP, POOLS, HILLS } from './santee-data.js';

const PI = Math.PI;
const TRACK_X = 40; // trolley right-of-way runs N-S just east of Cuyamaca St
const WALL = '#d8c3a0'; // tan slump-block wall
const WALL2 = '#c9b28e';

/** Drains the generator synchronously. */
export function makeLayout() {
  const g = layoutSteps();
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/** The layout as a generator: yields between sections so a loader can slice it. */
export function* layoutSteps() {
  const rnd = prng(92071);
  const TT = { t: (typeof performance !== 'undefined' ? performance : Date).now() }; const times = []; const T = (n) => { const t = (typeof performance !== 'undefined' ? performance : Date).now(); times.push([n, Math.round(t - TT.t)]); TT.t = t; };
  const roads = [];
  const open = [];
  const solids = [];
  const water = [];
  const deco = { houses: [], shops: [], bigs: [], signs: [], bulbs: [], stripes: [], walls: [], rocks: [], scrub: [], reeds: [], fields: [], trolley: null, home: null, cats: [], lights: [], rail: [], misc: [] };

  // ── road registry ──────────────────────────────────────────────────────────────────────────────
  const byName = new Map();
  const segGrid = new Grid(50);
  function addRoad(r) {
    r.pts = r.pts.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
    // drop points closer than 8 m (contract), keep the ends
    const p = [r.pts[0]];
    for (let i = 1; i < r.pts.length; i++) {
      const last = p[p.length - 1], q = r.pts[i];
      const isEnd = i === r.pts.length - 1;
      if (Math.hypot(q[0] - last[0], q[1] - last[1]) >= 8) p.push(q);
      else if (isEnd) { if (p.length > 1) p[p.length - 1] = q; else p.push(q); }
    }
    r.pts = p;
    roads.push(r);
    if (!byName.has(r.name)) byName.set(r.name, r);
    indexRoad(r);
    return r;
  }
  /** Clearance queries use the smoothed centre line, as the engine renders it. */
  function indexRoad(r) {
    const sm = smoothLine(r.pts, 8, !!r.closed);
    for (let i = 1; i < sm.length; i++) {
      const [ax, az] = sm[i - 1], [bx, bz] = sm[i];
      segGrid.add({ r, ax, az, bx, bz, hw: r.width / 2 }, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
    }
  }
  /** Distance from (x,z) to the nearest road edge (centre distance - half width). */
  function roadGap(x, z, reach = 60, skip = null) {
    let best = Infinity;
    segGrid.query(x - reach, z - reach, x + reach, z + reach, (s) => {
      if (skip && skip(s.r)) return;
      const d = Math.sqrt(segD2(x, z, s.ax, s.az, s.bx, s.bz)) - s.hw;
      if (d < best) best = d;
    });
    return best;
  }
  function nearestOn(name, x, z) {
    const r = byName.get(name);
    let best = null, bd = Infinity, bs = 0, acc = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, l = Math.sqrt(l2);
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
      const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(qx - x, qz - z);
      if (d < bd) { bd = d; best = [qx, qz]; bs = acc + l * t; }
      acc += l;
    }
    return { p: best, d: bd, s: bs, r };
  }
  /** Where two polylines cross: returns arc length along A of the first crossing, or null. */
  function crossS(A, B) {
    let acc = 0;
    for (let i = 1; i < A.length; i++) {
      const [ax, az] = A[i - 1], [bx, bz] = A[i];
      const l = Math.hypot(bx - ax, bz - az);
      for (let j = 1; j < B.length; j++) {
        const [cx, cz] = B[j - 1], [dx, dz] = B[j];
        const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den;
        const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return acc + t * l;
      }
      acc += l;
    }
    return null;
  }
  /** Sub-polyline between arc lengths s0..s1. */
  function cut(pts, s0, s1) {
    const out = [];
    const a = along(pts, s0); out.push([a.x, a.z]);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc > s0 + 4 && acc < s1 - 4) out.push([pts[i][0], pts[i][1]]);
    }
    const b = along(pts, s1); out.push([b.x, b.z]);
    return out;
  }

  T('1. majors'); yield;
  // ── 1. majors, then collectors snapped onto them, then Weston, lakes loop ────────────────────────
  const majors = MAJOR.map((m) => ({ ...m, pts: m.pts.map((p) => p.slice()) }));
  // Mast Blvd and West Hills Pkwy meet just north of SR-52 (the interchange); move their joint there
  const J = [-3.75 * 400, -0.95 * 400];
  majors.find((m) => m.name === 'Mast Blvd').pts[0] = J.slice();
  majors.find((m) => m.name === 'West Hills Pkwy').pts[0] = J.slice();
  // Cottonwood's south loop joins Magnolia clear of the SR-52 overpass ramp
  const cw = majors.find((m) => m.name === 'Cottonwood Ave');
  cw.pts = [[360, 0], [360, 120], [360, 248], [366, 395], [460, 400], [568, 400]];
  for (const m of majors) addRoad({ ...m, res: m.kind === 'street' });

  for (const [name, width, pts0, sA, sB] of COLLECTORS) {
    const pts = pts0.map((p) => p.slice());
    if (sA && byName.has(sA)) pts[0] = nearestOn(sA, pts[0][0], pts[0][1]).p;
    if (sB && byName.has(sB)) pts[pts.length - 1] = nearestOn(sB, pts[pts.length - 1][0], pts[pts.length - 1][1]).p;
    addRoad({ name, kind: 'street', width, pts, res: true });
  }
  for (const [name, kind, width, pts] of WESTON.roads) addRoad({ name, kind, width, pts: pts.map((p) => p.slice()), res: true, weston: true });
  addRoad({ name: 'Santee Lakes Loop', kind: 'street', width: 8, pts: LAKES_LOOP.map((p) => p.slice()), park: true });
  // Fanita Ranch Rd ends: snap onto the roads it meets
  // Gillespie Field access off Cuyamaca (south of SR-52) and the trolley-square aisles
  addRoad({ name: 'Gillespie Way', kind: 'street', width: 12, pts: [[0, 590], [120, 592], [300, 596], [480, 600], [568, 600]] });
  addRoad({ name: 'Weston Trail', kind: 'dirt', width: 6, pts: [[-1182, -650], [-1160, -640], [-1136, -620], [-1132, -600]] });
  addRoad({ name: 'Lakes Trail', kind: 'dirt', width: 6, pts: [[-1062, -900], [-1100, -880], [-1132, -860], [-1134, -820], [-1133, -790]] });
  addRoad({ name: 'River Trail', kind: 'dirt', width: 6, pts: [[-1462, -548], [-1500, -520], [-1520, -480], [-1530, -440], [-1538, -400]] });

  // ── 2. freeway ramps (diamonds) and the SR-125 connectors ─────────────────────────────────────────
  const rampDefs = [];
  function diamond(fw, art, opts = {}) {
    const F = byName.get(fw), A = byName.get(art);
    const sF = crossS(F.pts, A.pts);
    if (sF == null) return;
    const c = along(F.pts, sF);
    const tx = c.tx, tz = c.tz, nx = -tz, nz = tx; // n = right of travel direction (south for eastbound)
    const hw = F.width / 2;
    for (const side of [1, -1]) {
      // side 1: right-hand (eastbound) carriageway; ramps leave before the crossing, join after it
      for (const on of [false, true]) {
        if (opts.only && !opts.only.includes((side > 0 ? 'R' : 'L') + (on ? 'on' : 'off'))) continue;
        const dir = side > 0 ? 1 : -1; // travel direction along t for this carriageway
        const sgn = on ? dir : -dir; // ramps: off before crossing, on after crossing
        const P = (k, off) => { const a = along(F.pts, clamp(sF + sgn * k, 0, polyLen(F.pts))); return [a.x + nx * side * off, a.z + nz * side * off]; };
        const arterialEnd = nearestOn(art, c.x + nx * side * 96, c.z + nz * side * 96).p;
        const pts = [P(210, hw - 4), P(150, hw + 6), P(100, hw + 16), [c.x + nx * side * 62 + tx * sgn * 40, c.z + nz * side * 62 + tz * sgn * 40], arterialEnd];
        if (on) pts.reverse();
        rampDefs.push({ name: `${fw} ${on ? 'on' : 'off'}-ramp @ ${art}`, kind: 'ramp', width: 8, pts });
      }
    }
  }
  diamond('SR-52', 'Fanita Dr');
  diamond('SR-52', 'Cuyamaca St');
  diamond('SR-52', 'Magnolia Ave');
  // Mast Blvd / West Hills Pkwy junction to SR-52 (west edge)
  {
    const F = byName.get('SR-52');
    const near = nearestOn('SR-52', J[0], J[1]);
    const a1 = along(F.pts, near.s - 120), a2 = along(F.pts, near.s + 120);
    rampDefs.push({ name: 'SR-52 ramp @ Mast Blvd W', kind: 'ramp', width: 9, pts: [[a1.x + 6, a1.z - 12], [J[0] - 50, J[1] + 30], [J[0] - 12, J[1] + 6], J.slice()] });
    rampDefs.push({ name: 'SR-52 ramp @ Mast Blvd E', kind: 'ramp', width: 9, pts: [J.slice(), [J[0] + 30, J[1] + 22], [a2.x - 30, a2.z - 30], [a2.x - 2, a2.z - 14]] });
  }
  // SR-125 <-> SR-52 east connectors
  {
    const s125 = byName.get('SR-125');
    const F = byName.get('SR-52');
    const jn = nearestOn('SR-52', -860, 180);
    const e = along(F.pts, jn.s + 230);
    rampDefs.push({ name: 'SR-125 / SR-52 connector', kind: 'ramp', width: 10, pts: [[-858, 330], [-846, 286], [-822, 252], [-780, 232], [e.x - 40, e.z - 4], [e.x, e.z + 6]] });
    const w = along(F.pts, jn.s - 230);
    rampDefs.push({ name: 'SR-52 / SR-125 connector', kind: 'ramp', width: 10, pts: [[w.x, w.z + 8], [w.x + 60, w.z + 30], [-900, 232], [-878, 270], [-870, 330]] });
    void s125;
  }
  for (const r of rampDefs) addRoad(r);

  // ── 3. bridges: split roads over the river and over the freeways ───────────────────────────────
  const bridgeSpans = []; // [roadName, s0, s1, clear]
  const riverLine = RIVER;
  for (const name of ['Cuyamaca St', 'Magnolia Ave', 'Carlton Hills Blvd', 'SR-67']) {
    const r = byName.get(name);
    const s = crossS(r.pts, riverLine);
    if (s != null) bridgeSpans.push([r, s - 58, s + 58, 3]);
  }
  for (const name of ['Fanita Dr', 'Cuyamaca St', 'Magnolia Ave', 'SR-125']) {
    const r = byName.get(name);
    const s = crossS(r.pts, byName.get('SR-52').pts);
    if (s != null) bridgeSpans.push([r, s - 74, s + 74, 6]);
  }
  {
    // SR-52 flies over the river and Mission Gorge Rd on one long viaduct at the gorge mouth
    const F = byName.get('SR-52');
    const s1 = crossS(F.pts, riverLine), s2 = crossS(F.pts, byName.get('Mission Gorge Rd').pts);
    if (s1 != null && s2 != null) bridgeSpans.push([F, Math.min(s1, s2) - 70, Math.max(s1, s2) + 70, 6]);
  }
  // split from the far end first, so the head piece keeps the original arc lengths for earlier spans
  bridgeSpans.sort((a, b) => b[1] - a[1]);
  const head = new Map(); // original road -> its current head piece
  for (const [r0, s0, s1, clear] of bridgeSpans) {
    const r = head.get(r0) || r0;
    const L = polyLen(r.pts);
    const i = roads.indexOf(r);
    if (i < 0) continue;
    const pieces = [];
    if (s0 > 10) pieces.push({ ...r, pts: cut(r.pts, 0, s0) });
    pieces.push({ ...r, pts: cut(r.pts, s0, Math.min(s1, L)), bridge: true, clear });
    if (s1 < L - 10) pieces.push({ ...r, pts: cut(r.pts, s1, L) });
    roads.splice(i, 1, ...pieces);
    if (s0 > 10) head.set(r0, pieces[0]);
  }
  // re-index segments with the split pieces (bridge flags now visible to queries)
  segGrid.m.clear();
  for (const r of roads) indexRoad(r);

  T('4. height fiel'); yield;
  // ── 4. height field ────────────────────────────────────────────────────────────────────────────
  const zonePolys = ZONES.map((z) => z.poly).concat(PARKS.map((p) => p.poly), [AIRPORT.poly], CENTERS.map((c) => centerPoly(c)), SCHOOLS.map((s) => rectPoly(s.x, s.z, s.w, s.d, schoolRot(s))));
  const lakePolys = LAKES.map((l) => ellipse(l.cx, l.cz, l.rx, l.rz, 20, l.rot));
  const poolPolys = POOLS.filter((p) => p.rx > 0).map((p) => ellipse(p.cx, p.cz, p.rx, p.rz, 14, p.rot));
  const lakeBoxes = lakePolys.map(polyBox);
  const HG = 8;
  const gx0 = BOUNDS.x0 - 40, gz0 = BOUNDS.z0 - 40;
  const gw = Math.ceil((BOUNDS.x1 - BOUNDS.x0 + 80) / HG) + 1, gh = Math.ceil((BOUNDS.z1 - BOUNDS.z0 + 80) / HG) + 1;
  const H = new Float32Array(gw * gh);
  const riverGrid = new Grid(60);
  for (let i = 1; i < RIVER.length; i++) { const [ax, az] = RIVER[i - 1], [bx, bz] = RIVER[i]; riverGrid.add([ax, az, bx, bz], Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)); }
  const RS = [];
  for (let i = 1; i < RIVER.length; i++) RS.push(RIVER[i - 1][0], RIVER[i - 1][1], RIVER[i][0], RIVER[i][1]);
  function riverDist(x, z) {
    let best = Infinity;
    for (let k = 0; k < RS.length; k += 4) {
      const ax = RS[k], az = RS[k + 1], bx = RS[k + 2], bz = RS[k + 3];
      if (x < Math.min(ax, bx) - 200 || x > Math.max(ax, bx) + 200) continue;
      const d = segD2(x, z, ax, az, bx, bz); if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  const zoneBoxes = zonePolys.map(polyBox);
  function inZone(x, z, pad = 0) {
    for (let i = 0; i < zonePolys.length; i++) {
      const b = zoneBoxes[i];
      if (x < b.x0 - pad || x > b.x1 + pad || z < b.z0 - pad || z > b.z1 + pad) continue;
      if (pip(zonePolys[i], x, z)) return true;
    }
    return false;
  }
  const lakeAll = polyBox(lakePolys.flat()), poolBoxes = poolPolys.map(polyBox);
  function inWater(x, z) {
    if (!(x > lakeAll.x0 && x < lakeAll.x1 && z > lakeAll.z0 && z < lakeAll.z1)) {
      for (let i = 0; i < poolPolys.length; i++) { const b = poolBoxes[i]; if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && pip(poolPolys[i], x, z)) return 'pool'; }
      return null;
    }
    for (let i = 0; i < lakePolys.length; i++) { const b = lakeBoxes[i]; if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && pip(lakePolys[i], x, z)) return 'lake'; }
    for (const p of poolPolys) if (pip(p, x, z)) return 'pool';
    return null;
  }
  const hillRaw = (x, z) => {
    let h = 0;
    for (const [cx, cz, rx, rz, a] of HILLS) {
      const u = (x - cx) / rx, v = (z - cz) / rz, q = u * u + v * v;
      if (q < 4) h += a * Math.exp(-q * 1.6);
    }
    // ridges and gullies
    h *= 0.8 + 0.25 * Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2) * Math.cos(z * 0.017 - x * 0.006);
    // the outer rim rises toward the invisible wall
    const e = Math.min(x - BOUNDS.x0, BOUNDS.x1 - x, z - BOUNDS.z0, BOUNDS.z1 - z);
    h += 22 * (1 - smooth(0, 90, e));
    return h;
  };
  // the road/zone mask is smooth, so it is sampled on a coarser 24 m grid and interpolated
  const MG = 24, mw = Math.ceil((gw * HG) / MG) + 2, mh = Math.ceil((gh * HG) / MG) + 2;
  const MASK = new Float32Array(mw * mh);
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
    const x = gx0 + i * MG, z = gz0 + j * MG;
    let m = 1;
    if (inZone(x, z, 0)) m = 0;
    else {
      const rg = roadGap(x, z, 60, (r) => r.bridge && r.clear === 3);
      m = smooth(10, 60, rg);
      if (m > 0 && inZone(x, z, 30)) m *= 0.35;
    }
    MASK[j * mw + i] = m;
  }
  T('mask'); yield;
  const maskAt = (x, z) => {
    const fx = (x - gx0) / MG, fz = (z - gz0) / MG;
    const i = clamp(Math.floor(fx), 0, mw - 2), j = clamp(Math.floor(fz), 0, mh - 2), u = fx - i, v = fz - j;
    return (MASK[j * mw + i] * (1 - u) + MASK[j * mw + i + 1] * u) * (1 - v) + (MASK[(j + 1) * mw + i] * (1 - u) + MASK[(j + 1) * mw + i + 1] * u) * v;
  };
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = gx0 + i * HG, z = gz0 + j * HG;
    let h = 0;
    const rd = riverDist(x, z);
    let m = maskAt(x, z) * smooth(RIVER_HALF + 4, RIVER_HALF + 50, rd);
    if (m > 0.02 && maskAt(x, z) < 0.999) { const rg = m < 0.6 ? roadGap(x, z, 20) : 99; if (rg < 14) m = 0; }
    if (m > 0) h = hillRaw(x, z) * m;
    // riverbed: a shallow sandy trench
    if (rd < RIVER_HALF + 6) h -= 1.6 * smooth(RIVER_HALF + 6, RIVER_HALF - 6, rd);
    const w = inWater(x, z);
    if (w === 'lake') h = -2.2; else if (w === 'pool') h = -2.6;
    H[j * gw + i] = h;
  }
  // lake shores slope gently: one blur pass around water
  const height = (x, z) => {
    const fx = (x - gx0) / HG, fz = (z - gz0) / HG;
    const i = clamp(Math.floor(fx), 0, gw - 2), j = clamp(Math.floor(fz), 0, gh - 2);
    const u = clamp(fx - i, 0, 1), v = clamp(fz - j, 0, 1);
    const a = H[j * gw + i], b = H[j * gw + i + 1], c = H[(j + 1) * gw + i], d = H[(j + 1) * gw + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };

  T('5. cul-de-sacs'); yield;
  // ── 5. cul-de-sacs sprouting from collectors ───────────────────────────────────────────────────
  const zoneOf = (x, z) => ZONES.find((zz) => pip(zz.poly, x, z)) || null;
  const railGap = (x) => Math.abs(x - TRACK_X) - 4;
  const culs = [];
  const sproutFrom = roads.filter((r) => r.res && !r.weston && r.name !== 'Mobile Home Way' && r.name !== 'Fanita Dr');
  let culN = 0;
  const culNames = ['Ct', 'Pl', 'Cir', 'Way'];
  const treeNames = ['Sage', 'Manzanita', 'Laurel', 'Oak Glen', 'Wren', 'Quail', 'Sumac', 'Agave', 'Cholla', 'Rancho', 'Vista', 'Mesa', 'Sierra', 'Canyon', 'Arbor', 'Willow', 'Juniper', 'Coyote', 'Hawk', 'Buckeye', 'Pepper', 'Olive', 'Citrus', 'Avocado', 'Lemon', 'Orchard', 'Sunrise', 'Sunset', 'Starlight', 'Shadow', 'Ridge', 'Meadow', 'Brook', 'Stone', 'Granite', 'Cobble', 'Pebble', 'Adobe', 'Mission', 'Padre', 'Cuyama', 'Kumeyaay'];
  for (const par of sproutFrom) {
    const L = polyLen(par.pts);
    for (let s = 46 + rnd() * 20; s < L - 46; s += 64 + rnd() * 34) {
      for (const side of [1, -1]) {
        if (rnd() < 0.18) continue;
        const a = along(par.pts, s);
        let dx = -a.tz * side, dz = a.tx * side;
        const bend = (rnd() - 0.5) * 0.5;
        const len = 70 + rnd() * 70;
        const pts = [[a.x, a.z]];
        let ok = 0;
        let x = a.x, z = a.z, ang = Math.atan2(dz, dx);
        for (let k = 1; k <= Math.floor(len / 12); k++) {
          ang += bend * 0.15;
          x += Math.cos(ang) * 12; z += Math.sin(ang) * 12;
          const zone = zoneOf(x, z);
          const gap = roadGap(x, z, 70, (r) => r === par);
          const cul0 = roadGap(x, z, 70, (r) => !r.cul);
          if (!zone || zone.style === 'mobile' || inWater(x, z) || riverDist(x, z) < RIVER_HALF + 30 || railGap(x) < 30) break;
          if (k * 12 > 24 && gap < 36) break;
          if (cul0 < 0) break;
          if (height(x, z) > 0.4) break;
          pts.push([x, z]); ok = k;
        }
        if (ok * 12 < 48) continue;
        // keep a ring free for the bulb
        const end = pts[pts.length - 1];
        if (roadGap(end[0], end[1], 70, (r) => r === par) < 40) { pts.pop(); if (pts.length < 5) continue; }
        culN++;
        const nm = `${treeNames[culN % treeNames.length]} ${culNames[(culN * 7) % culNames.length]}`;
        const r = addRoad({ name: nm, kind: 'street', width: 9, pts, res: true, cul: true, parent: par });
        culs.push(r);
      }
    }
  }
  // Weston's own short courts get bulbs too
  for (const nm of ['Toyon Pl', 'Boulder Way', 'Sandstone Ct', 'Talus Ct', 'Lake Canyon Rd', 'Riverpark Dr', 'Magnolia Hills Dr', 'Olive Ln']) {
    const r = byName.get(nm); if (r) { r.cul = true; culs.push(r); }
  }
  for (const r of culs) {
    const e = r.pts[r.pts.length - 1];
    const poly = ellipse(e[0], e[1], 13, 13, 14);
    open.push({ kind: 'lot', poly });
    deco.bulbs.push({ x: e[0], z: e[1], r: 13 });
  }

  // ── 6. escape paths from cul-de-sac ends ───────────────────────────────────────────────────────
  let paths = 0;
  for (const r of culs) {
    const e = r.pts[r.pts.length - 1];
    const prev = r.pts[r.pts.length - 2];
    let best = null;
    segGrid.query(e[0] - 110, e[1] - 110, e[0] + 110, e[1] + 110, (s) => {
      if (s.r === r || s.r === r.parent || s.r.kind === 'highway' || s.r.kind === 'ramp' || s.r.bridge) return;
      const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz;
      const t = clamp(((e[0] - s.ax) * dx + (e[1] - s.az) * dz) / l2, 0, 1);
      const qx = s.ax + dx * t, qz = s.az + dz * t;
      const d = Math.hypot(qx - e[0], qz - e[1]);
      // must lead roughly onward (not back along the cul-de-sac)
      const fwd = ((qx - e[0]) * (e[0] - prev[0]) + (qz - e[1]) * (e[1] - prev[1])) / (d * Math.hypot(e[0] - prev[0], e[1] - prev[1]) + 1e-6);
      if (fwd < -0.2) return;
      if (d > 15 && d < 105 && (!best || d < best.d)) best = { d, q: [qx, qz] };
    });
    if (!best) continue;
    // check the straight line stays dry, flat and off the rail
    let clear = true;
    const n = Math.ceil(best.d / 8);
    for (let k = 1; k < n; k++) {
      const x = e[0] + ((best.q[0] - e[0]) * k) / n, z = e[1] + ((best.q[1] - e[1]) * k) / n;
      if (inWater(x, z) || height(x, z) > 1.5 || railGap(x) < 2 || riverDist(x, z) < RIVER_HALF) { clear = false; break; }
    }
    if (!clear) continue;
    const pts = [e];
    for (let k = 1; k <= n; k++) pts.push([e[0] + ((best.q[0] - e[0]) * k) / n, e[1] + ((best.q[1] - e[1]) * k) / n]);
    addRoad({ name: `${r.name} path`, kind: 'alley', width: 5, pts, path: true });
    r.escape = true;
    paths++;
  }
  deco.stats = { culs: culs.length, paths };

  T('7. solids help'); yield;
  // ── 7. solids helpers ──────────────────────────────────────────────────────────────────────────
  const solidGrid = new Grid(40);
  function blocked(o, pad = 1) {
    let hit = false;
    const r = Math.hypot(o.w, o.d) / 2 + pad + 2;
    solidGrid.query(o.x - r - 20, o.z - r - 20, o.x + r + 20, o.z + r + 20, (w) => { if (obbHit(o, w.s, pad)) { hit = true; return false; } });
    return hit;
  }
  function addSolid(s) {
    solids.push(s);
    const r = Math.hypot(s.w, s.d) / 2;
    solidGrid.add({ s }, s.x - r, s.z - r, s.x + r, s.z + r);
    return s;
  }
  const corners = (o, grow = 0) => rectPoly(o.x, o.z, o.w + grow, o.d + grow, o.rot);
  function clearOfRoads(o, margin) {
    const pts = corners(o).concat([[o.x, o.z]]);
    // also edge midpoints
    const c = corners(o);
    for (let i = 0; i < 4; i++) pts.push([(c[i][0] + c[(i + 1) % 4][0]) / 2, (c[i][1] + c[(i + 1) % 4][1]) / 2]);
    for (const [x, z] of pts) {
      const g = roadGap(x, z, Math.max(20, margin + 16));
      if (g < margin) return false;
    }
    return true;
  }
  // engine-drawn props never stand inside a (smoothed) road ribbon
  const prop = (kind, style, x, z, h, color, sz = 0.8) => (roadGap(x, z, 30, (r) => r.bridge) < 0.4 ? null : addSolid({ kind, style, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, w: sz, d: sz, rot: 0, h, color }));
  const TREES = [
    ['palm', '#5f8a3a', 14, 0.7], ['palm', '#6a9440', 17, 0.7], ['jacaranda', '#9a7fd6', 7.5, 0.9], ['jacaranda', '#a58ae0', 6.5, 0.9],
    ['cottonwood', '#7a9a4a', 9, 1.0], ['pine', '#4f7a4a', 11, 1.0], ['shrub', '#7f9654', 2.2, 1.4],
  ];
  const pickTree = (bias) => {
    const r = rnd();
    if (r < bias.palm) return TREES[rnd() < 0.6 ? 0 : 1];
    if (r < bias.palm + bias.jac) return TREES[rnd() < 0.5 ? 2 : 3];
    if (r < bias.palm + bias.jac + 0.15) return TREES[5];
    if (r < bias.palm + bias.jac + 0.23) return TREES[6];
    return TREES[4];
  };
  const addTree = (x, z, bias = { palm: 0.3, jac: 0.25 }, scale = 1) => {
    const t = pickTree(bias);
    const o = { x, z, w: t[3], d: t[3], rot: 0 };
    if (blocked(o, 0.6)) return null;
    return prop(t[0] === 'shrub' ? 'shrub' : 'tree', t[0], x, z, Math.round(t[2] * scale * (0.85 + rnd() * 0.3) * 10) / 10, t[1], t[3]);
  };

  // ── 8. commercial centres ──────────────────────────────────────────────────────────────────────
  function centerRot(c) {
    if (c.rotTo) { const n = nearestOn(c.rotTo, c.x, c.z); const a = along(n.r.pts, n.s); return Math.atan2(-a.tz, a.tx) + (c.face === 'S' ? 0 : PI); }
    return c.face === 'S' ? 0 : PI;
  }
  function centerPoly(c) { return rectPoly(c.x, c.z, c.w, c.d, centerRot(c)); }
  function schoolRot(s) { if (s.rotTo) { const n = nearestOn(s.rotTo, s.x, s.z); const a = along(n.r.pts, n.s); return Math.atan2(-a.tz, a.tx); } return s.rot || 0; }
  // local frame helper: u = along street (local +x), v = away from street (local -z for face S?)
  function frame(x, z, rot) { const c = Math.cos(rot), s = Math.sin(rot); return (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz]; }

  for (const c of CENTERS) {
    const rot = centerRot(c);
    const F = frame(c.x, c.z, rot);
    // local +z points to the street when face is 'S' with rot 0 (street is to the south, +z)
    const back = -c.d / 2; // far side from the street
    open.push({ kind: 'lot', poly: centerPoly(c) });
    deco.lots = deco.lots || [];
    deco.lots.push({ x: c.x, z: c.z, w: c.w, d: c.d, rot, stripes: !c.storage });
    if (c.big) {
      const bw = c.w * 0.72, bd = 46;
      const [bx, bz] = F(0, back + bd / 2 + 4);
      const b = addSolid({ kind: 'building', x: bx, z: bz, w: bw, d: bd, rot, h: 11, drawn: true });
      deco.bigs.push({ ...b, sign: c.shops[0], color: '#e9dcc4', trim: '#2d6fa8' });
      continue;
    }
    if (c.storage) {
      for (let k = 0; k < 4; k++) {
        const [bx, bz] = F(0, back + 10 + k * 20);
        const b = addSolid({ kind: 'building', x: bx, z: bz, w: c.w * 0.86, d: 9, rot, h: 3.4, drawn: true });
        deco.shops.push({ ...b, color: '#efe7d8', roof: '#c4583a', trim: '#c4583a', sign: k === 3 ? c.shops[0] : null, storage: true });
      }
      continue;
    }
    // inline strip along the back, gas station / pad on the street corner
    const shops = c.shops.filter((s) => s !== 'GAS');
    const gas = c.shops.includes('GAS');
    const usable = c.w - (gas ? 70 : 10);
    const x0 = -c.w / 2 + (gas && c.x > 0 ? 66 : 6);
    const sw = usable / Math.max(1, shops.length);
    const depth = Math.min(22, c.d * 0.3);
    shops.forEach((name, k) => {
      const lx = x0 + sw * (k + 0.5);
      const [bx, bz] = F(lx, back + depth / 2 + 3);
      const h = 6 + (k % 3 === 1 ? 1.5 : 0);
      if (!clearOfRoads({ x: bx, z: bz, w: sw - 1, d: depth, rot }, 1.5)) return;
      const b = addSolid({ kind: 'building', x: bx, z: bz, w: sw - 1, d: depth, rot, h, drawn: true });
      const pal = [['#ecdcc0', '#b5472f'], ['#f1e6d2', '#2f7f7a'], ['#e7cfa8', '#7a4b9a'], ['#f3ead8', '#c46a2a']][k % 4];
      deco.shops.push({ ...b, color: pal[0], trim: pal[1], sign: name, tile: k % 2 === 0 });
    });
    if (gas) {
      const lx = c.x > 0 ? -c.w / 2 + 34 : c.w / 2 - 34;
      const [gx, gz] = F(lx, c.d / 2 - 30);
      const can = addSolid({ kind: 'building', x: gx, z: gz, w: 26, d: 14, rot, h: 5.6, drawn: true, canopy: true });
      deco.misc.push({ type: 'canopy', ...can });
      // pumps under the canopy are bollards
      for (const px of [-7, 0, 7]) { const [qx, qz] = F(lx + px, c.d / 2 - 30); prop('bollard', 'bollard', qx, qz, 1.6, '#d9483b', 0.9); }
      const [kx, kz] = F(lx, back + 14);
      const kiosk = addSolid({ kind: 'building', x: kx, z: kz, w: 14, d: 10, rot, h: 4.5, drawn: true });
      deco.shops.push({ ...kiosk, color: '#f4f0e6', trim: '#d9483b', sign: 'GAS' });
      // the price sign by the street
      const [sx, sz] = F(c.x > 0 ? -c.w / 2 + 6 : c.w / 2 - 6, c.d / 2 - 4);
      prop('sign', 'sign', sx, sz, 6, '#d9483b', 0.6);
    }
    // lot light poles
    for (let lx = -c.w / 2 + 30; lx < c.w / 2 - 20; lx += 46) {
      const [px, pz] = F(lx, 6);
      prop('pole', 'lamp', px, pz, 9, '#6d6f73', 0.5);
    }
    // a couple of palms at the entrances
    for (const lx of [-c.w / 2 + 8, c.w / 2 - 8]) { const [px, pz] = F(lx, c.d / 2 - 4); addTree(px, pz, { palm: 1, jac: 0 }, 1.1); }
    if (c.trolley) deco.trolleyCenter = { x: c.x, z: c.z, rot };
  }

  // ── 9. the trolley: tracks, platform, the red cars, the viaduct over SR-52 ──────────────────────
  {
    const zTop = -118, zMG = 0, zBot = BOUNDS.z1;
    deco.rail = { x: TRACK_X, z0: zTop, z1: zBot };
    // track bed is drivable dirt (you can bump along the ballast) except on the viaduct
    open.push({ kind: 'dirt', poly: [[TRACK_X - 4, zTop], [TRACK_X + 4, zTop], [TRACK_X + 4, 420], [TRACK_X - 4, 420]] });
    // platform: a long low solid with a canopy
    const plat = addSolid({ kind: 'building', x: TRACK_X + 8.5, z: -70, w: 6, d: 80, rot: 0, h: 1.0, drawn: true });
    deco.trolley = { platform: plat, cars: [] };
    // two coupled red LRVs parked at the platform (solid)
    for (const [k, cz] of [[0, -88], [1, -59]]) {
      const car = addSolid({ kind: 'building', x: TRACK_X, z: cz, w: 3, d: 27, rot: 0, h: 3.9, drawn: true });
      deco.trolley.cars.push({ ...car, k });
    }
    // buffer stop
    addSolid({ kind: 'barrier', x: TRACK_X, z: zTop - 2, w: 4, d: 1.2, rot: 0, h: 1.3, drawn: true });
    deco.trolley.buffer = { x: TRACK_X, z: zTop - 2 };
    // catenary poles every 40 m (breakable)
    for (let z = zTop + 10; z < zBot; z += 40) {
      if (z > 440 && z < 560) continue; // viaduct
      if (Math.abs(z - zMG) < 16 || Math.abs(z - 248) < 12 || Math.abs(z - 162) < 10 || Math.abs(z - 362) < 10) continue;
      prop('pole', 'pole', TRACK_X + 4.5, z, 7.5, '#5d6066', 0.4);
    }
    // viaduct piers either side of the freeway (drawn)
    for (const pz of [454, 508]) addSolid({ kind: 'building', x: TRACK_X, z: pz, w: 4, d: 3, rot: 0, h: 7, drawn: true });
    deco.trolley.viaduct = { z0: 430, z1: 570, y: 7.2 };
  }

  // ── 10. schools, parks, airport ────────────────────────────────────────────────────────────────
  for (const s of SCHOOLS) {
    const rot = schoolRot(s);
    const F = frame(s.x, s.z, rot);
    open.push({ kind: 'lot', poly: rectPoly(...F(-s.w / 4, -s.d / 2 + 22), s.w / 2 - 4, 40, rot) });
    open.push({ kind: 'grass', poly: rectPoly(...F(s.w / 4, 0), s.w / 2 - 6, s.d - 10, rot) });
    deco.fields.push({ x: F(s.w / 4, 0)[0], z: F(s.w / 4, 0)[1], w: s.w / 2 - 6, d: s.d - 10, rot, track: true, color: s.color });
    // classroom wings
    for (const [lx, lz, w, d] of [[-s.w / 4, 10, s.w / 2 - 14, 18], [-s.w / 4 - 20, 44, 40, 22], [-s.w / 4 + 24, 44, 30, 22]]) {
      const [bx, bz] = F(lx, lz);
      const b = addSolid({ kind: 'building', x: bx, z: bz, w, d, rot, h: 7, drawn: true });
      deco.shops.push({ ...b, color: '#e8dcc6', trim: s.color, sign: lx === -s.w / 4 ? s.name.toUpperCase() : null, school: true });
    }
    // stadium lights
    for (const [lx, lz] of [[s.w / 4 - 40, -s.d / 2 + 8], [s.w / 4 + 40, -s.d / 2 + 8], [s.w / 4 - 40, s.d / 2 - 8], [s.w / 4 + 40, s.d / 2 - 8]]) { const [px, pz] = F(lx, lz); prop('pole', 'lamp', px, pz, 16, '#7a7d82', 0.6); }
  }
  for (const p of PARKS) {
    open.push({ kind: 'grass', poly: p.poly });
    if (p.fields) {
      const b = polyBox(p.poly);
      deco.fields.push({ x: (b.x0 + b.x1) / 2 - 90, z: (b.z0 + b.z1) / 2, w: 110, d: 70, rot: 0, color: '#2f7f7a' });
      deco.fields.push({ x: (b.x0 + b.x1) / 2 + 80, z: (b.z0 + b.z1) / 2, w: 110, d: 70, rot: 0, color: '#2f7f7a' });
      for (let x = b.x0 + 20; x < b.x1; x += 60) { prop('pole', 'lamp', x, b.z0 + 6, 14, '#7a7d82', 0.5); prop('pole', 'lamp', x, b.z1 - 6, 14, '#7a7d82', 0.5); }
    }
    const b = polyBox(p.poly);
    const n = Math.floor(((b.x1 - b.x0) * (b.z1 - b.z0)) / (p.golf ? 2000 : 2800));
    for (let k = 0; k < n; k++) {
      const x = b.x0 + rnd() * (b.x1 - b.x0), z = b.z0 + rnd() * (b.z1 - b.z0);
      if (!pip(p.poly, x, z) || roadGap(x, z) < 4 || inWater(x, z)) continue;
      if (p.fields && Math.abs(z - (b.z0 + b.z1) / 2) < 40) continue;
      addTree(x, z, p.golf ? { palm: 0.35, jac: 0.1 } : { palm: 0.25, jac: 0.3 });
    }
  }
  open.push({ kind: 'lot', poly: AIRPORT.poly });
  deco.airport = AIRPORT;
  for (let k = 0; k < 5; k++) {
    const hx = 100 + k * 115, hz = 626;
    const b = addSolid({ kind: 'building', x: hx, z: hz, w: 70, d: 24, rot: PI, h: 9, drawn: true });
    deco.bigs.push({ ...b, hangar: true, color: '#dfe2e2', trim: '#3e6f97', sign: k === 2 ? 'GILLESPIE FIELD' : null });
  }
  for (let k = 0; k < 7; k++) deco.misc.push({ type: 'plane', x: 70 + k * 80, z: 588 + (k % 2) * 6, rot: (k % 3) * 0.4 - 0.4 });
  for (let k = 0; k < 7; k++) addSolid({ kind: 'barrier', x: 70 + k * 80, z: 588 + (k % 2) * 6, w: 8, d: 7, rot: (k % 3) * 0.4 - 0.4, h: 2, drawn: true });

  // ── 11. Santee Lakes ───────────────────────────────────────────────────────────────────────────
  for (const p of lakePolys) water.push({ poly: p.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]) });
  deco.lakePark = [[-905, -520], [-1072, -525], [-1078, -1150], [-905, -1150]];
  // no open poly here: default ground is grass, and an open poly would hide the lakes' water
  deco.lakes = lakePolys;
  for (let k = 0; k < 80; k++) {
    const x = -1072 + rnd() * 165, z = -1145 + rnd() * 620;
    if (inWater(x, z) || roadGap(x, z) < 3) continue;
    let nearLake = false;
    for (const p of lakePolys) { const b = polyBox(p); if (x > b.x0 - 14 && x < b.x1 + 14 && z > b.z0 - 14 && z < b.z1 + 14) nearLake = true; }
    if (nearLake && rnd() < 0.5) continue;
    addTree(x, z, { palm: 0.2, jac: 0.05 }, 1.05);
  }
  // campground RVs at the north end
  for (let k = 0; k < 8; k++) {
    const x = -935 - (k % 2) * 12, z = -1100 + Math.floor(k / 2) * 16;
    if (roadGap(x, z) < 3) continue;
    const b = addSolid({ kind: 'building', x, z, w: 3, d: 9, rot: 0.2, h: 3.4, drawn: true });
    deco.misc.push({ type: 'rv', ...b });
  }

  // ── 12. river: sand, pools, reeds and cottonwoods ──────────────────────────────────────────────
  {
    const pts = resample(RIVER, 20);
    for (let i = 0; i < pts.length - 1; i += 6) {
      const seg = pts.slice(i, Math.min(pts.length, i + 7));
      if (seg.length < 2) break;
      open.push({ kind: 'sand', poly: ribbon(seg, (k) => RIVER_HALF + 2 * Math.sin((i + k) * 1.7)) });
    }
    for (const p of poolPolys) water.push({ poly: p.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]) });
    deco.pools = poolPolys;
    const L = polyLen(RIVER);
    for (let s = 10; s < L; s += 6) {
      const a = along(RIVER, s);
      for (const side of [-1, 1]) {
        const off = side * (RIVER_HALF - 2 - rnd() * 8);
        const x = a.x - a.tz * off, z = a.z + a.tx * off;
        if (roadGap(x, z) < 6 || inWater(x, z)) continue;
        if (rnd() < 0.8) deco.reeds.push([x, z, 1.4 + rnd() * 1.8]);
        else if (rnd() < 0.08) { const o = { x: x + side * 4, z, w: 1.1, d: 1.1, rot: 0 }; if (!blocked(o, 0.6)) prop('tree', rnd() < 0.8 ? 'cottonwood' : 'palm', o.x, z, rnd() < 0.8 ? 9 + rnd() * 3 : 13, rnd() < 0.5 ? '#86a24e' : '#7a9a4a', 1.1); }
      }
      // a few islands of willow in the channel: obstacles to weave through
      if (rnd() < 0.05) { const x = a.x + (rnd() - 0.5) * 14, z = a.z + (rnd() - 0.5) * 14; if (roadGap(x, z) > 8 && !inWater(x, z)) prop('tree', 'cottonwood', x, z, 8 + rnd() * 3, '#86a24e', 1.2); }
    }
  }

  T('13. houses'); yield;
  // ── 13. houses ─────────────────────────────────────────────────────────────────────────────────
  const WALLS = ['#efe0c4', '#e3c9a0', '#f0c8a4', '#f4efe6', '#d6b98f', '#e6ddd0', '#e8b494', '#f2d9b0', '#dcd2bf'];
  const ROOFS = ['#c8623e', '#b9532f', '#d4774a', '#c8623e', '#a9502f', '#7d7a78', '#8a6a55', '#6f6d6b'];
  const PRISM_WALLS = ['#f4f2ee', '#e9e6e0', '#d9d6cf', '#c9c4ba', '#f2efe8'];
  const PRISM_ROOFS = ['#3d4146', '#4a4e54', '#5a5550'];
  const artNames = new Set(MAJOR.filter((m) => m.kind !== 'dirt').map((m) => m.name));
  const busy = (r) => r.kind === 'highway' || r.kind === 'ramp' || (artNames.has(r.name) && r.kind === 'arterial');
  const houseRoads = roads.filter((r) => r.res);
  // Boulder Way first, so its numbers are exact
  houseRoads.sort((a, b) => (b.name === 'Boulder Way') - (a.name === 'Boulder Way'));
  const homeList = [];
  for (const r of houseRoads) {
    const L = polyLen(r.pts);
    const prism = !!r.weston;
    const mobile = r.name === 'Mobile Home Way';
    const isBoulder = r.name === 'Boulder Way';
    const sides = isBoulder ? [-1] : [1, -1]; // Boulder Way: even numbers on the west side only
    for (const side of sides) {
      let s = isBoulder ? 12 : 10 + rnd() * 6;
      let num = WESTON.boulderFirst;
      while (s < L - (r.cul ? 6 : 10)) {
        const a = along(r.pts, s);
        const nx = -a.tz * side, nz = a.tx * side; // outward normal on this side
        const w = mobile ? 5 : prism ? 9 : 12 + rnd() * 3;
        const d = mobile ? 15 : prism ? 13 : 12 + rnd() * 3;
        const setback = mobile ? 3 : prism ? 5.5 : 7 + rnd() * 2;
        const off = r.width / 2 + setback + d / 2;
        const x = a.x + nx * off, z = a.z + nz * off;
        // house local +x along the street; local +z away from the street
        const rot = Math.atan2(nz, -nx) - PI / 2 + PI / 2; // local +z = (nx, nz)
        const o = { x, z, w, d, rot: Math.atan2(-a.tz * 1, a.tx) + (side > 0 ? 0 : PI) };
        void rot;
        const step = mobile ? 9 : prism ? 10.3 : w + 3 + rnd() * 3;
        const z0 = zoneOf(x, z);
        const okZone = z0 && (mobile ? z0.style === 'mobile' : z0.style !== 'mobile');
        if (okZone && !inWater(x, z) && clearOfRoads(o, 2.5) && !blocked(o, prism ? 1.2 : 2.5) && railGap(x) > 6 + w && riverDist(x, z) > RIVER_HALF + 14) {
          let flat = true;
          for (const [cx, cz] of corners(o)) if (Math.abs(height(cx, cz)) > 0.35) { flat = false; break; }
          if (flat) {
            const twoStory = prism ? true : rnd() < 0.33;
            const hh = mobile ? 3.4 : twoStory ? 7 : 4.3;
            const b = addSolid({ kind: 'building', x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, w, d, rot: o.rot, h: hh, drawn: true });
            const rec = {
              ...b, stories: twoStory ? 2 : 1, style: prism ? 'prism' : mobile ? 'mobile' : 'ranch',
              wall: prism ? PRISM_WALLS[Math.floor(rnd() * PRISM_WALLS.length)] : mobile ? '#eef0ea' : WALLS[Math.floor(rnd() * WALLS.length)],
              roof: prism ? PRISM_ROOFS[Math.floor(rnd() * PRISM_ROOFS.length)] : mobile ? '#b8bcbf' : ROOFS[Math.floor(rnd() * ROOFS.length)],
              gable: prism ? rnd() < 0.7 : rnd() < 0.3, garage: rnd() < 0.5 ? -1 : 1, street: [a.x, a.z], num: isBoulder ? num : null,
            };
            deco.houses.push(rec);
            if (isBoulder) homeList.push(rec);
            // front yard tree / back yard palm
            if (!mobile) {
              if (rnd() < 0.4) {
                const tx = x - nx * (d / 2 + setback * 0.55) + a.tx * (w / 2 - 1.2) * rec.garage * -1, tz = z - nz * (d / 2 + setback * 0.55) + a.tz * (w / 2 - 1.2) * rec.garage * -1;
                if (roadGap(tx, tz) > 1.5) addTree(tx, tz, prism ? { palm: 0.1, jac: 0.35 } : { palm: 0.3, jac: 0.25 }, prism ? 0.7 : 0.9);
              }
              if (!prism && rnd() < 0.15) addTree(x + nx * (d / 2 + 4), z + nz * (d / 2 + 4), { palm: 0.7, jac: 0.1 }, 1.15);
              // mailbox at the kerb
              if (rnd() < 0.5) prop('mailbox', 'mailbox', a.x + nx * (r.width / 2 + 0.8) + a.tx * (w / 2 - 1), a.z + nz * (r.width / 2 + 0.8) + a.tz * (w / 2 - 1), 1.2, '#3a3f45', 0.4);
            }
            // block wall behind a house that backs onto an arterial or freeway
            const bx = x + nx * (d / 2 + 2.2), bz = z + nz * (d / 2 + 2.2);
            let near = null;
            segGrid.query(bx - 40, bz - 40, bx + 40, bz + 40, (sg) => {
              if (!busy(sg.r)) return;
              const dd = Math.sqrt(segD2(bx, bz, sg.ax, sg.az, sg.bx, sg.bz)) - sg.hw;
              if (dd < 30 && (!near || dd < near)) near = dd;
            });
            if (near != null) {
              const wl = { kind: 'wall', x: bx, z: bz, w: step + 0.3, d: 0.4, rot: o.rot, h: 1.9, drawn: true };
              if (clearOfRoads(wl, 1.5)) { addSolid(wl); deco.walls.push({ ...wl, color: rnd() < 0.5 ? WALL : WALL2 }); }
            }
          }
        }
        s += step;
        if (isBoulder) num += 2;
        if (isBoulder && num > WESTON.boulderLast) break;
      }
    }
  }
  // the hero home: 8524 Boulder Way
  let home = homeList.find((h) => h.num === WESTON.home);
  if (!home && homeList.length) home = homeList[Math.min(homeList.length - 1, 12)];
  if (home) {
    home.hero = true; home.wall = '#f6f4ef'; home.roof = '#33373c'; home.gable = true; deco.home = home;
    // clear the front yard so the porch, the number and the cats are in view; then one jacaranda
    // at the far front corner (away from the driveway) and a mailbox at the kerb
    const c = Math.cos(home.rot), sn = Math.sin(home.rot);
    const L = (lx, lz) => [home.x + c * lx + sn * lz, home.z - sn * lx + c * lz];
    for (let i = solids.length - 1; i >= 0; i--) {
      const so = solids[i]; if (so.drawn) continue;
      const dx = so.x - home.x, dz = so.z - home.z;
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c; // world -> local
      if (Math.abs(lx) < home.w / 2 + 6 && lz < -home.d / 2 + 1 && lz > -home.d / 2 - 12) solids.splice(i, 1);
    }
    const [jx, jz] = L(-home.garage * (home.w / 2 + 1.6), -home.d / 2 - 4.5);
    prop('tree', 'jacaranda', jx, jz, 7.2, '#9a7fd6', 0.9);
    const [mx, mz] = L(home.garage * (home.w / 2 - 0.8), -home.d / 2 - 5.6);
    prop('mailbox', 'mailbox', mx, mz, 1.2, '#2b2b2b', 0.4);
  }

  T('14. street pro'); yield;
  // ── 14. street props: lights, palms, signals, hydrants, power poles ─────────────────────────────
  for (const r of roads) {
    if (r.kind === 'dirt' || r.kind === 'ramp' || r.path || r.bridge) continue;
    const L = polyLen(r.pts);
    const hwy = r.kind === 'highway';
    const art = r.kind === 'arterial';
    if (hwy) continue;
    const stepL = art ? 52 : 70;
    for (let s = 20; s < L - 15; s += stepL) {
      const a = along(r.pts, s);
      for (const side of art ? [1, -1] : [s % 140 < 70 ? 1 : -1]) {
        const off = r.width / 2 + 1.6;
        const x = a.x - a.tz * off * side, z = a.z + a.tx * off * side;
        if (roadGap(x, z, 40, (q) => q === r) < 2.5 || inWater(x, z) || riverDist(x, z) < RIVER_HALF + 2) continue;
        const o = { x, z, w: 0.5, d: 0.5, rot: 0 };
        if (blocked(o, 0.5)) continue;
        prop('pole', art ? 'lamp' : 'pole', x, z, art ? 9.5 : 8.5, art ? '#6d6f73' : '#7b5a3c', 0.45);
      }
      // palms between the lights on Mission Gorge, Town Center Pkwy and Mast
      if (art && /Mission Gorge|Town Center/.test(r.name) && Math.round(s / stepL) % 2 === 0) {
        const b = along(r.pts, s + stepL / 2);
        for (const side of [1, -1]) {
          const off = r.width / 2 + 3.2;
          const x = b.x - b.tz * off * side, z = b.z + b.tx * off * side;
          if (roadGap(x, z, 40, (q) => q === r) < 3 || inWater(x, z) || riverDist(x, z) < RIVER_HALF + 3) continue;
          if (!blocked({ x, z, w: 0.8, d: 0.8, rot: 0 }, 0.6)) prop('tree', 'palm', x, z, 15 + rnd() * 5, '#5f8a3a', 0.7);
        }
      }
      // hydrants on residential streets
      if (r.res && rnd() < 0.3) {
        const x = a.x + a.tz * (r.width / 2 + 0.9), z = a.z - a.tx * (r.width / 2 + 0.9);
        if (roadGap(x, z, 40, (q) => q === r) > 2 && !blocked({ x, z, w: 0.4, d: 0.4, rot: 0 }, 0.3)) prop('bollard', 'hydrant', x, z, 0.9, '#e2c23a', 0.4);
      }
    }
  }
  // traffic signals at arterial crossings
  {
    const arts = roads.filter((r) => r.kind === 'arterial' && !r.bridge);
    const done = [];
    for (let i = 0; i < arts.length; i++) for (let j = i + 1; j < arts.length; j++) {
      if (arts[i].name === arts[j].name) continue;
      const s = crossS(arts[i].pts, arts[j].pts);
      if (s == null) continue;
      const a = along(arts[i].pts, s);
      if (done.some(([x, z]) => Math.hypot(x - a.x, z - a.z) < 30)) continue;
      done.push([a.x, a.z]);
      const off = Math.max(arts[i].width, arts[j].width) / 2 + 2.5;
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const x = a.x + sx * off, z = a.z + sz * off;
        if (roadGap(x, z) < 1.5 || blocked({ x, z, w: 0.6, d: 0.6, rot: 0 }, 0.3)) continue;
        prop('pole', 'signal', x, z, 6.5, '#3d4046', 0.5);
      }
    }
    deco.signals = done;
  }
  // sound walls along the freeways (drawn), cut where anything else crosses or joins
  for (const r of roads.filter((q) => q.kind === 'highway' && !q.bridge)) {
    const L = polyLen(r.pts);
    for (const side of [1, -1]) {
      let s = 6;
      while (s < L - 6) {
        const seg = 14;
        const a = along(r.pts, s + seg / 2);
        const off = r.width / 2 + 5;
        const x = a.x - a.tz * off * side, z = a.z + a.tx * off * side;
        const gap = roadGap(x, z, 60, (q) => q.name === r.name && !q.bridge);
        const o = { kind: 'wall', x, z, w: seg + 0.4, d: 0.5, rot: Math.atan2(-a.tz, a.tx), h: 3.6, drawn: true };
        const edge = Math.min(x - BOUNDS.x0, BOUNDS.x1 - x, z - BOUNDS.z0, BOUNDS.z1 - z);
        if (gap > 4 && edge > 6 && Math.abs(x - TRACK_X) > 14 && clearOfRoads(o, 1) && !inWater(x, z) && riverDist(x, z) > RIVER_HALF + 4) {
          addSolid(o); deco.walls.push({ ...o, color: '#cdbb9c', sound: true });
        }
        s += seg;
      }
    }
  }

  T('15. hills'); yield;
  // ── 15. hills: chaparral scrub (visual) and granite boulders (solid, drawn) ─────────────────────
  for (let k = 0; k < 2600; k++) {
    const x = BOUNDS.x0 + rnd() * (BOUNDS.x1 - BOUNDS.x0), z = BOUNDS.z0 + rnd() * (BOUNDS.z1 - BOUNDS.z0);
    const h = height(x, z);
    if (h < 1.2) continue;
    const gap = roadGap(x, z, 30);
    if (gap < 4) continue;
    if (rnd() < 0.09 && gap > 12) {
      const s = 1.5 + rnd() * 3.5;
      const o = { kind: 'rock', x, z, w: s * 1.2, d: s, rot: rnd() * PI, h: s * 0.8, drawn: true };
      if (!blocked(o, 0.5)) { addSolid(o); deco.rocks.push({ ...o, y: h }); }
    } else deco.scrub.push([x, z, 1 + rnd() * 1.6, rnd()]);
  }
  // Santee's own boulder piles near the trail heads (Big Rock flavour)
  for (const [cx, cz] of [[-1180, -690], [-1520, -380], [-640, -1010], [930, -940]]) {
    for (let k = 0; k < 5; k++) {
      const x = cx + (rnd() - 0.5) * 30, z = cz + (rnd() - 0.5) * 30, s = 2 + rnd() * 3;
      const o = { kind: 'rock', x, z, w: s * 1.3, d: s, rot: rnd() * PI, h: s * 0.9, drawn: true };
      if (roadGap(x, z, 30) > 12 && !blocked(o, 0.5)) { addSolid(o); deco.rocks.push({ ...o, y: height(x, z) }); }
    }
  }
  // dirt where the hills are, so the ground slows you a bit
  for (const [cx, cz, rx, rz] of HILLS) open.push({ kind: 'dirt', poly: ellipse(cx, cz, rx * 0.95, rz * 0.95, 14).map(([x, z]) => [clamp(x, BOUNDS.x0, BOUNDS.x1), clamp(z, BOUNDS.z0, BOUNDS.z1)]) });
  // a couple of empty dirt lots inside tracts: cut-throughs
  for (const [cx, cz, w, d] of [[-300, -880, 60, 40], [250, -950, 50, 40], [-560, 300, 50, 50], [820, -620, 40, 60], [-1010, -470, 50, 26]]) {
    open.push({ kind: 'dirt', poly: rectPoly(cx, cz, w, d, 0) });
    deco.misc.push({ type: 'dirtlot', x: cx, z: cz, w, d });
  }

  // ── 16. cats around the hero house (non-solid, purely visual) ──────────────────────────────────
  if (home) {
    const c = Math.cos(home.rot), s = Math.sin(home.rot);
    const L = (lx, lz) => [home.x + c * lx + s * lz, home.z - s * lx + c * lz];
    // local +x along Boulder Way, local -z toward the street (front)
    const fz = -home.d / 2;
    const spots = [
      { at: L(-2.2, fz - 1.2), y: 0.45, coat: 'orange', pose: 'sit', yaw: 0, where: 'porch' },
      { at: L(home.w / 2 + 0.6, fz + 3), y: 1.95, coat: 'black', pose: 'loaf', yaw: PI / 2, where: 'wall' },
      { at: L(-home.w / 2 + 1.5, fz - 3.6), y: 0, coat: 'calico', pose: 'sit', yaw: 0.6, where: 'yard' },
      { at: L(2.6, fz - 2.2), y: 0, coat: 'grey', pose: 'loaf', yaw: -0.4, where: 'driveway' },
      { at: L(-1.6, fz - 0.05), y: 4.1, coat: 'white', pose: 'sit', yaw: 0, where: 'window' },
      { at: L(-home.w / 2 - 1.2, fz + 4), y: 0, coat: 'tabby', pose: 'sit', yaw: PI * 0.5, where: 'side yard' },
    ];
    for (const sp of spots) deco.cats.push({ x: sp.at[0], z: sp.at[1], y: sp.y, coat: sp.coat, pose: sp.pose, yaw: home.rot + PI + sp.yaw, where: sp.where });
    // block wall along the side of the lot (where the black cat naps)
    const wl = { kind: 'wall', x: L(home.w / 2 + 0.6, fz + 4)[0], z: L(home.w / 2 + 0.6, fz + 4)[1], w: 0.4, d: home.d + 2, rot: home.rot, h: 1.9, drawn: true };
    addSolid(wl); deco.walls.push({ ...wl, color: '#d8c3a0' });
  }

  // ── 16b. signs: strip-mall pylons, freeway gantries, Welcome to Santee, Santee Lakes ───────────
  deco.pylons = [];
  for (const c of CENTERS) {
    if (c.storage || c.big) continue;
    const rot = centerRot(c), F = frame(c.x, c.z, rot);
    const [px, pz] = F(c.x > 0 ? c.w / 2 - 8 : -c.w / 2 + 8, c.d / 2 - 3);
    if (roadGap(px, pz) < 2 || blocked({ x: px, z: pz, w: 1, d: 1, rot }, 0.5)) continue;
    addSolid({ kind: 'building', x: px, z: pz, w: 0.8, d: 0.8, rot, h: 8, drawn: true });
    deco.pylons.push({ x: px, z: pz, rot, names: c.shops.filter((n) => n !== 'GAS').slice(0, 3) });
  }
  deco.gantries = [];
  const gantry = (fw, sx, sz, label, dir) => {
    const cands = roads.filter((r) => r.name === fw && !r.bridge);
    let best = null; for (const r of cands) { const n = nearestOnR(r, sx, sz); if (!best || n.d < best.d) best = n; }
    const a = along(best.r.pts, best.s);
    const tx = a.tx * dir, tz = a.tz * dir;
    const rot = Math.atan2(-tz, tx) + Math.PI / 2; // face oncoming traffic (local -z toward drivers)
    const half = best.r.width / 2 + 3;
    for (const sd of [-1, 1]) addSolid({ kind: 'building', x: a.x - tz * half * sd, z: a.z + tx * half * sd, w: 0.7, d: 0.7, rot: 0, h: 7.5, drawn: true });
    deco.gantries.push({ x: a.x, z: a.z, rot, span: half * 2, label });
  };
  gantry('SR-52', -1000, 340, 'SR-125 SOUTH  La Mesa', 1);
  gantry('SR-52', 845, 490, 'SR-67  Lakeside  Ramona', 1);
  gantry('SR-52', -300, 455, 'SR-52 WEST  Mission Gorge', -1);
  gantry('SR-52', -1420, -190, 'Mast Blvd  NEXT EXIT', -1);
  gantry('SR-52', 300, 500, 'SR-52 EAST  El Cajon', 1);
  // monuments (drawn, low)
  deco.monuments = [];
  const monument = (road, x, z, side, label, color) => {
    const n = nearestOn(road, x, z), a = along(n.r.pts, n.s);
    const off = n.r.width / 2 + 9;
    const mx = a.x - a.tz * off * side, mz = a.z + a.tx * off * side;
    const rot = Math.atan2(-a.tz, a.tx) + (side > 0 ? Math.PI : 0);
    if (blocked({ x: mx, z: mz, w: 8, d: 1.2, rot }, 0.5)) return;
    addSolid({ kind: 'building', x: mx, z: mz, w: 8, d: 1.2, rot, h: 2.4, drawn: true });
    deco.monuments.push({ x: mx, z: mz, rot, label, color });
  };
  monument('Mission Gorge Rd', -1000, 30, 1, 'WELCOME TO SANTEE', '#d8c3a0');
  monument('Fanita Pkwy', -900, -560, -1, 'SANTEE LAKES', '#cdb592');
  monument('Mast Blvd', -1240, -400, 1, 'WEST HILLS HIGH', '#d8c3a0');
  monument('Magnolia Ave', 568, -660, 1, 'SANTANA HIGH', '#d8c3a0');

  T('17. spawns'); yield;
  // ── 17. spawns ─────────────────────────────────────────────────────────────────────────────────
  const spawns = [];
  function spawnOn(name, sx, sz, head, gap = 80, which = null) {
    const cands = roads.filter((r) => r.name === name && !r.bridge);
    let best = null;
    for (const r of cands) { const n = nearestOnR(r, sx, sz); if (!best || n.d < best.d) best = n; }
    if (!best) return;
    const r = best.r, L = polyLen(r.pts);
    const t0 = along(r.pts, best.s);
    const dirSign = t0.tx * head[0] + t0.tz * head[1] >= 0 ? 1 : -1;
    const sR = clamp(best.s, gap + 5, L - 5), sC = sR - gap * dirSign;
    const sRR = dirSign > 0 ? sR : clamp(best.s, 5, L - gap - 5);
    const sCC = dirSign > 0 ? sC : sRR + gap;
    const a = along(r.pts, sRR), b = along(r.pts, sCC);
    const lane = r.width / 4;
    const tx = a.tx * dirSign, tz = a.tz * dirSign;
    // drive on the right: offset to the right-hand lane
    const rx = -tz * lane, rz = tx * lane;
    // spawn yaw is a compass bearing in radians: 0 = north (-z), PI/2 = east (+x)
    const yaw = Math.round(Math.atan2(tx, -tz) * 1000) / 1000;
    spawns.push({ runner: { x: Math.round((a.x + rx) * 10) / 10, z: Math.round((a.z + rz) * 10) / 10, yaw }, cop: { x: Math.round((b.x + b.tx * 0 + rx) * 10) / 10, z: Math.round((b.z + rz) * 10) / 10, yaw: Math.round(Math.atan2(b.tx * dirSign, -b.tz * dirSign) * 1000) / 1000 }, road: name, where: which || name });
  }
  function nearestOnR(r, x, z) {
    let bd = Infinity, bs = 0, acc = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, l = Math.sqrt(l2);
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < bd) { bd = d; bs = acc + l * t; }
      acc += l;
    }
    return { r, d: bd, s: bs };
  }
  spawnOn('Mission Gorge Rd', -200, 0, [1, 0], 85, 'Mission Gorge Rd eastbound');
  spawnOn('Magnolia Ave', 568, 300, [0, -1], 80, 'Magnolia Ave northbound');
  spawnOn('Mast Blvd', -120, -605, [-1, 0], 80, 'Mast Blvd westbound');
  spawnOn('SR-52', -400, 410, [1, 0], 95, 'SR-52 eastbound');
  spawnOn('Carlton Hills Blvd', -500, -760, [0, 1], 80, 'Carlton Hills Blvd southbound');
  spawnOn('Fanita Pkwy', -880, -800, [0, 1], 80, 'Fanita Pkwy by the lakes');
  spawnOn('Town Center Pkwy', 420, -134, [1, 0], 80, 'Town Center Pkwy');
  spawnOn('Prospect Ave', 500, 248, [-1, 0], 80, 'Prospect Ave westbound');
  spawnOn('Weston Rd', -1292, -540, [0, -1], 75, 'Weston, by Boulder Way');
  spawnOn('Cuyamaca St', 0, -900, [0, -1], 85, 'Cuyamaca St northbound');
  spawnOn('Mission Gorge Rd', -1350, 380, [1, 0], 85, 'Mission Gorge');
  spawnOn('Mast Blvd', -1000, -450, [1, 0], 85, 'Mast Blvd by West Hills High');

  // ── 18. landmarks ─────────────────────────────────────────────────────────────────────────────
  const landmarks = [
    { name: 'Santee Lakes', x: -990, z: -830 },
    { name: 'Santee Town Center', x: 300, z: -70 },
    { name: 'Trolley', x: TRACK_X + 4, z: -70 },
    { name: 'San Diego River', x: -500, z: -200 },
    { name: 'Santana High', x: 468, z: -676 },
    { name: 'West Hills High', x: -1240, z: -312 },
    { name: 'Mission Gorge', x: -1520, z: 380 },
    { name: 'Mast Park', x: -480, z: -280 },
    { name: 'Carlton Oaks', x: -820, z: -310 },
    { name: 'Gillespie Field', x: 330, z: 600 },
    { name: 'Weston', x: -1380, z: -560 },
    { name: 'Fanita Ranch', x: -200, z: -1120 },
    { name: 'Cowles Mtn', x: -1580, z: 630, far: true, real: { x: -1812, z: 1264 } },
  ];
  if (home) landmarks.unshift({ name: '8524 Boulder Way', x: Math.round(home.x * 10) / 10, z: Math.round(home.z * 10) / 10, home: true });

  // strip internal fields from roads
  const outRoads = roads.map((r) => {
    const o = { name: r.name, kind: r.kind, width: r.width, pts: r.pts };
    if (r.bridge) { o.bridge = true; o.clear = r.clear; }
    if (r.closed) o.closed = true;
    return o;
  });
  deco.roadsFull = roads;
  const parkPolys = PARKS.map((p) => p.poly);
  const comPolys = CENTERS.map((c) => centerPoly(c));
  const zoneAt = (x, z) => {
    for (const zz of ZONES) if (pip(zz.poly, x, z)) return zz.style;
    for (const p of parkPolys) if (pip(p, x, z)) return 'park';
    if (pip(deco.lakePark, x, z)) return 'park';
    for (const p of comPolys) if (pip(p, x, z)) return 'com';
    return null;
  };
  T('end'); yield;
  return { times, roads: outRoads, open, solids, water, spawns, landmarks, height, deco, riverDist, roadGap, inWater, culs, zoneAt };
}
