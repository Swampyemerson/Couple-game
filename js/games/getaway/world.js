// Getaway world: builds a map into chunked, merged, culled meshes. The engine draws the road
// ribbons (asphalt with lane wear, gutters, worn markings, crosswalks and stop bars at junctions,
// manholes), curbs, optional sidewalks, bridge decks, every solid the map didn't draw (props
// written into the chunk geometry so they can be knocked over), parked cars, an optional terrain
// (`map.ground`), soft baked shadows + ambient occlusion under everything that stands (one decal
// mesh per chunk, sun direction from the map), and runs the map's own build()/backdrop() with the
// kit. Work is sliced so the main thread never blocks for long; afterwards every chunk is one or
// two draw calls plus its decal mesh. Per frame: distance + frustum culling, the light dressing
// (lights.js) and, on mid/high tiers, the car shadow map (render.js).
import { Builder, makeToon, mergeSteps, makeSky, cssRGB, mix, FX, FX_FAR, FX_ROAD, gfxTier } from './gfx.js';
import { drawProp, styleOf, STYLE_H } from './props.js';
import { mulberry } from './geo.js';
import { createLights, makeDecalMaterial } from './lights.js';
import { createShadow, TIERS } from './render.js';
import { createParkedCars } from './cars.js';

const CH = 200;
const RANK_LIFT = { highway: 0.05, arterial: 0.045, ramp: 0.045, street: 0.04, alley: 0.035, dirt: 0.03 };
const CURB_H = 0.16;

// engine-drawn breakables that are thin and tall: drawn with the see-through material (poles a
// metre from the chase camera are a black bar across the screen otherwise)
const THIN = { pole: 1, lamp: 1, signal: 1, sign: 1 };
// see-through meshes pool SEE_CELL × SEE_CELL chunks into one draw call. Bigger cells save calls
// but a cell is drawn whole when any of it is in view: 2×2 cost Santee +18k triangles in its
// heaviest view and 3×3 +38k (over the 220k budget), one chunk none (+~10–20 calls, within 90)
const SEE_CELL = 1;

export function chunkKey(x, z) { return `${Math.floor(x / CH)},${Math.floor(z / CH)}`; }

/** Convex hull of 2D points [[x, z]…] (monotone chain), counter-clockwise seen from above (+y). */
function hull2(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

/** Decal accumulator: triangles with a per-vertex darkening `a` (multiply blend). */
class Decals {
  constructor() { this.p = []; this.a = []; }
  get nv() { return this.a.length; }
  v(x, y, z, a) { this.p.push(x, y, z); this.a.push(a); }
  /** A soft-edged convex polygon: core darkness a, feathered over `soft` metres. Points CCW from above. */
  poly(pts, ys, a, soft) {
    const n = pts.length; if (n < 3) return;
    let cx = 0; let cz = 0; for (const q of pts) { cx += q[0]; cz += q[1]; } cx /= n; cz /= n;
    const cy = ys.reduce((s, y) => s + y, 0) / n;
    // outward offsets per vertex (average of the two edge normals)
    const out = pts.map((q, i) => {
      const pr = pts[(i + n - 1) % n]; const nx = pts[(i + 1) % n];
      const e1x = q[0] - pr[0]; const e1z = q[1] - pr[1]; const e2x = nx[0] - q[0]; const e2z = nx[1] - q[1];
      const l1 = Math.hypot(e1x, e1z) || 1; const l2 = Math.hypot(e2x, e2z) || 1;
      // CCW seen from above with x east, z south: outward normal of edge (ex, ez) is (ez, −ex)
      let ox = e1z / l1 + e2z / l2; let oz = -e1x / l1 - e2x / l2; const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
      return [q[0] + ox * soft, q[1] + oz * soft];
    });
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // core fan (wound so the face points up: centre, j, i for this hull orientation)
      this.v(cx, cy, cz, a); this.v(pts[j][0], ys[j], pts[j][1], a); this.v(pts[i][0], ys[i], pts[i][1], a);
      // feather ring
      this.v(pts[i][0], ys[i], pts[i][1], a); this.v(pts[j][0], ys[j], pts[j][1], a); this.v(out[j][0], ys[j], out[j][1], 0);
      this.v(pts[i][0], ys[i], pts[i][1], a); this.v(out[j][0], ys[j], out[j][1], 0); this.v(out[i][0], ys[i], out[i][1], 0);
    }
  }
  geometry(THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('a', new THREE.BufferAttribute(new Float32Array(this.a), 1));
    g.computeBoundingSphere();
    return g;
  }
}

