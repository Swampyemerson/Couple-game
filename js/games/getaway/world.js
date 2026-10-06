// Getaway world: builds a map into chunked, merged, culled meshes. The engine draws the road
// ribbons, markings, curbs and bridge decks from `roads`, every solid the map didn't draw
// (props written into the chunk geometry so they can be knocked over), an optional terrain
// (`map.ground`), and runs the map's own build()/backdrop() with the kit. Work is sliced so the
// main thread never blocks for long; afterwards every chunk is one or two draw calls.
import { Builder, makeToon, mergeGroup, makeSky, cssRGB, mix, FX_FAR } from './gfx.js';
import { drawProp } from './props.js';
import { mulberry } from './geo.js';

const CH = 200;
const RANK_LIFT = { highway: 0.05, arterial: 0.045, ramp: 0.045, street: 0.04, alley: 0.035, dirt: 0.03 };

export function chunkKey(x, z) { return `${Math.floor(x / CH)},${Math.floor(z / CH)}`; }

export async function buildWorld(THREE, map, geo, P, U, { quality = 'high', onProgress = () => {}, budget = 12, dead = () => false } = {}) {
  const t0 = performance.now();
  let sliceT = performance.now();
  let maxBlock = 0;
  const slice = () => {
    const now = performance.now();
    if (now - sliceT < budget) return Promise.resolve();
    maxBlock = Math.max(maxBlock, now - sliceT);
    return new Promise((r) => setTimeout(() => { sliceT = performance.now(); r(); }, 0));
  };
  const sky = map.sky || {};
  const dark = P.dark;
  const nightK = dark ? 0.78 : 0;
  const fogC = mix(cssRGB(sky.fog || sky.horizon || '#f3e9d2'), [0.07, 0.07, 0.14], nightK);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color().fromArray(fogC), sky.fogNear || 120, sky.fogFar || 520);
  scene.background = null;
  const farScene = new THREE.Scene();
  const sunB = ((sky.sun && sky.sun.bearing) ?? 250) * Math.PI / 180; const sunE = ((sky.sun && sky.sun.elev) ?? 30) * Math.PI / 180;
  const sunDir = new THREE.Vector3(Math.sin(sunB) * Math.cos(sunE), Math.sin(sunE), -Math.cos(sunB) * Math.cos(sunE)).normalize();
  U.uSun.value.copy(sunDir);
  const skyTop = mix(cssRGB(sky.top || '#7fb6e6'), [0.04, 0.05, 0.13], nightK);
  const skyHor = fogC;
  const skyMesh = makeSky(THREE, skyTop, skyHor, dark ? new THREE.Vector3(-sunDir.x, Math.max(0.35, sunDir.y), -sunDir.z) : sunDir, dark);
  farScene.add(skyMesh);

  // ── materials ──
  const toonCache = new Map();
  const mats = {
    vc: makeToon(THREE, U, null, { vertexColors: true }),
    double: makeToon(THREE, U, null, { vertexColors: true, side: THREE.DoubleSide }),
    vcColor: makeToon(THREE, U, null, { vertexColors: true }), // for instanced meshes with instanceColor
  };
  const allMats = new Set([mats.vc, mats.double, mats.vcColor]);
  function toon(color, opts = {}) {
    const o = opts || {};
    const fx = o.glow || o.emissive ? 3 : o.windows ? 2 : (o.fx | 0);
    const key = `${color == null ? 'null' : typeof color === 'object' ? JSON.stringify(cssRGB(color)) : String(color)}|${o.vertexColors ? 1 : 0}|${fx}|${o.side === THREE.DoubleSide || o.side === 'double' ? 2 : 0}|${o.transparent ? o.opacity : 1}|${o.fog === false ? 0 : 1}|${o.outline || 0}`;
    let m = toonCache.get(key);
    if (!m) {
      m = makeToon(THREE, U, color == null ? 0xffffff : color, { vertexColors: !!o.vertexColors, fx, side: o.side === 'double' ? THREE.DoubleSide : o.side, transparent: !!o.transparent, opacity: o.opacity, fog: o.fog, outline: o.outline || 0 });
      toonCache.set(key, m); allMats.add(m);
    }
    return m;
  }

  // ── chunks ──
  const chunks = new Map();
  function chunkAt(x, z) {
    const cx = Math.floor(x / CH); const cz = Math.floor(z / CH); const k = `${cx},${cz}`;
    let c = chunks.get(k);
    if (!c) {
      const g = new THREE.Group(); g.name = 'chunk ' + k; g.matrixAutoUpdate = false;
      c = { key: k, cx, cz, group: g, b: new Builder(THREE, P.outline), props: [], mesh: null, x: (cx + 0.5) * CH, z: (cz + 0.5) * CH, r: CH * 0.75, tris: 0 };
      chunks.set(k, c); scene.add(g);
    }
    return c;
  }
  const kit = {
    THREE, quality, palette: P, dark,
    chunk: (x, z) => chunkAt(x, z).group,
    toon,
    seeded: (n) => mulberry((n >>> 0) || 1),
    builder: () => new Builder(THREE, P.outline),
    slice,
    height: geo.ground,
    roads: geo.roads,
    nearestRoad: geo.nearestRoad,
    ink: P.outline,
  };

  // ── roads ──
  onProgress(0.02, 'Paving the roads…');
  const nq = { road: -1 };
  const asph = P.asphalt; const dirtC = P.dirtRoad; const curbC = P.curb;
  const lineW = P.lineW; const lineY = P.lineY;
  for (const r of geo.roads) {
    const n = r.n; const hw = r.hw; const lift = RANK_LIFT[r.kind] || 0.04;
    const L = new Float64Array(n * 2); const R = new Float64Array(n * 2); const nx = new Float64Array(n); const nz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const i0 = i > 0 ? i - 1 : r.closed ? n - 2 : 0; const i1 = i < n - 1 ? i + 1 : r.closed ? 1 : n - 1;
      let tx = r.x[i1] - r.x[i0]; let tz = r.z[i1] - r.z[i0]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      nx[i] = -tz; nz[i] = tx;
    }
    const yAt = (i, x, z) => (r.bridge ? geo.deckY(r, r.cum[i]) : geo.ground(x, z)) + lift;
    const col = r.kind === 'dirt' ? dirtC : asph;
    for (let i = 0; i < n - 1; i++) {
      const ax = r.x[i]; const az = r.z[i]; const bx = r.x[i + 1]; const bz = r.z[i + 1];
      const c = chunkAt((ax + bx) / 2, (az + bz) / 2).b;
      const l0x = ax - nx[i] * hw; const l0z = az - nz[i] * hw; const r0x = ax + nx[i] * hw; const r0z = az + nz[i] * hw;
      const l1x = bx - nx[i + 1] * hw; const l1z = bz - nz[i + 1] * hw; const r1x = bx + nx[i + 1] * hw; const r1z = bz + nz[i + 1] * hw;
      c.quadUp(l0x, yAt(i, l0x, l0z), l0z, l1x, yAt(i + 1, l1x, l1z), l1z, r1x, yAt(i + 1, r1x, r1z), r1z, r0x, yAt(i, r0x, r0z), r0z, col);
      if (r.bridge) {
        // deck slab, rails, pillars
        const y0 = geo.deckY(r, r.cum[i]); const y1 = geo.deckY(r, r.cum[i + 1]);
        const mx = (ax + bx) / 2; const mz = (az + bz) / 2; const my = (y0 + y1) / 2;
        const segL = Math.hypot(bx - ax, bz - az) + 0.05; const ry = Math.atan2(bx - ax, bz - az);
        const pitch = -Math.atan2(y1 - y0, segL);
        c.add(c.T.box, mx, my - 0.45 + lift, mz, r.width + 0.6, 0.9, segL, ry, mix(P.curb, P.ink, 0.15), 0.05, 0, null, pitch);
        for (const sd of [-1, 1]) {
          const ox = nx[i] * (hw + 0.1) * sd; const oz = nz[i] * (hw + 0.1) * sd;
          c.add(c.T.box, mx + (nx[i] * 0 + ox), my + 0.45 + lift, mz + oz, 0.32, 0.9, segL, ry, P.curb, 0.04, 0, null, pitch);
        }
        const gy = geo.ground(mx, mz);
        if (my - gy > 1.6 && i % 5 === 2) {
          for (const sd of [-0.6, 0.6]) c.add(c.T.box, mx + nx[i] * hw * sd, (my - 0.9 + gy) / 2, mz + nz[i] * hw * sd, 0.9, my - 0.9 - gy, 0.9, ry, mix(P.curb, P.ink, 0.25), 0.05);
        }
      } else if (r.kind === 'street' || r.kind === 'arterial') {
        // curbs (skipped where another road joins)
        for (const sd of [-1, 1]) {
          const px = (ax + bx) / 2 + ((nx[i] + nx[i + 1]) / 2) * (hw + 0.6) * sd; const pz = (az + bz) / 2 + ((nz[i] + nz[i + 1]) / 2) * (hw + 0.6) * sd;
          geo.nearestRoad(px, pz, nq, 30, (o) => o !== r && !o.bridge);
          if (nq.road >= 0 && nq.d < geo.roads[nq.road].hw + 1.5) continue;
          const e0x = ax + nx[i] * hw * sd; const e0z = az + nz[i] * hw * sd; const e1x = bx + nx[i + 1] * hw * sd; const e1z = bz + nz[i + 1] * hw * sd;
          const f0x = ax + nx[i] * (hw + 0.35) * sd; const f0z = az + nz[i] * (hw + 0.35) * sd; const f1x = bx + nx[i + 1] * (hw + 0.35) * sd; const f1z = bz + nz[i + 1] * (hw + 0.35) * sd;
          const ya = geo.ground(e0x, e0z) + 0.16; const yb = geo.ground(e1x, e1z) + 0.16;
          if (sd > 0) c.quadUp(e0x, ya, e0z, e1x, yb, e1z, f1x, yb, f1z, f0x, ya, f0z, curbC);
          else c.quadUp(f0x, ya, f0z, f1x, yb, f1z, e1x, yb, e1z, e0x, ya, e0z, curbC);
        }
      }
    }
    // markings
    const lines = [];
    const lanes = r.lanes;
    if (r.kind === 'highway' || r.kind === 'arterial' || r.kind === 'ramp') {
      if (r.kind !== 'ramp') { lines.push([-0.18, 0.13, lineY, 0]); lines.push([0.18, 0.13, lineY, 0]); }
      for (let k = 1; k < lanes; k++) { const o = (hw / lanes) * k; lines.push([o, 0.14, lineW, 1]); lines.push([-o, 0.14, lineW, 1]); }
      lines.push([hw - 0.55, 0.14, lineW, 0]); lines.push([-(hw - 0.55), 0.14, lineW, 0]);
    } else if (r.kind === 'street' && r.width >= 8) lines.push([0, 0.13, lineY, 1]);
    if (!lines.length) continue;
    for (let i = 0; i < n - 1; i++) {
      const ax = r.x[i]; const az = r.z[i]; const bx = r.x[i + 1]; const bz = r.z[i + 1];
      // skip inside intersections
      geo.nearestRoad((ax + bx) / 2, (az + bz) / 2, nq, 30, (o) => o !== r && !o.bridge);
      if (!r.bridge && nq.road >= 0 && nq.d < geo.roads[nq.road].hw + 2.5) continue;
      const c = chunkAt((ax + bx) / 2, (az + bz) / 2).b;
      const s0 = r.cum[i]; const s1 = r.cum[i + 1]; const segL = s1 - s0 || 1;
      for (const [o, w, colr, dashed] of lines) {
        const pieces = [];
        if (!dashed) pieces.push([0, 1]);
        else {
          const P0 = 12; let s = Math.floor(s0 / P0) * P0;
          for (; s < s1; s += P0) { const a = Math.max(s0, s); const b2 = Math.min(s1, s + 4); if (b2 > a) pieces.push([(a - s0) / segL, (b2 - s0) / segL]); }
        }
        for (const [u0, u1] of pieces) {
          const px0 = ax + (bx - ax) * u0; const pz0 = az + (bz - az) * u0; const px1 = ax + (bx - ax) * u1; const pz1 = az + (bz - az) * u1;
          const n0x = nx[i] + (nx[i + 1] - nx[i]) * u0; const n0z = nz[i] + (nz[i + 1] - nz[i]) * u0; const n1x = nx[i] + (nx[i + 1] - nx[i]) * u1; const n1z = nz[i] + (nz[i + 1] - nz[i]) * u1;
          const y0 = (r.bridge ? geo.deckY(r, s0 + segL * u0) : geo.ground(px0 + n0x * o, pz0 + n0z * o)) + lift + 0.03;
          const y1 = (r.bridge ? geo.deckY(r, s0 + segL * u1) : geo.ground(px1 + n1x * o, pz1 + n1z * o)) + lift + 0.03;
          const a0 = o - w / 2; const a1 = o + w / 2;
          c.quadUp(px0 + n0x * a0, y0, pz0 + n0z * a0, px1 + n1x * a0, y1, pz1 + n1z * a0, px1 + n1x * a1, y1, pz1 + n1z * a1, px0 + n0x * a1, y0, pz0 + n0z * a1, colr);
        }
      }
    }
    await slice();
    if (dead()) return null;
  }

  // ── terrain (optional engine ground) ──
  if (map.ground) {
    onProgress(0.12, 'Laying the ground…');
    const gc = mix(cssRGB(map.ground), [0.05, 0.06, 0.1], dark ? 0.55 : 0);
    const B = geo.bounds; const step = 12.5;
    for (let cz = Math.floor(B.z0 / CH); cz * CH < B.z1; cz++) {
      for (let cx = Math.floor(B.x0 / CH); cx * CH < B.x1; cx++) {
        const c = chunkAt(cx * CH + 1, cz * CH + 1).b;
        const xa = Math.max(B.x0, cx * CH); const xb = Math.min(B.x1, (cx + 1) * CH); const za = Math.max(B.z0, cz * CH); const zb = Math.min(B.z1, (cz + 1) * CH);
        const nxs = Math.max(1, Math.ceil((xb - xa) / step)); const nzs = Math.max(1, Math.ceil((zb - za) / step));
        for (let j = 0; j < nzs; j++) for (let i = 0; i < nxs; i++) {
          const x0 = xa + ((xb - xa) * i) / nxs; const x1 = xa + ((xb - xa) * (i + 1)) / nxs; const z0 = za + ((zb - za) * j) / nzs; const z1 = za + ((zb - za) * (j + 1)) / nzs;
          const sh = ((i + j) & 1) ? gc : mix(gc, [1, 1, 1], 0.025);
          c.quadUp(x0, geo.ground(x0, z0) - 0.02, z0, x0, geo.ground(x0, z1) - 0.02, z1, x1, geo.ground(x1, z1) - 0.02, z1, x1, geo.ground(x1, z0) - 0.02, z0, sh);
        }
      }
      await slice();
      if (dead()) return null;
    }
  }

  // ── engine-drawn solids ──
  onProgress(0.18, 'Planting trees…');
  const propRec = new Map(); // solid index → { chunk, v0, v1 }
  let k = 0;
  for (const s of geo.solids) {
    if (s.drawn) continue;
    const c = chunkAt(s.x, s.z);
    const v0 = c.b.nv;
    const y0 = s.y != null ? s.y : geo.ground(s.x, s.z);
    drawProp(c.b, s, y0, P);
    if (s.breakable) propRec.set(s.i, { c, v0, v1: c.b.nv });
    if ((++k & 63) === 0) { await slice(); if (dead()) return null; }
  }

  // ── the map's own build ──
  onProgress(0.25, `Building ${map.name || 'the map'}…`);
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
  maxBlock = Math.max(maxBlock, performance.now() - sliceT);
  sliceT = performance.now();

  // ── backdrop ──
  onProgress(0.62, 'Painting the horizon…');
  try {
    const bd = map.backdrop ? map.backdrop(THREE, kit) : null;
    if (bd && bd.isObject3D) {
      const fogFree = new Map();
      bd.traverse((o) => {
        o.frustumCulled = false;
        if (!o.material) return;
        const swap = (m) => {
          if (!m) return m;
          let n = fogFree.get(m);
          if (!n) {
            if (m.userData && m.userData.gtw) {
              n = makeToon(THREE, U, m.color ? [m.color.r, m.color.g, m.color.b] : null, { vertexColors: m.vertexColors, fx: m.userData.gtw.fx === 3 ? 3 : FX_FAR, fog: false, side: m.side });
              // night: dim the far scenery towards the sky
              if (dark && !m.vertexColors && m.color) n.color.setRGB(m.color.r * 0.45 + skyHor[0] * 0.3, m.color.g * 0.45 + skyHor[1] * 0.3, m.color.b * 0.5 + skyHor[2] * 0.3);
            } else { n = m.clone(); n.fog = false; }
            fogFree.set(m, n); allMats.add(n);
          }
          return n;
        };
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      });
      farScene.add(bd);
    }
  } catch (e) { console.error('getaway: backdrop failed', e); }
  await slice();

  // ── merge chunks ──
  onProgress(0.7, 'Welding it together…');
  const disposeSet = new Set();
  let ci = 0;
  for (const c of chunks.values()) {
    const res = mergeGroup(THREE, c.group, mats, P.outline, disposeSet, c.b);
    c.mesh = res.front;
    c.b = null;
    // bounds of everything in the chunk
    const box = new THREE.Box3().setFromObject(c.group);
    if (!box.isEmpty()) {
      const sph = box.getBoundingSphere(new THREE.Sphere());
      c.x = sph.center.x; c.z = sph.center.z; c.r = sph.radius;
    }
    c.group.traverse((o) => { if (o.geometry && o.geometry.index) c.tris += o.geometry.index.count / 3; else if (o.geometry && o.geometry.getAttribute('position')) c.tris += o.geometry.getAttribute('position').count / 3; });
    c.group.updateMatrixWorld(true);
    onProgress(0.7 + 0.25 * (++ci / chunks.size), 'Welding it together…');
    await slice();
    if (dead()) return null;
  }
  mergeGroup(THREE, globalG, mats, P.outline, disposeSet, null);
  for (const g of disposeSet) { let used = false; scene.traverse((o) => { if (o.geometry === g) used = true; }); if (!used) g.dispose(); }
  // rebind prop records to the merged meshes
  for (const rec of propRec.values()) rec.mesh = rec.c.mesh;

  // ── falling props ──
  const falling = [];
  function breakSolid(i, vx, vz) {
    const s = geo.solids[i]; if (!s) return;
    s.broken = true;
    const rec = propRec.get(i);
    if (!rec || !rec.mesh) return;
    const pa = rec.mesh.geometry.getAttribute('position');
    rec.save = pa.array.slice(rec.v0 * 3, rec.v1 * 3); rec.held = rec.mesh;
    const x0 = pa.array[rec.v0 * 3]; const y0 = pa.array[rec.v0 * 3 + 1]; const z0 = pa.array[rec.v0 * 3 + 2];
    for (let v = rec.v0; v < rec.v1; v++) { pa.array[v * 3] = x0; pa.array[v * 3 + 1] = y0; pa.array[v * 3 + 2] = z0; }
    pa.needsUpdate = true;
    // a falling copy, built around its base
    const b = new Builder(THREE, P.outline);
    drawProp(b, { ...s, x: 0, z: 0 }, 0, P, 0, 0, s.rot);
    const m = b.mesh(mats.vc);
    m.matrixAutoUpdate = true;
    const gy = s.y != null ? s.y : geo.ground(s.x, s.z);
    m.position.set(s.x, gy, s.z);
    const sp = Math.hypot(vx, vz) || 1;
    falling.push({ m, t: 0, ax: vz / sp, az: -vx / sp, vx: vx * 0.25, vz: vz * 0.25, ang: 0 });
    scene.add(m);
    if (falling.length > 24) { const f = falling.shift(); scene.remove(f.m); f.m.geometry.dispose(); }
    rec.mesh = null;
  }
  const q = new THREE.Quaternion(); const axis = new THREE.Vector3();
  function updateFalling(dt) {
    for (const f of falling) {
      if (f.t > 1.2) continue;
      f.t += dt;
      f.ang = Math.min(1.45, f.ang + dt * (1.2 + f.t * 4));
      const fr = Math.max(0, 1 - f.t * 1.5);
      f.m.position.x += f.vx * dt * fr; f.m.position.z += f.vz * dt * fr;
      axis.set(f.ax, 0, f.az); q.setFromAxisAngle(axis, -f.ang);
      f.m.quaternion.copy(q);
    }
  }

  // ── per frame ──
  const chunkList = [...chunks.values()];
  const viewR = (sky.fogFar || 520) + 40;
  function update(cam, dt, tSec) {
    const cx = cam.position.x; const cz = cam.position.z;
    let vis = 0;
    for (const c of chunkList) {
      const d = Math.hypot(c.x - cx, c.z - cz) - c.r;
      const on = d < viewR;
      if (c.group.visible !== on) c.group.visible = on;
      if (on) vis++;
    }
    skyMesh.position.copy(cam.position);
    updateFalling(dt);
    return vis;
  }

  const totalTris = chunkList.reduce((a, c) => a + c.tris, 0);
  onProgress(1, 'Ready');
  return {
    scene, farScene, sky: skyMesh, mats, kit, chunks: chunkList, toon, breakSolid, update, fogC, skyTop, sunDir,
    fogNear: sky.fogNear || 120, fogFar: sky.fogFar || 520,
    stats: { buildMs: Math.round(performance.now() - t0), maxBlockMs: Math.round(maxBlock), chunks: chunkList.length, tris: Math.round(totalTris) },
    warmList() { const l = []; scene.traverse((o) => { if (o.isMesh) l.push(o); }); return l; },
    resetProps() {
      // stand everything back up between rounds
      for (const s of geo.solids) {
        if (!s.broken) continue;
        s.broken = false;
        const rec = propRec.get(s.i);
        if (rec && rec.save && rec.held) {
          const pa = rec.held.geometry.getAttribute('position'); pa.array.set(rec.save, rec.v0 * 3); pa.needsUpdate = true;
          rec.mesh = rec.held; rec.save = null;
        }
      }
      for (const f of falling) { scene.remove(f.m); f.m.geometry.dispose(); }
      falling.length = 0;
    },
    brokenCount: () => geo.solids.reduce((a, s) => a + (s.broken ? 1 : 0), 0),
    dispose() {
      const geos = new Set(); const mm = new Set(allMats);
      for (const sc of [scene, farScene]) sc.traverse((o) => { if (o.geometry) geos.add(o.geometry); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mm.add(m)); });
      geos.forEach((g) => g.dispose()); mm.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    },
  };
}