export async function buildWorld(THREE, map, geo, P, U, { quality = 'high', onProgress = () => {}, budget = 12, dead = () => false, release = true } = {}) {
  const t0 = performance.now();
  const tier = gfxTier(); const cfg = TIERS[tier] || TIERS.mid;
  // stage times count only our own busy time (not the frames the browser runs between slices)
  const T = {}; let busy = 0; let busyMark = 0;
  let sliceT = performance.now();
  const mark = (k) => { const b = busy + (performance.now() - sliceT); T[k] = Math.round((T[k] || 0) + b - busyMark); busyMark = b; };
  let maxBlock = 0; let maxBlockAt = '';
  let stage = 'start';
  const slice = () => {
    const now = performance.now();
    if (now - sliceT < budget) return Promise.resolve();
    if (now - sliceT > maxBlock) { maxBlock = now - sliceT; maxBlockAt = stage; }
    busy += now - sliceT;
    return new Promise((r) => setTimeout(() => { sliceT = performance.now(); r(); }, 0));
  };
  const sky = map.sky || {};
  const dark = P.dark;
  const nightK = dark ? 0.78 : 0;
  const fogC = mix(cssRGB(sky.fog || sky.horizon || '#f3e9d2'), [0.07, 0.07, 0.14], nightK);
  const scene = new THREE.Scene();
  // low tier: a shorter view (fog pulled in proportionally) so far fewer chunks are drawn
  const fogK = cfg.fogFar ? Math.min(1, cfg.fogFar / (sky.fogFar || 520)) : 1;
  const fogNear = (sky.fogNear || 120) * fogK; const fogFar = (sky.fogFar || 520) * fogK;
  scene.fog = new THREE.Fog(new THREE.Color().fromArray(fogC), fogNear, fogFar);
  scene.background = null;
  const farScene = new THREE.Scene();
  const sunB = ((sky.sun && sky.sun.bearing) ?? 250) * Math.PI / 180; const sunE = ((sky.sun && sky.sun.elev) ?? 30) * Math.PI / 180;
  const sunDir = new THREE.Vector3(Math.sin(sunB) * Math.cos(sunE), Math.sin(sunE), -Math.cos(sunB) * Math.cos(sunE)).normalize();
  const moonDir = new THREE.Vector3(-sunDir.x, Math.max(0.45, sunDir.y), -sunDir.z).normalize();
  const lightDir = dark ? moonDir : sunDir;
  U.uSun.value.copy(lightDir);
  const skyTop = mix(cssRGB(sky.top || '#7fb6e6'), [0.04, 0.05, 0.13], nightK);
  const skyHor = fogC;
  const sunCol = dark ? [0.62, 0.68, 0.85] : cssRGB(sky.sunColor || '#fff1d6');
  U.uSkyTop.value.fromArray(skyTop); U.uSkyHor.value.fromArray(skyHor);
  U.uSunCol.value.fromArray(dark ? [0.55, 0.62, 0.8] : sunCol);
  U.uFogSun.value.fromArray(dark ? fogC : mix(fogC, sunCol, 0.55));
  U.uGroundC.value.fromArray(dark ? [0.03, 0.03, 0.05] : mix(cssRGB(map.ground || '#7a8a5a'), [0.2, 0.2, 0.2], 0.5));
  const skyMesh = makeSky(THREE, skyTop, skyHor, dark ? moonDir : sunDir, dark, { sunCol: dark ? [0.85, 0.88, 0.95] : sunCol, clouds: sky.clouds == null ? 0.5 : sky.clouds, tier });
  farScene.add(skyMesh);

  // ── materials ──
  const toonCache = new Map();
  const mats = {
    vc: makeToon(THREE, U, null, { vertexColors: true }),
    double: makeToon(THREE, U, null, { vertexColors: true, side: THREE.DoubleSide }),
    // instanced meshes with instanceColor (traffic, parked cars, debris): see-through near the lens
    // and in front of my car, so a car between the chase camera and me never hides me
    vcColor: makeToon(THREE, U, null, { vertexColors: true, see: true }),
    // thin things merged per chunk (poles, lamps, signals, signs, map wires with `see: true`): same
    // program, so they fade instead of drawing a thick bar across the view when the camera is close
    see: makeToon(THREE, U, null, { vertexColors: true, see: true }),
  };
  const allMats = new Set([mats.vc, mats.double, mats.vcColor, mats.see]);
  function toon(color, opts = {}) {
    const o = opts || {};
    const fx = o.glow || o.emissive ? 3 : o.windows ? 2 : (o.fx | 0);
    const key = `${color == null ? 'null' : typeof color === 'object' ? JSON.stringify(cssRGB(color)) : String(color)}|${o.vertexColors ? 1 : 0}|${fx}|${o.side === THREE.DoubleSide || o.side === 'double' ? 2 : 0}|${o.transparent ? o.opacity : 1}|${o.fog === false ? 0 : 1}|${o.outline || 0}|${o.see ? 1 : 0}`;
    let m = toonCache.get(key);
    if (!m) {
      m = makeToon(THREE, U, color == null ? 0xffffff : color, { vertexColors: !!o.vertexColors, fx, side: o.side === 'double' ? THREE.DoubleSide : o.side, transparent: !!o.transparent, opacity: o.opacity, fog: o.fog, outline: o.outline || 0, see: !!o.see });
      toonCache.set(key, m); allMats.add(m);
    }
    return m;
  }

  // ── light dressing + shadow map ──
  const lights = createLights(THREE, scene, U, P, cfg, { near: fogNear, far: fogFar });
  mats.lights = lights;
  const shadow = createShadow(THREE, U, cfg);
  const lampList = [];

  // ── chunks ──
  const chunks = new Map();
  // see-through thin things (poles, lamps, signals, signs, map wires): one mesh per cell of
  // SEE_CELL × SEE_CELL chunks, distance-culled in update() and frustum-culled by three
  const seeCells = new Map();
  function seeCell(x, z) {
    const k = `${Math.floor(x / (CH * SEE_CELL))},${Math.floor(z / (CH * SEE_CELL))}`;
    let s = seeCells.get(k);
    if (!s) { s = { b: new Builder(THREE, P.outline), mesh: null, x: 0, z: 0, r: CH * SEE_CELL * 0.75, tris: 0 }; seeCells.set(k, s); }
    return s;
  }
  function chunkAt(x, z) {
    const cx = Math.floor(x / CH); const cz = Math.floor(z / CH); const k = `${cx},${cz}`;
    let c = chunks.get(k);
    if (!c) {
      const g = new THREE.Group(); g.name = 'chunk ' + k; g.matrixAutoUpdate = false;
      c = { key: k, cx, cz, group: g, b: new Builder(THREE, P.outline), bt: seeCell(x, z).b, sc: seeCell(x, z), dec: new Decals(), props: [], parked: [], mesh: null, x: (cx + 0.5) * CH, y: 0, z: (cz + 0.5) * CH, r: CH * 0.75, tris: 0 };
      chunks.set(k, c); scene.add(g);
    }
    return c;
  }
  // shadow geometry: where a point at height h lands on the ground
  const sdx = -lightDir.x / Math.max(0.2, lightDir.y); const sdz = -lightDir.z / Math.max(0.2, lightDir.y);
  const shadowK = dark ? 0.32 : 0.36;
  const decalRec = new Map(); // solid index → { c, v0, v1 } (breakables: their shadow goes when they fall)
  function boxShadow(c, x, z, hw, hd, rot, h, y0, a = shadowK, ao = true) {
    const co = Math.cos(rot); const si = Math.sin(rot);
    const L = Math.min(h, 22);
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [x + lx * co + lz * si, z - lx * si + lz * co]);
    const pts = corners.concat(corners.map(([px, pz]) => [px + sdx * L, pz + sdz * L]));
    const hl = hull2(pts);
    const ys = hl.map(([px, pz]) => geo.ground(px, pz) + 0.21);
    c.dec.poly(hl, ys, a, 0.6 + L * 0.05);
    if (ao) { // contact darkening hugging the walls
      const ring = hull2(corners); const ysr = ring.map(([px, pz]) => (y0 != null ? y0 : geo.ground(px, pz)) + 0.215);
      c.dec.poly(ring, ysr, 0.22, 1.6);
    }
  }
  function blobShadow(c, x, z, r, h, a = shadowK * 0.9) {
    const L = Math.min(h, 18); const cx = x + sdx * L * 0.62; const cz = z + sdz * L * 0.62;
    const n = 8; const pts = []; const ys = [];
    // an ellipse stretched along the shadow direction
    const sl = Math.hypot(sdx, sdz) || 1; const ux = sdx / sl; const uz = sdz / sl; const st = 1 + Math.min(1.2, sl * 0.35);
    for (let k = 0; k < n; k++) { const t = (k / n) * Math.PI * 2; const a1 = Math.cos(t) * r * st; const b1 = Math.sin(t) * r; pts.push([cx + ux * a1 - uz * b1, cz + uz * a1 + ux * b1]); }
    const hl = hull2(pts); for (const q of hl) ys.push(geo.ground(q[0], q[1]) + 0.21);
    c.dec.poly(hl, ys, a, r * 0.7);
  }
  function stickShadow(c, x, z, h, w, a = shadowK * 0.75) {
    const L = Math.min(h, 16); const ex = x + sdx * L; const ez = z + sdz * L;
    const sl = Math.hypot(ex - x, ez - z) || 1; const nx = -(ez - z) / sl * w; const nz = (ex - x) / sl * w;
    const pts = hull2([[x + nx, z + nz], [x - nx, z - nz], [ex - nx, ez - nz], [ex + nx, ez + nz]]);
    c.dec.poly(pts, pts.map((q) => geo.ground(q[0], q[1]) + 0.21), a, 0.25);
  }

  const kit = {
    THREE, quality, palette: P, dark, tier,
    chunk: (x, z) => chunkAt(x, z).group,
    toon,
    /** A toon material with a surface code: kit.mat('brick' | 'stucco' | 'tile' | …, color, opts). */
    mat: (name, color, opts = {}) => toon(color == null ? null : color, { ...opts, fx: FX[name] != null ? FX[name] : (opts.fx | 0) }),
    FX,
    seeded: (n) => mulberry((n >>> 0) || 1),
    builder: () => new Builder(THREE, P.outline),
    slice,
    height: geo.ground,
    roads: geo.roads,
    nearestRoad: geo.nearestRoad,
    ink: P.outline,
    sun: lightDir.clone(),
    /** Register a light at (x, y, z) (street lamp head, porch light): a pool + halo at night. */
    lamp: (x, y, z) => { lampList.push({ x, y, z }); },
    /** Parked cars [{ x, z, yaw, y?, color?, shape? }] (instanced per chunk; drawing only). */
    parkedCars: (list) => { for (const p of list || []) chunkAt(p.x, p.z).parked.push(p); },
    /** A soft baked shadow for something the map draws that isn't a solid: a box w × d × h. */
    shadow: (x, z, w, d, rot = 0, h = 4) => boxShadow(chunkAt(x, z), x, z, w / 2, d / 2, rot, h, null),
    /** A round soft shadow (tree canopies, umbrellas): radius r, height h of the caster. */
    blobShadow: (x, z, r, h = 6) => blobShadow(chunkAt(x, z), x, z, r, h),
    /** Draw an engine prop into a builder: kit.prop(b, { kind:'tree', style:'pine', x, z, h, color, i }, y0). */
    prop: (b, s, y0 = 0) => drawProp(b, { hw: 0.5, hd: 0.5, rot: 0, i: (s.x * 7.3 + s.z * 3.1) | 0, breakable: true, ...s, hRaw: s.h }, y0, P),
  };

  // ── roads ──
  onProgress(0.02, 'Paving the roads…');
  stage = 'roads';
  const nq = { road: -1 };
  const asph = P.asphalt; const dirtC = P.dirtRoad; const curbC = P.curb; const gutC = P.gutter || mix(asph, [0, 0, 0], 0.15); const walkC = P.sidewalk || mix(curbC, [0.5, 0.5, 0.5], 0.2);
  const lineW = P.lineW; const lineY = P.lineY;
  const nqFilters = new Map();
  const rr = mulberry(0x51DE);
  for (const r of geo.roads) {
    const n = r.n; const hw = r.hw; const lift = RANK_LIFT[r.kind] || 0.04;
    const nx = new Float64Array(n); const nz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const i0 = i > 0 ? i - 1 : r.closed ? n - 2 : 0; const i1 = i < n - 1 ? i + 1 : r.closed ? 1 : n - 1;
      let tx = r.x[i1] - r.x[i0]; let tz = r.z[i1] - r.z[i0]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      nx[i] = -tz; nz[i] = tx;
    }
    const hl = new Float64Array(n); const hr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (r.bridge) { hl[i] = hr[i] = geo.deckY(r, r.cum[i]); continue; }
      hl[i] = geo.ground(r.x[i] - nx[i] * hw, r.z[i] - nz[i] * hw); hr[i] = geo.ground(r.x[i] + nx[i] * hw, r.z[i] + nz[i] * hw);
    }
    let filt = nqFilters.get(r); if (!filt) { filt = (o) => o !== r && !o.bridge; nqFilters.set(r, filt); }
    const join = new Uint8Array(n); const joinK = new Int8Array(n);
    if (!r.bridge) for (let i = 0; i < n - 1; i++) {
      geo.nearestRoad((r.x[i] + r.x[i + 1]) / 2, (r.z[i] + r.z[i + 1]) / 2, nq, hw + 22, filt);
      if (nq.road >= 0 && nq.d < geo.roads[nq.road].hw + Math.max(2.5, hw * 0.5)) { join[i] = 1; joinK[i] = geo.roads[nq.road].rank || 0; }
    }
    const isDirt = r.kind === 'dirt';
    const col = isDirt ? dirtC : asph; const rfx = isDirt ? FX.dirt : FX_ROAD;
    const laneW = hw / Math.max(1, r.lanes || 1);
    const yOff = (i, o) => hl[i] + (hr[i] - hl[i]) * ((o + hw) / (2 * hw));
    const curbed = (r.kind === 'street' || r.kind === 'arterial') && !r.bridge;
    const walk = curbed ? r.sidewalk || 0 : 0;
    const noCurb = (i) => join[i] || (i > 0 && join[i - 1]) || (i < n - 2 && join[i + 1]);
    for (let i = 0; i < n - 1; i++) {
      const ax = r.x[i]; const az = r.z[i]; const bx = r.x[i + 1]; const bz = r.z[i + 1];
      const c = chunkAt((ax + bx) / 2, (az + bz) / 2).b;
      const l0x = ax - nx[i] * hw; const l0z = az - nz[i] * hw; const r0x = ax + nx[i] * hw; const r0z = az + nz[i] * hw;
      const l1x = bx - nx[i + 1] * hw; const l1z = bz - nz[i + 1] * hw; const r1x = bx + nx[i + 1] * hw; const r1z = bz + nz[i + 1] * hw;
      const la = isDirt ? 0 : -hw / laneW; const ra = isDirt ? 0 : hw / laneW;
      c.quadUpA(l0x, hl[i] + lift, l0z, l1x, hl[i + 1] + lift, l1z, r1x, hr[i + 1] + lift, r1z, r0x, hr[i] + lift, r0z, col, rfx, la, la, ra, ra);
      if (r.bridge) {
        const y0 = hl[i]; const y1 = hl[i + 1];
        const mx = (ax + bx) / 2; const mz = (az + bz) / 2; const my = (y0 + y1) / 2;
        const segL = Math.hypot(bx - ax, bz - az) + 0.05; const ry = Math.atan2(bx - ax, bz - az);
        const pitch = -Math.atan2(y1 - y0, segL);
        c.add(c.T.box, mx, my - 0.45 + lift, mz, r.width + 0.6, 0.9, segL, ry, mix(P.curb, P.ink, 0.15), 0.05, FX.concrete, null, pitch);
        for (const sd of [-1, 1]) {
          c.add(c.T.box, mx + nx[i] * (hw + 0.1) * sd, my + 0.45 + lift, mz + nz[i] * (hw + 0.1) * sd, 0.32, 0.9, segL, ry, P.curb, 0.04, FX.concrete, null, pitch);
          c.add(c.T.box, mx + nx[i] * (hw + 0.1) * sd, my + 0.93 + lift, mz + nz[i] * (hw + 0.1) * sd, 0.14, 0.06, segL, ry, [0.55, 0.57, 0.6], 0, FX.metal, null, pitch);
        }
        if (i % 5 === 2) {
          const gy = geo.ground(mx, mz);
          if (my - gy > 1.6) for (const sd of [-0.6, 0.6]) c.add(c.T.box, mx + nx[i] * hw * sd, (my - 0.9 + gy) / 2, mz + nz[i] * hw * sd, 0.9, my - 0.9 - gy, 0.9, ry, mix(P.curb, P.ink, 0.25), 0.05, FX.concrete);
        }
        // expansion joints
        if (i % 4 === 0) { const jy = y0 + lift + 0.02; c.quadUp(ax - nx[i] * hw, jy, az - nz[i] * hw, ax - nx[i] * hw + (bx - ax) * 0.03, jy, az - nz[i] * hw + (bz - az) * 0.03, ax + nx[i] * hw + (bx - ax) * 0.03, jy, az + nz[i] * hw + (bz - az) * 0.03, ax + nx[i] * hw, jy, az + nz[i] * hw, [0.12, 0.12, 0.13]); }
      } else if (curbed && !noCurb(i)) {
        // gutter, curb (top + face) and an optional sidewalk, each side
        for (const sd of [-1, 1]) {
          const ya = (sd > 0 ? hr[i] : hl[i]); const yb = (sd > 0 ? hr[i + 1] : hl[i + 1]);
          const pt = (k, o) => [(k ? bx : ax) + (k ? nx[i + 1] : nx[i]) * o * sd, (k ? bz : az) + (k ? nz[i + 1] : nz[i]) * o * sd];
          const strip = (o0, o1, y0a, y0b, y1a, y1b, colr, f) => {
            const a0 = pt(0, o0); const b0 = pt(1, o0); const b1 = pt(1, o1); const a1 = pt(0, o1);
            if (sd > 0) c.quadUp(a0[0], y0a, a0[1], b0[0], y0b, b0[1], b1[0], y1b, b1[1], a1[0], y1a, a1[1], colr, f);
            else c.quadUp(a1[0], y1a, a1[1], b1[0], y1b, b1[1], b0[0], y0b, b0[1], a0[0], y0a, a0[1], colr, f);
          };
          if (tier === 'high') strip(hw - 0.45, hw, ya + lift + 0.004, yb + lift + 0.004, ya + lift + 0.004, yb + lift + 0.004, gutC, FX.lot);
          // curb face (vertical, facing the road)
          { const a0 = pt(0, hw); const b0 = pt(1, hw); const yl0 = ya + lift; const yl1 = yb + lift; const yt0 = ya + CURB_H; const yt1 = yb + CURB_H;
            if (sd > 0) c.poly([[a0[0], yl0, a0[1]], [a0[0], yt0, a0[1]], [b0[0], yt1, b0[1]], [b0[0], yl1, b0[1]]], mix(curbC, [0, 0, 0], 0.12), FX.concrete);
            else c.poly([[a0[0], yl0, a0[1]], [b0[0], yl1, b0[1]], [b0[0], yt1, b0[1]], [a0[0], yt0, a0[1]]], mix(curbC, [0, 0, 0], 0.12), FX.concrete); }
          strip(hw, hw + 0.35, ya + CURB_H, yb + CURB_H, ya + CURB_H, yb + CURB_H, curbC, FX.concrete);
          if (walk > 0) strip(hw + 0.35, hw + 0.35 + walk, ya + CURB_H, yb + CURB_H, ya + CURB_H, yb + CURB_H, walkC, FX.concrete);
        }
      }
    }
    // markings (worn: drawn with the road code so the asphalt noise shows through)
    const lines = [];
    const lanes = r.lanes;
    if (r.kind === 'highway' || r.kind === 'arterial' || r.kind === 'ramp') {
      if (r.kind !== 'ramp' && !r.oneway) { lines.push([-0.18, 0.13, lineY, 0]); lines.push([0.18, 0.13, lineY, 0]); }
      for (let k = 1; k < lanes; k++) { const o = (hw / lanes) * k; lines.push([o, 0.15, lineW, 1]); if (!r.oneway) lines.push([-o, 0.15, lineW, 1]); }
      lines.push([hw - 0.55, 0.15, lineW, 0]); lines.push([-(hw - 0.55), 0.15, lineW, 0]);
    } else if (r.kind === 'street' && r.width >= 8 && !r.oneway) lines.push([0, 0.13, lineY, 1]);
    const markC = (c3) => c3;
    const quadAt = (c, i, u0, u1, o0, o1, y, colr) => {
      const ax = r.x[i]; const az = r.z[i]; const bx = r.x[i + 1]; const bz = r.z[i + 1];
      const px0 = ax + (bx - ax) * u0; const pz0 = az + (bz - az) * u0; const px1 = ax + (bx - ax) * u1; const pz1 = az + (bz - az) * u1;
      const n0x = nx[i] + (nx[i + 1] - nx[i]) * u0; const n0z = nz[i] + (nz[i + 1] - nz[i]) * u0; const n1x = nx[i] + (nx[i + 1] - nx[i]) * u1; const n1z = nz[i] + (nz[i + 1] - nz[i]) * u1;
      const ya = yOff(i, (o0 + o1) / 2) + y; const yb = yOff(i + 1, (o0 + o1) / 2) + y;
      const y0 = ya + (yb - ya) * u0; const y1 = ya + (yb - ya) * u1;
      c.quadUp(px0 + n0x * o0, y0, pz0 + n0z * o0, px1 + n1x * o0, y1, pz1 + n1z * o0, px1 + n1x * o1, y1, pz1 + n1z * o1, px0 + n0x * o1, y0, pz0 + n0z * o1, colr, FX_ROAD);
    };
    if (lines.length) {
      for (let i = 0; i < n - 1; i++) {
        if (join[i]) continue; // inside an intersection
        const c = chunkAt((r.x[i] + r.x[i + 1]) / 2, (r.z[i] + r.z[i + 1]) / 2).b;
        const s0 = r.cum[i]; const s1 = r.cum[i + 1]; const segL = s1 - s0 || 1;
        for (let li = 0; li < lines.length; li++) {
          const o = lines[li][0]; const w = lines[li][1]; const colr = markC(lines[li][2]); const dashed = lines[li][3];
          if (!dashed) quadAt(c, i, 0, 1, o - w / 2, o + w / 2, lift + 0.03, colr);
          else { const P0 = r.kind === 'highway' ? 13 : 10; const D = r.kind === 'highway' ? 4.5 : 3.2; for (let sd = Math.floor(s0 / P0) * P0; sd < s1; sd += P0) { const a = Math.max(s0, sd); const b2 = Math.min(s1, sd + D); if (b2 > a) quadAt(c, i, (a - s0) / segL, (b2 - s0) / segL, o - w / 2, o + w / 2, lift + 0.03, colr); } }
        }
      }
    }
    // crosswalks + stop bars where a street / arterial meets a junction
    if (curbed && n > 3) {
      const sAt = (s) => { let i = 0; while (i < n - 2 && r.cum[i + 1] < s) i++; return i; };
      const stripe = (sA, sB, o0, o1) => {
        if (sA < 0.5 || sB > r.len - 0.5) return;
        const i = sAt((sA + sB) / 2); const s0 = r.cum[i]; const segL = r.cum[i + 1] - s0 || 1;
        const u0 = Math.max(0, (sA - s0) / segL); const u1 = Math.min(1, (sB - s0) / segL);
        quadAt(chunkAt(r.x[i], r.z[i]).b, i, u0, u1, o0, o1, lift + 0.032, lineW);
      };
      const zebra = (sA, sB) => { for (let o = -hw + 0.5; o + 0.55 < hw - 0.3; o += 1.15) stripe(sA, sB, o, o + 0.55); };
      for (let i = 1; i < n - 1; i++) {
        const into = join[i] && !join[i - 1]; const outOf = !join[i] && join[i - 1];
        if (!into && !outOf) continue;
        if ((into ? joinK[i] : joinK[i - 1]) < 3) continue; // only where another street-or-bigger road meets
        const s = r.cum[i];
        if (into) { zebra(s - 3.6, s - 0.6); stripe(s - 4.6, s - 4.1, 0.15, hw - 0.4); }
        else { zebra(s + 0.6, s + 3.6); if (!r.oneway) stripe(s + 4.1, s + 4.6, -(hw - 0.4), -0.15); }
      }
      // manholes
      for (let s = 20 + rr() * 40; s < r.len - 10; s += 45 + rr() * 50) {
        const i = sAt(s); if (join[i]) continue;
        const o = (rr() < 0.5 ? -1 : 1) * laneW * 0.5; const t = (s - r.cum[i]) / (r.cum[i + 1] - r.cum[i] || 1);
        const px = r.x[i] + (r.x[i + 1] - r.x[i]) * t + nx[i] * o; const pz = r.z[i] + (r.z[i + 1] - r.z[i]) * t + nz[i] * o;
        const py = yOff(i, o) + lift + 0.025; const pts = [];
        for (let k = 0; k < 8; k++) { const a = -(k / 8) * Math.PI * 2; pts.push([px + Math.cos(a) * 0.38, py, pz + Math.sin(a) * 0.38]); }
        chunkAt(px, pz).b.poly(pts, mix(asph, [0, 0, 0], 0.35), FX.metal, [0, 1, 0]);
      }
    }
    await slice();
    if (dead()) return null;
  }
  mark('roads');
  // ── terrain (optional engine ground) ──
  stage = 'ground';
  if (map.ground) {
    onProgress(0.12, 'Laying the ground…');
    const gc = mix(cssRGB(map.ground), [0.05, 0.06, 0.1], dark ? 0.55 : 0);
    const gfx = map.groundFx != null ? map.groundFx : FX.grass;
    const B = geo.bounds; const step = 12.5;
    for (let cz = Math.floor(B.z0 / CH); cz * CH < B.z1; cz++) {
      for (let cx = Math.floor(B.x0 / CH); cx * CH < B.x1; cx++) {
        const c = chunkAt(cx * CH + 1, cz * CH + 1).b;
        const xa = Math.max(B.x0, cx * CH); const xb = Math.min(B.x1, (cx + 1) * CH); const za = Math.max(B.z0, cz * CH); const zb = Math.min(B.z1, (cz + 1) * CH);
        const nxs = Math.max(1, Math.ceil((xb - xa) / step)); const nzs = Math.max(1, Math.ceil((zb - za) / step));
        for (let j = 0; j < nzs; j++) for (let i = 0; i < nxs; i++) {
          const x0 = xa + ((xb - xa) * i) / nxs; const x1 = xa + ((xb - xa) * (i + 1)) / nxs; const z0 = za + ((zb - za) * j) / nzs; const z1 = za + ((zb - za) * (j + 1)) / nzs;
          c.quadUp(x0, geo.ground(x0, z0) - 0.02, z0, x0, geo.ground(x0, z1) - 0.02, z1, x1, geo.ground(x1, z1) - 0.02, z1, x1, geo.ground(x1, z0) - 0.02, z0, gc, gfx);
        }
      }
      await slice();
      if (dead()) return null;
    }
  }

  mark('ground');
  // ── engine-drawn solids + baked shadows ──
  onProgress(0.18, 'Planting trees…');
  stage = 'props';
  const propRec = new Map(); // solid index → { chunk, v0, v1 }
  let k = 0;
  const decals = cfg.decals !== false;
  for (const s of geo.solids) {
    const y0 = s.y != null ? s.y : geo.ground(s.x, s.z);
    const c = chunkAt(s.x, s.z);
    const st = s.breakable ? styleOf(s) : null;
    if (st === 'lamp' || s.kind === 'lamp') {
      const h = Number.isFinite(s.hRaw) ? s.hRaw : (s.h || STYLE_H.lamp);
      const ax = -Math.cos(s.rot || 0); const az = Math.sin(s.rot || 0);
      lampList.push(s.drawn ? { x: s.x, y: y0 + h - 0.3, z: s.z } : { x: s.x + ax * 1.7, y: y0 + h - 0.35, z: s.z + az * 1.7, i: s.i });
    }
    if (!s.drawn && s.kind === 'car') c.parked.push({ x: s.x, z: s.z, y: y0, yaw: Math.PI - (s.rot || 0), color: s.color, shape: s.style });
    else if (!s.drawn) {
      const thin = THIN[st] === 1;
      const b = thin ? c.bt : c.b;
      const v0 = b.nv;
      drawProp(b, s, y0, P);
      if (s.breakable) propRec.set(s.i, { c, v0, v1: b.nv, thin });
    }
    if (decals && (s.y == null || s.y - geo.ground(s.x, s.z) < 0.6)) {
      const d0 = c.dec.nv;
      if (st) {
        const h = Number.isFinite(s.hRaw) ? s.hRaw : (STYLE_H[st] || s.h || 6);
        if (st === 'tree' || st === 'cottonwood' || st === 'jacaranda' || st === 'aspen' || st === 'pine' || st === 'palm' || st === 'shrub' || st === 'cactus') blobShadow(c, s.x, s.z, st === 'shrub' ? Math.max(0.8, (s.hw + s.hd) * 0.7) : st === 'palm' ? 2.2 : st === 'cactus' ? 0.8 : h * 0.3, st === 'shrub' ? 1 : h * 0.62);
        else if (st === 'lamp' || st === 'pole' || st === 'signal' || st === 'sign') stickShadow(c, s.x, s.z, h, 0.1);
        else blobShadow(c, s.x, s.z, 0.45, 1);
      } else if (s.kind === 'car') boxShadow(c, s.x, s.z, s.hw * 0.95, s.hd * 0.95, s.rot || 0, 1.3, y0, shadowK * 0.9, false);
      else boxShadow(c, s.x, s.z, s.hw, s.hd, s.rot || 0, s.kind === 'barrier' ? Math.min(1.1, s.h) : s.kind === 'rock' ? s.h * 0.7 : s.h, y0, shadowK, s.kind === 'building');
      if (s.breakable && c.dec.nv > d0) decalRec.set(s.i, { c, v0: d0, v1: c.dec.nv });
    }
    if ((++k & 63) === 0) { await slice(); if (dead()) return null; }
  }

  mark('props');
  // ── the map's own build ──
  onProgress(0.25, `Building ${map.name || 'the map'}…`);
  stage = 'build';
  let built = null;
  try {
    const res = map.build ? map.build(THREE, kit) : null;
    if (res && typeof res.then === 'function') built = await res;
    else if (res && typeof res.next === 'function') {
      for (;;) { const st = res.next(); if (st.done) { built = st.value; break; } await slice(); if (dead()) return null; }
    } else built = res;
  } catch (e) { console.error('getaway: map build failed', e); }
  if (dead()) return null;
  const globalG = new THREE.Group(); globalG.name = 'map-global';
  if (built && built.isObject3D) globalG.add(built);
  scene.add(globalG);
  { const now = performance.now(); if (now - sliceT > maxBlock) { maxBlock = now - sliceT; maxBlockAt = 'build'; } } // a synchronous build is one block

  mark('build');
  // ── backdrop ──
  onProgress(0.62, 'Painting the horizon…');
  stage = 'backdrop';
  try {
    const bd = map.backdrop ? map.backdrop(THREE, kit) : null;
    if (bd && bd.isObject3D) {
      const fogFree = new Map();
      bd.traverse((o) => {
        o.frustumCulled = false;
        if (!o.material) return;
        const swap = (m) => {
          if (!m) return m;
          let nm = fogFree.get(m);
          if (!nm) {
            if (m.userData && m.userData.gtw) {
              nm = makeToon(THREE, U, m.color ? [m.color.r, m.color.g, m.color.b] : null, { vertexColors: m.vertexColors, fx: m.userData.gtw.fx === 3 ? 3 : FX_FAR, fog: false, side: m.side });
              if (dark && !m.vertexColors && m.color) nm.color.setRGB(m.color.r * 0.45 + skyHor[0] * 0.3, m.color.g * 0.45 + skyHor[1] * 0.3, m.color.b * 0.5 + skyHor[2] * 0.3);
            } else { nm = m.clone(); nm.fog = false; }
            fogFree.set(m, nm); allMats.add(nm);
          }
          return nm;
        };
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      });
      farScene.add(bd);
    }
  } catch (e) { console.error('getaway: backdrop failed', e); }
  await slice();

  mark('backdrop');
  // ── merge chunks (sliced per source mesh), decals, parked cars ──
  onProgress(0.7, 'Welding it together…');
  stage = 'merge';
  const disposeSet = new Set();
  const decalMat = decals ? makeDecalMaterial(THREE, dark, { near: fogNear, far: fogFar }) : null;
  if (decalMat) allMats.add(decalMat);
  let ci = 0;
  for (const c of chunks.values()) {
    const it = mergeSteps(THREE, c.group, mats, P.outline, disposeSet, { front: c.b, see: c.bt, seeOut: true });
    let res;
    for (;;) { const st = it.next(); if (st.done) { res = st.value; break; } if (performance.now() - sliceT > budget) { await slice(); if (dead()) return null; } }
    c.mesh = res.front;
    c.b = null; c.bt = null;
    if (c.dec.nv && decalMat) {
      const dm = new THREE.Mesh(c.dec.geometry(THREE), decalMat);
      dm.name = 'decals'; dm.matrixAutoUpdate = false; dm.renderOrder = 1; dm.userData.noMerge = true; dm.frustumCulled = false;
      c.group.add(dm); c.decal = dm;
    }
    c.dec = null;
    if (c.parked.length) {
      const rnd = mulberry(((c.cx * 73856093) ^ (c.cz * 19349663)) >>> 0 || 7);
      for (const m of createParkedCars(THREE, P, mats, c.parked.map((p) => ({ ...p, y: p.y != null ? p.y : geo.ground(p.x, p.z) })), rnd) || []) { m.updateMatrix(); c.group.add(m); }
      c.parked = null;
    }
    // bounds of everything in the chunk
    const box = new THREE.Box3().setFromObject(c.group);
    if (!box.isEmpty()) {
      const sph = box.getBoundingSphere(new THREE.Sphere());
      c.x = sph.center.x; c.y = sph.center.y; c.z = sph.center.z; c.r = sph.radius;
    }
    c.group.traverse((o) => { if (o.geometry && o.geometry.index) c.tris += (o.geometry.index.count / 3) * (o.isInstancedMesh ? o.count : 1); else if (o.geometry && o.geometry.getAttribute('position')) c.tris += (o.geometry.getAttribute('position').count / 3) * (o.isInstancedMesh ? o.count : 1); });
    c.group.updateMatrixWorld(true);
    onProgress(0.7 + 0.25 * (++ci / chunks.size), 'Welding it together…');
    await slice();
    if (dead()) return null;
  }
  { const it = mergeSteps(THREE, globalG, mats, P.outline, disposeSet, null); for (;;) { const st = it.next(); if (st.done) break; if (performance.now() - sliceT > budget) { await slice(); if (dead()) return null; } } }
  // the pooled see-through meshes (distance-culled like chunks in update(), frustum-culled by three)
  const seeList = [];
  for (const s of seeCells.values()) {
    if (s.b.empty) continue;
    const m = s.b.mesh(mats.see); m.name = 'merged-see';
    m.geometry.computeBoundingSphere(); const bs = m.geometry.boundingSphere;
    s.x = bs.center.x; s.z = bs.center.z; s.r = bs.radius; s.mesh = m; s.b = null;
    const ix = m.geometry.index; s.tris = ix ? ix.count / 3 : m.geometry.getAttribute('position').count / 3;
    scene.add(m); seeList.push(s);
    if ((seeList.length & 7) === 0) { await slice(); if (dead()) return null; }
  }
  mark('merge');
  stage = 'dispose';
  const inUse = new Set(); scene.traverse((o) => { if (o.geometry) inUse.add(o.geometry); });
  for (const g of disposeSet) if (!inUse.has(g)) g.dispose();
  mark('dispose');
  for (const rec of propRec.values()) rec.mesh = rec.thin ? rec.c.sc.mesh : rec.c.mesh;
  lights.setLamps(lampList);
  // Memory: once the merged chunk geometry is on the GPU, drop the JS copies of everything the CPU
  // never touches again (normals, colours, fx codes, lane coords, indices) — roughly halves the
  // resident geometry memory on phones. Positions stay (knocked-over props edit them). After a
  // WebGL context loss the world must be rebuilt (`released` tells the game).
  let released = false;
  if (release) {
    const free = function freeArray() { this.array = null; };
    const keep = new Set(['position', 'a']);
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.name || !o.name.startsWith('merged')) return;
      const g = o.geometry;
      for (const k of Object.keys(g.attributes)) if (!keep.has(k)) g.attributes[k].onUpload(free);
      if (g.index) g.index.onUpload(free);
      released = true;
    });
  }

  // ── falling props: tip over with a little physics (gravity torque, a bounce, a slide) ──
  const falling = [];
  function breakSolid(i, vx, vz) {
    const s = geo.solids[i]; if (!s) return;
    s.broken = true;
    const dr = decalRec.get(i);
    if (dr && dr.c.decal) { const a = dr.c.decal.geometry.getAttribute('a'); if (!dr.save) dr.save = a.array.slice(dr.v0, dr.v1); a.array.fill(0, dr.v0, dr.v1); a.needsUpdate = true; }
    const rec = propRec.get(i);
    if (!rec || !rec.mesh) return;
    const pa = rec.mesh.geometry.getAttribute('position');
    rec.save = pa.array.slice(rec.v0 * 3, rec.v1 * 3); rec.held = rec.mesh;
    const x0 = pa.array[rec.v0 * 3]; const y0 = pa.array[rec.v0 * 3 + 1]; const z0 = pa.array[rec.v0 * 3 + 2];
    for (let v = rec.v0; v < rec.v1; v++) { pa.array[v * 3] = x0; pa.array[v * 3 + 1] = y0; pa.array[v * 3 + 2] = z0; }
    pa.needsUpdate = true;
    const b = new Builder(THREE, P.outline);
    drawProp(b, { ...s, x: 0, z: 0 }, 0, P, 0, 0, s.rot);
    const m = b.mesh(rec.thin ? mats.see : mats.vc); // a fallen pole lying by the lens fades too
    m.matrixAutoUpdate = true;
    m.layers.enable(2);
    const gy = s.y != null ? s.y : geo.ground(s.x, s.z);
    m.position.set(s.x, gy, s.z);
    const sp = Math.hypot(vx, vz) || 1;
    const tall = (Number.isFinite(s.hRaw) ? s.hRaw : s.h || 6) > 3;
    falling.push({ m, t: 0, ax: vz / sp, az: -vx / sp, vx: vx * 0.3, vz: vz * 0.3, vy: tall ? 0 : Math.min(5, sp * 0.15), y: gy, gy, ang: 0, w: Math.min(4, 0.6 + sp * 0.08), bounce: 0, spin: (Math.random() - 0.5) * 2, yaw: 0 });
    scene.add(m);
    if (falling.length > 24) { const f = falling.shift(); scene.remove(f.m); f.m.geometry.dispose(); }
    rec.mesh = null;
  }
  const q = new THREE.Quaternion(); const q2 = new THREE.Quaternion(); const axis = new THREE.Vector3(); const yAx = new THREE.Vector3(0, 1, 0);
  function updateFalling(dt) {
    dt = Math.min(0.05, dt);
    for (const f of falling) {
      if (f.t > 3) continue;
      f.t += dt;
      // tipping: gravity torque grows as it leans; it bounces once off the ground
      f.w += (2.2 + 3.5 * Math.sin(f.ang)) * dt;
      f.ang += f.w * dt;
      if (f.ang > 1.5) { f.ang = 1.5; if (f.bounce < 2) { f.w = -f.w * 0.28; f.bounce++; } else f.w = 0; }
      const fr = Math.max(0, 1 - f.t * 0.9);
      f.m.position.x += f.vx * dt * fr; f.m.position.z += f.vz * dt * fr;
      f.vy -= 14 * dt; f.y += f.vy * dt; if (f.y < f.gy) { f.y = f.gy; f.vy = Math.abs(f.vy) > 1.5 ? -f.vy * 0.3 : 0; }
      f.m.position.y = f.y;
      f.yaw += f.spin * dt * fr;
      axis.set(f.ax, 0, f.az); q.setFromAxisAngle(axis, -f.ang); q2.setFromAxisAngle(yAx, f.yaw);
      f.m.quaternion.copy(q).multiply(q2);
    }
  }

  // ── per frame ──
  const chunkList = [...chunks.values()];
  const viewR = fogFar + 40;
  const decalR = Math.min(240, fogFar * 0.5); // baked shadows fade out with distance anyway: skip their draw calls far away
  const frustum = new THREE.Frustum(); const pm = new THREE.Matrix4(); const sph = new THREE.Sphere(); const fv = new THREE.Vector3(); const focus = new THREE.Vector3();
  function update(cam, dt, tSec) {
    const cx = cam.position.x; const cz = cam.position.z;
    cam.updateMatrixWorld();
    pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    let vis = 0;
    for (const c of chunkList) {
      const d = Math.hypot(c.x - cx, c.z - cz) - c.r;
      let on = d < viewR;
      if (on && d > 0) { sph.center.set(c.x, c.y, c.z); sph.radius = c.r; on = frustum.intersectsSphere(sph); }
      if (c.group.visible !== on) c.group.visible = on;
      if (c.decal) { const dv = on && d < decalR; if (c.decal.visible !== dv) c.decal.visible = dv; }
      if (on) vis++;
    }
    for (const s of seeList) { const on = Math.hypot(s.x - cx, s.z - cz) - s.r < viewR; if (s.mesh.visible !== on) s.mesh.visible = on; }
    skyMesh.position.copy(cam.position);
    if (skyMesh.userData.tick) skyMesh.userData.tick(tSec || 0);
    U.uTime.value = tSec || 0; U.uCam.value.copy(cam.position);
    lights.commit(cam, tSec);
    updateFalling(dt);
    return vis;
  }
  /** Before rendering a view: the car shadow map around where the camera looks. */
  function preRender(renderer, cam) {
    if (!shadow || !shadow.enabled) return;
    const e = cam.matrixWorld.elements; fv.set(-e[8], 0, -e[10]); if (fv.lengthSq() < 1e-6) fv.set(0, 0, -1); fv.normalize();
    focus.set(cam.position.x + fv.x * shadow.R * 0.55, 0, cam.position.z + fv.z * shadow.R * 0.55);
    focus.y = geo.ground(focus.x, focus.z);
    shadow.render(renderer, scene, lightDir, focus);
  }

  const totalTris = chunkList.reduce((a, c) => a + c.tris, 0) + seeList.reduce((a, s) => a + s.tris, 0);
  onProgress(1, 'Ready');
  return {
    scene, farScene, sky: skyMesh, mats, kit, chunks: chunkList, toon, breakSolid, update, preRender, fogC, skyTop, sunDir: lightDir, lights, shadow, tier,
    fogNear, fogFar, cfg,
    /** true when GPU-only geometry dropped its CPU copies: rebuild the world after a context loss */
    get released() { return released; },
    stats: { buildMs: Math.round(busy + performance.now() - sliceT), wallMs: Math.round(performance.now() - t0), maxBlockMs: Math.round(maxBlock), maxBlockAt, chunks: chunkList.length, tris: Math.round(totalTris), stages: T, tier, lamps: lampList.length },
    warmList() { const l = []; scene.traverse((o) => { if (o.isMesh) l.push(o); }); return l; },
    /** Compile everything the light dressing and the shadow pass use (call before renderer.compile). */
    warm(renderer, cam) {
      lights.glow(cam.position.x, 0, cam.position.z - 5, 1, 0, 0, 0); lights.blob(cam.position.x, 0, cam.position.z - 5, 0, 1, 1, 0);
      lights.beam(cam.position.x, 0, cam.position.z - 5, 0, 0, -1, 1, 0); lights.spot(0, -999, 0, 0, 0, 1, 0);
      lights.commit(cam, -1);
      try { preRender(renderer, cam); } catch (e) { console.warn('getaway: shadow warm-up', e); }
    },
    resetProps() {
      for (const s of geo.solids) {
        if (!s.broken) continue;
        s.broken = false;
        const rec = propRec.get(s.i);
        if (rec && rec.save && rec.held) {
          const pa = rec.held.geometry.getAttribute('position'); pa.array.set(rec.save, rec.v0 * 3); pa.needsUpdate = true;
          rec.mesh = rec.held; rec.save = null;
        }
        const dr = decalRec.get(s.i);
        if (dr && dr.save && dr.c.decal) { const a = dr.c.decal.geometry.getAttribute('a'); a.array.set(dr.save, dr.v0); a.needsUpdate = true; dr.save = null; }
      }
      for (const f of falling) { scene.remove(f.m); f.m.geometry.dispose(); }
      falling.length = 0;
    },
    brokenCount: () => geo.solids.reduce((a, s) => a + (s.broken ? 1 : 0), 0),
    dispose() {
      const geos = new Set(); const mm = new Set(allMats);
      lights.dispose();
      if (shadow) shadow.dispose();
      for (const sc of [scene, farScene]) sc.traverse((o) => { if (o.geometry) geos.add(o.geometry); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mm.add(m)); });
      geos.forEach((g) => g.dispose()); mm.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    },
  };
}
