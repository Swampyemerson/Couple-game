// Rail Rush world: scene, lights, fog, pooled per-chunk merged meshes (track + scenery + parked
// trains + outlines, one draw call per chunk), instanced coins / pickups / barriers / roadblocks,
// pooled oncoming trains, skyline and street. `syncView(view)` lays out the per-runner things
// (collected coins, smashed barriers, oncoming train positions) right before rendering a view.
import { rng } from '../core.js';
import { CHUNK, LANE_W, CAR, ROOF, LOW_H, HIGH_B, HIGH_T } from './tune.js';
import { O_LOW, O_HIGH, O_TRAIN, O_RAMP, O_MTRAIN, O_BLOCK, I_MAGNET, I_SNEAKERS, I_SHIELD, I_BOX, I_REVIVE, mtrainFront } from './track.js';
import { GeoBuf, makeToon, makeGradient, makeUniforms, makeTemplates, blobTexture, mix, FX_PLAIN, FX_FACADE, FX_GLOW, FX_SKY, FX_BED, FX_STRIPE, FX_TRAINWIN, FX_PAPER } from './gfx.js';

const OL = 0.05;
const CHUNK_V = 30000;
const POOL = 9;
const COIN_MAX = 300;
const ITEM_MAX = 16;
const BAR_MAX = 40;
const VIEW_AHEAD = 175;
const VIEW_BEHIND = 14;
const SIDE_X = 4.35;      // parapet line

export function createWorld(THREE, P) {
  const T = makeTemplates(THREE);
  const grad = makeGradient(THREE);
  const U = makeUniforms(THREE, P);
  const mat = makeToon(THREE, grad, U);
  const avatarMat = makeToon(THREE, grad, U, { skinning: true });
  const disposables = [grad, mat, avatarMat];

  const scene = new THREE.Scene();
  scene.background = new THREE.Color().fromArray(P.bg);
  scene.fog = new THREE.Fog(new THREE.Color().fromArray(P.fog), 55, 165);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9a948c, P.dark ? 0.62 : 0.66);
  const sun = new THREE.DirectionalLight(0xffffff, P.dark ? 0.42 : 0.52);
  sun.position.set(-0.55, 1, 0.45);
  scene.add(hemi, sun, sun.target);

  // ── chunk meshes ──
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const buf = new GeoBuf(THREE, CHUNK_V);
    const mesh = new THREE.Mesh(buf.geo, mat);
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    pool.push({ buf, mesh, ci: -1, used: 0 });
    disposables.push(buf);
  }
  const byChunk = new Map();
  let frame = 0;

  // ── instanced things ──
  const tmpBuf = new GeoBuf(THREE, 6000, { dynamic: false });
  const freezeWith = (fn) => { tmpBuf.reset(); fn(tmpBuf); const g = tmpBuf.freeze(THREE); disposables.push(g); return g; };
  const inst = (geo, max, m = mat) => {
    const im = new THREE.InstancedMesh(geo, m, max);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0; im.frustumCulled = false;
    scene.add(im);
    return im;
  };
  const ink = P.outline;
  const coinGeo = freezeWith((b) => {
    b.add(T.disc, 0, 0, 0, 0.84, 0.13, 0.84, 0, P.coinRim, FX_PLAIN, 0.045, ink);
    b.add(T.disc, 0, 0, 0, 0.62, 0.16, 0.62, 0, P.coin, FX_GLOW, 0, ink);
    b.add(T.box, 0, 0, 0, 0.12, 0.19, 0.34, 0, P.coinRim, FX_PLAIN, 0, ink);
  });
  // disc template is a Y-axis cylinder: rotate its axis to Z by swapping in the instance matrix (see writeCoin)
  const coins = inst(coinGeo, COIN_MAX);

  const itemGeo = {};
  itemGeo[I_MAGNET] = freezeWith((b) => {
    b.add(T.box, -0.26, 0.06, 0, 0.2, 0.62, 0.22, 0, P.bad, FX_PLAIN, 0.04, ink);
    b.add(T.box, 0.26, 0.06, 0, 0.2, 0.62, 0.22, 0, P.bad, FX_PLAIN, 0.04, ink);
    b.add(T.box, 0, -0.32, 0, 0.72, 0.2, 0.22, 0, P.bad, FX_PLAIN, 0.04, ink);
    b.add(T.box, -0.26, 0.42, 0, 0.21, 0.14, 0.23, 0, P.white, FX_GLOW, 0, ink);
    b.add(T.box, 0.26, 0.42, 0, 0.21, 0.14, 0.23, 0, P.white, FX_GLOW, 0, ink);
  });
  itemGeo[I_SNEAKERS] = freezeWith((b) => {
    b.add(T.box, 0, -0.22, 0.02, 0.36, 0.14, 0.78, 0, P.white, FX_PLAIN, 0.04, ink);
    b.add(T.box, 0, 0.0, 0.1, 0.34, 0.32, 0.55, 0, P.good, FX_PLAIN, 0.04, ink);
    b.add(T.box, 0, 0.22, 0.26, 0.32, 0.36, 0.24, 0, P.good, FX_PLAIN, 0.04, ink);
    b.add(T.box, 0.22, 0.18, 0.2, 0.06, 0.34, 0.46, -0.5, P.hl, FX_GLOW, 0.03, ink);
    b.add(T.box, -0.22, 0.18, 0.2, 0.06, 0.34, 0.46, 0.5, P.hl, FX_GLOW, 0.03, ink);
  });
  itemGeo[I_SHIELD] = freezeWith((b) => {
    b.add(T.sphere, 0, 0, 0, 0.8, 0.8, 0.8, 0, mix(P.a, P.white, 0.45), FX_GLOW, 0.045, ink);
    b.add(T.box, 0, 0, -0.38, 0.12, 0.42, 0.08, 0, P.white, FX_GLOW, 0, ink);
    b.add(T.box, 0, 0.05, -0.38, 0.32, 0.12, 0.08, 0, P.white, FX_GLOW, 0, ink);
  });
  itemGeo[I_BOX] = freezeWith((b) => {
    b.add(T.box, 0, 0, 0, 0.78, 0.78, 0.78, 0, P.hl, FX_GLOW, 0.05, ink);
    b.add(T.box, 0, 0, 0, 0.82, 0.22, 0.82, 0, P.a, FX_PLAIN, 0, ink);
    b.add(T.box, 0, 0, 0, 0.22, 0.82, 0.83, 0, P.b, FX_PLAIN, 0, ink);
  });
  itemGeo[I_REVIVE] = freezeWith((b) => {
    b.add(T.sphere, -0.2, 0.12, 0, 0.5, 0.5, 0.36, 0, P.b, FX_GLOW, 0.05, ink);
    b.add(T.sphere, 0.2, 0.12, 0, 0.5, 0.5, 0.36, 0, P.b, FX_GLOW, 0.05, ink);
    b.add(T.box, 0, -0.1, 0, 0.5, 0.5, 0.35, Math.PI / 4, P.b, FX_GLOW, 0, ink);
    b.add(T.ico, 0, 0.05, 0, 1.25, 1.25, 1.25, 0, mix(P.hl, P.white, 0.4), FX_GLOW, 0, ink);
  });
  // The revive halo should be drawn first-ish; it's opaque but smaller parts poke through. Fine for a glowing token.
  const items = {};
  for (const k of [I_MAGNET, I_SNEAKERS, I_SHIELD, I_BOX, I_REVIVE]) items[k] = inst(itemGeo[k], ITEM_MAX);

  const lowGeo = freezeWith((b) => {
    b.boxMM(-1.02, 0, -0.1, -0.84, LOW_H, 0.1, P.pole, FX_PLAIN, 0.035, ink, T);
    b.boxMM(0.84, 0, -0.1, 1.02, LOW_H, 0.1, P.pole, FX_PLAIN, 0.035, ink, T);
    b.boxMM(-1.1, 0.46, -0.16, 1.1, 0.98, 0.16, P.hl, FX_STRIPE, 0.045, ink, T);
    b.boxMM(-1.12, 0, -0.3, -0.74, 0.08, 0.3, P.pole, FX_PLAIN, 0, ink, T);
    b.boxMM(0.74, 0, -0.3, 1.12, 0.08, 0.3, P.pole, FX_PLAIN, 0, ink, T);
  });
  const highGeo = freezeWith((b) => {
    b.boxMM(-1.12, 0, -0.1, -0.94, HIGH_T, 0.1, P.pole, FX_PLAIN, 0.035, ink, T);
    b.boxMM(0.94, 0, -0.1, 1.12, HIGH_T, 0.1, P.pole, FX_PLAIN, 0.035, ink, T);
    b.boxMM(-1.16, HIGH_B + 0.04, -0.12, 1.16, HIGH_T - 0.05, 0.12, P.bad, FX_PAPER, 0.045, ink, T);
    b.boxMM(-0.18, HIGH_T - 0.05, -0.08, 0.18, HIGH_T + 0.12, 0.08, P.hl, FX_GLOW, 0.03, ink, T);
  });
  const blockGeo = freezeWith((b) => {
    b.boxMM(-1.15, 0, -0.35, 1.15, 1.1, 0.35, P.white, FX_STRIPE, 0.06, ink, T);
    b.boxMM(-1.2, 1.1, -0.4, 1.2, 1.25, 0.4, P.white, FX_PLAIN, 0.05, ink, T);
    b.boxMM(-0.25, 1.25, -0.1, 0.25, 1.6, 0.1, P.hl, FX_GLOW, 0.04, ink, T);
  });
  const lows = inst(lowGeo, BAR_MAX);
  const highs = inst(highGeo, BAR_MAX);
  const blocks = inst(blockGeo, 8);
  blocks.setColorAt(0, new THREE.Color(1, 1, 1));

  // oncoming trains (pooled, 2 cars, front at local z = 0 facing +z)
  const mtGeo = freezeWith((b) => trainCars(b, 0, 0, 2, P.trains[4], true, T, P));
  const mtrains = [];
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(mtGeo, mat); m.visible = false; m.frustumCulled = false; scene.add(m); mtrains.push(m); }

  // blob shadows
  const blobTex = blobTexture(THREE);
  const shadowMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, color: P.dark ? 0x000000 : 0x2a2440, opacity: P.dark ? 0.9 : 0.75, fog: true });
  shadowMat.polygonOffset = true; shadowMat.polygonOffsetFactor = -2;
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, 6);
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.count = 0; shadows.frustumCulled = false; shadows.renderOrder = 2;
  scene.add(shadows);
  disposables.push(blobTex, shadowMat, shadowGeo);

  // street far below and the skyline ring (both follow the camera)
  const streetGeo = freezeWith((b) => { b.boxMM(-450, -8.6, -450, 450, -8, 450, P.street, FX_PLAIN, 0, ink, T); });
  const street = new THREE.Mesh(streetGeo, mat);
  street.frustumCulled = false;
  scene.add(street);
  const skyBuf = new GeoBuf(THREE, 9000, { dynamic: false });
  buildSkyline(skyBuf, T, P);
  const skyGeo = skyBuf.freeze(THREE);
  disposables.push(skyGeo);
  skyBuf.dispose();
  const skyline = new THREE.Mesh(skyGeo, mat);
  skyline.frustumCulled = false;
  skyline.renderOrder = -1;
  scene.add(skyline);
  tmpBuf.dispose();

  // ── chunks ──
  function chunkMesh(track, ci) {
    let e = byChunk.get(ci);
    if (e) { e.used = frame; return e; }
    // take the least recently used slot
    e = null;
    for (const p of pool) if (p.ci < 0) { e = p; break; }
    if (!e) { for (const p of pool) if (p.used < frame - 1 && (!e || p.used < e.used)) e = p; }
    if (!e) return null;
    if (e.ci >= 0) byChunk.delete(e.ci);
    const c = track.chunk(ci);
    e.buf.reset();
    buildChunk(e.buf, c, T, P);
    e.buf.commit(140, 0, 4, -(c.z0 + CHUNK / 2));
    e.mesh.visible = true;
    e.ci = ci; e.used = frame;
    byChunk.set(ci, e);
    return e;
  }

  /** Make sure the chunks around these track positions have meshes. Returns how many were built. */
  function ensure(track, zs, budget = 9) {
    frame++;
    let built = 0;
    for (const z of zs) {
      const c0 = Math.floor((z - VIEW_BEHIND) / CHUNK);
      const c1 = Math.floor((z + VIEW_AHEAD) / CHUNK);
      for (let ci = Math.max(0, c0); ci <= c1; ci++) {
        if (byChunk.has(ci)) { byChunk.get(ci).used = frame; continue; }
        if (built >= budget) continue;
        chunkMesh(track, ci); built++;
      }
    }
    return built;
  }

  // ── per-view layout ──
  const tmpColor = new THREE.Color();
  let spin = 0;
  function writeM(arr, i, x, y, z, s, ry, rx = 0) {
    // R = Ry * Rx, uniform scale s
    const cy = Math.cos(ry); const sy = Math.sin(ry);
    const cx = Math.cos(rx); const sx = Math.sin(rx);
    const o = i * 16;
    arr[o] = cy * s; arr[o + 1] = 0; arr[o + 2] = -sy * s; arr[o + 3] = 0;
    arr[o + 4] = sy * sx * s; arr[o + 5] = cx * s; arr[o + 6] = cy * sx * s; arr[o + 7] = 0;
    arr[o + 8] = sy * cx * s; arr[o + 9] = -sx * s; arr[o + 10] = cy * cx * s; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }

  /**
   * Lay out per-runner things for one view. v = { track, z (view runner z), r (runner whose
   * pickups count, may be null), time (s), fly: [{x,y,z,s}] flying coins }
   */
  function syncView(v) {
    const { track, z } = v;
    const r = v.r;
    spin = v.time * 3.2;
    const c0 = Math.max(0, Math.floor((z - VIEW_BEHIND) / CHUNK));
    const c1 = Math.floor((z + VIEW_AHEAD) / CHUNK);
    const ca = coins.instanceMatrix.array;
    let nc = 0;
    const ic = { [I_MAGNET]: 0, [I_SNEAKERS]: 0, [I_SHIELD]: 0, [I_BOX]: 0, [I_REVIVE]: 0 };
    let nl = 0; let nh = 0; let nm = 0;
    const la = lows.instanceMatrix.array; const ha = highs.instanceMatrix.array;
    for (let ci = c0; ci <= c1; ci++) {
      const c = track.chunk(ci);
      const base = ci * 1000;
      const cs = c.coins;
      for (let i = 0; i < cs.length && nc < COIN_MAX; i++) {
        const cn = cs[i];
        if (cn.z < z - VIEW_BEHIND || cn.z > z + VIEW_AHEAD) continue;
        if (r && r.taken.has(base + i)) continue;
        writeM(ca, nc++, cn.x, cn.y, -cn.z, 1, spin + cn.z * 0.05, Math.PI / 2);
      }
      const its = c.items;
      for (let i = 0; i < its.length; i++) {
        const it = its[i];
        if (it.z < z - VIEW_BEHIND || it.z > z + VIEW_AHEAD) continue;
        if (r && r.taken.has(base + 500 + i)) continue;
        if (it.k === I_BOX && !v.boxes) continue;
        const m = items[it.k];
        if (ic[it.k] >= ITEM_MAX) continue;
        const bob = Math.sin(v.time * 3 + it.z) * 0.12;
        writeM(m.instanceMatrix.array, ic[it.k]++, it.x, it.y + bob, -it.z, it.k === I_BOX ? 1 : 1.05, spin * 0.7 + it.z, it.k === I_BOX ? 0.6 : 0);
      }
      for (const o of c.obs) {
        if (o.z1 < z - VIEW_BEHIND || o.z0 > z + VIEW_AHEAD) continue;
        if (o.t === O_LOW || o.t === O_HIGH) {
          if (r && r.smashN && r.smashed.has(o.id)) continue;
          if (o.t === O_LOW) { if (nl < BAR_MAX) writeM(la, nl++, o.lane * LANE_W, 0, -(o.z0 + 0.25), 1, 0); }
          else if (nh < BAR_MAX) writeM(ha, nh++, o.lane * LANE_W, 0, -(o.z0 + 0.2), 1, 0);
        } else if (o.t === O_MTRAIN && nm < mtrains.length) {
          const f = mtrainFront(o, z);
          const m = mtrains[nm++];
          m.visible = true;
          m.position.set(o.lane * LANE_W, 0, -f);
        }
      }
    }
    if (v.fly) for (const f of v.fly) { if (nc < COIN_MAX && f.on) writeM(ca, nc++, f.x, f.y, -f.z, f.s, spin * 2, Math.PI / 2); }
    if (r) {
      for (const tk of r.tokens) {
        if (!tk.alive || ic[I_REVIVE] >= ITEM_MAX) continue;
        const bob = Math.sin(v.time * 5) * 0.15;
        writeM(items[I_REVIVE].instanceMatrix.array, ic[I_REVIVE]++, tk.x, tk.y + bob, -tk.z, 1 + Math.sin(v.time * 9) * 0.08, spin * 1.4);
      }
      let nb = 0;
      for (const o of r.extra) {
        if (o.t !== O_BLOCK || nb >= 8) continue;
        if (o.z1 < z - VIEW_BEHIND || o.z0 > z + VIEW_AHEAD) continue;
        if (o.hit) continue;
        writeM(blocks.instanceMatrix.array, nb, o.lane * LANE_W, 0, -(o.z0 + 0.35), 1, 0);
        tmpColor.fromArray(o.rgb || P.hl);
        blocks.setColorAt(nb, tmpColor);
        nb++;
      }
      blocks.count = nb;
      if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
      blocks.instanceMatrix.needsUpdate = true;
    } else blocks.count = 0;
    for (let i = nm; i < mtrains.length; i++) mtrains[i].visible = false;
    coins.count = nc; coins.instanceMatrix.needsUpdate = true;
    for (const k in items) { items[k].count = ic[k]; items[k].instanceMatrix.needsUpdate = true; }
    lows.count = nl; lows.instanceMatrix.needsUpdate = true;
    highs.count = nh; highs.instanceMatrix.needsUpdate = true;
  }

  /** Blob shadows: list of [x, groundY, z, size, strength]. */
  function setShadows(list, n) {
    const a = shadows.instanceMatrix.array;
    for (let i = 0; i < n; i++) {
      const s = list[i];
      const o = i * 16;
      a.fill(0, o, o + 16);
      a[o] = s[3]; a[o + 5] = 1; a[o + 10] = s[3] * 0.8; a[o + 15] = 1;
      a[o + 12] = s[0]; a[o + 13] = s[1] + 0.03; a[o + 14] = -s[2];
    }
    shadows.count = n;
    shadows.instanceMatrix.needsUpdate = true;
  }

  function follow(cam) {
    street.position.set(cam.position.x, 0, cam.position.z);
    skyline.position.set(cam.position.x, 0, cam.position.z);
    street.updateMatrixWorld(); skyline.updateMatrixWorld();
  }

  function setPalette(P2) {
    // Rebuilding everything is simplest; palette changes are rare (theme switch).
    scene.background.fromArray(P2.bg);
    scene.fog.color.fromArray(P2.fog);
    for (const p of pool) { p.ci = -1; p.mesh.visible = false; }
    byChunk.clear();
  }

  return {
    scene, mat, avatarMat, U, T, P,
    ensure, syncView, setShadows, follow, setPalette,
    chunkCount: () => byChunk.size,
    /** Everything that can be drawn, for shader warm-up. */
    warmList: () => [coins, lows, highs, blocks, shadows, street, skyline, ...Object.values(items), mtrains[0], pool[0].mesh],
    dispose() {
      for (const d of disposables) { try { d.dispose(); } catch { /* ignore */ } }
      for (const m of [coins, lows, highs, blocks, ...Object.values(items)]) { try { m.dispose(); } catch { /* ignore */ } }
      try { shadows.dispose(); } catch { /* ignore */ }
      scene.clear();
    },
  };
}

// ── builders (all coordinates: x, y, track distance d; world z = -d) ──
function bx(b, T, x0, y0, d0, x1, y1, d1, rgb, fx, ol, ink) {
  b.add(T.box, (x0 + x1) / 2, (y0 + y1) / 2, -(d0 + d1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(d1 - d0), 0, rgb, fx, ol, ink);
}

/** Intervals of [d0, d1] not covered by gaps that include lane l. */
function openSpans(c, l, d0, d1, out) {
  out.length = 0;
  const bit = 1 << (l + 1);
  let cur = d0;
  const gs = c.gaps.filter((g) => g.mask & bit).sort((a, b) => a.z0 - b.z0);
  for (const g of gs) {
    if (g.z0 > cur) out.push([cur, Math.min(g.z0, d1)]);
    cur = Math.max(cur, g.z1);
  }
  if (cur < d1) out.push([cur, d1]);
  return out;
}

/** Train cars starting at d (front facing the runner), `n` cars. */
function trainCars(b, x, d, n, liv, oncoming, T, P) {
  const ink = P.outline;
  const under = mix(liv.body, [0.08, 0.08, 0.1], 0.6);
  const roof = mix(liv.body, P.white, 0.35);
  const door = mix(liv.body, P.ink, 0.22);
  for (let k = 0; k < n; k++) {
    const a = d + k * CAR + (k ? 0.2 : 0);
    const e = d + (k + 1) * CAR - 0.25;
    bx(b, T, x - 1.15, 0.38, a, x + 1.15, ROOF - 0.06, e, liv.body, FX_TRAINWIN, OL, ink);
    bx(b, T, x - 1.02, ROOF - 0.08, a + 0.3, x + 1.02, ROOF, e - 0.3, roof, FX_PLAIN, 0.035, ink);
    bx(b, T, x - 0.95, 0.02, a + 0.6, x + 0.95, 0.42, e - 0.6, under, FX_PLAIN, 0, ink);
    bx(b, T, x - 1.18, 0.82, a + 0.1, x + 1.18, 1.08, e - 0.1, liv.stripe, FX_PLAIN, 0, ink);
    for (const u of [0.3, 0.7]) {
      const dm = a + (e - a) * u;
      bx(b, T, x - 1.17, 0.42, dm - 0.6, x + 1.17, 2.3, dm + 0.6, door, FX_PLAIN, 0, ink);
    }
    if (k > 0) bx(b, T, x - 0.35, 0.7, a - 0.5, x + 0.35, 1.3, a + 0.1, under, FX_PLAIN, 0, ink);
    // contact shadow strip
    bx(b, T, x - 1.3, -0.015, a - 0.2, x + 1.3, 0.0, e + 0.2, [0.1, 0.09, 0.12], FX_PLAIN, 0, ink);
  }
  // cab face (toward the runner, at the low-d end)
  bx(b, T, x - 0.86, 1.45, d - 0.04, x + 0.86, 2.3, d + 0.2, P.glass, FX_PLAIN, 0.03, ink);
  bx(b, T, x - 0.9, 0.62, d - 0.06, x - 0.55, 0.88, d + 0.1, oncoming ? P.lit : P.white, FX_GLOW, 0.025, ink);
  bx(b, T, x + 0.55, 0.62, d - 0.06, x + 0.9, 0.88, d + 0.1, oncoming ? P.lit : P.white, FX_GLOW, 0.025, ink);
  bx(b, T, x - 1.0, 0.3, d - 0.1, x + 1.0, 0.5, d + 0.2, mix(liv.stripe, P.ink, 0.2), FX_STRIPE, 0.03, ink);
  if (oncoming) bx(b, T, x - 0.3, ROOF, d + 0.6, x + 0.3, ROOF + 0.25, d + 1.2, P.bad, FX_GLOW, 0.03, ink);
}

function buildChunk(b, c, T, P) {
  const ink = P.outline;
  const d0 = c.z0; const d1 = c.z1;
  const spans = [];
  const r = rng(c.scen);
  const tun = c.tunnel;

  // deck, bed, rails per lane
  for (let l = -1; l <= 1; l++) {
    openSpans(c, l, d0, d1, spans);
    const xl = l === -1 ? -SIDE_X : l * LANE_W - LANE_W / 2;
    const xr = l === 1 ? SIDE_X : l * LANE_W + LANE_W / 2;
    for (const [a, e] of spans) {
      bx(b, T, xl, -1.5, a, xr, -0.12, e, P.deck, FX_PLAIN, 0, ink);
      bx(b, T, l * LANE_W - 1.18, -0.12, a, l * LANE_W + 1.18, -0.03, e, P.bed, FX_BED, 0, ink);
      for (const sx of [-0.72, 0.72]) bx(b, T, l * LANE_W + sx - 0.06, -0.03, a, l * LANE_W + sx + 0.06, 0.1, e, P.rail, FX_PLAIN, 0, ink);
    }
    // broken-bridge edges and hazard stripes
    for (const g of c.gaps) {
      if (!(g.mask & (1 << (l + 1)))) continue;
      if (g.z0 > d0 + 1) {
        bx(b, T, l * LANE_W - 1.15, -0.03, g.z0 - 1.4, l * LANE_W + 1.15, 0.0, g.z0 - 0.3, P.hl, FX_STRIPE, 0, ink);
        bx(b, T, xl + 0.2, -1.9, g.z0 - 0.5, xr - 0.2, -1.5, g.z0, P.deck, FX_PLAIN, 0.04, ink);
      }
    }
  }
  // bridge railings along lanes that stay while their neighbours drop away
  for (const g of c.gaps) {
    if (g.mask === 7) continue;
    for (let l = -1; l <= 1; l++) {
      if (g.mask & (1 << (l + 1))) continue;
      for (const side of [-1, 1]) {
        const nb = l + side;
        if (nb < -1 || nb > 1 || !(g.mask & (1 << (nb + 1)))) continue;
        const xr = l * LANE_W + side * 1.25;
        bx(b, T, xr - 0.05, 0.85, g.z0, xr + 0.05, 0.95, g.z1, P.pole, FX_PLAIN, 0.025, ink);
        for (let d = g.z0; d <= g.z1; d += 2) bx(b, T, xr - 0.05, -0.03, d - 0.05, xr + 0.05, 0.9, d + 0.05, P.pole, FX_PLAIN, 0, ink);
      }
    }
  }
  // parapets
  for (const side of [-1, 1]) {
    openSpans(c, side, d0, d1, spans);
    for (const [a, e] of spans) {
      bx(b, T, side * SIDE_X - 0.16, -0.12, a, side * SIDE_X + 0.16, 0.8, e, P.parapet, FX_PLAIN, 0.04, ink);
    }
  }
  // viaduct piers (seen through gaps and past the edge)
  for (let d = Math.ceil(d0 / 25) * 25; d < d1; d += 25) {
    for (const px of [-2.6, 2.6]) bx(b, T, px - 0.7, -8, d - 0.7, px + 0.7, -1.5, d + 0.7, mix(P.deck, P.ink, 0.12), FX_PLAIN, 0.06, ink);
  }

  if (tun) {
    const [t0, t1] = tun;
    const wall = P.tunnel;
    for (const side of [-1, 1]) {
      bx(b, T, side * 4.7 - 0.25, -0.12, t0, side * 4.7 + 0.25, 6.2, t1, wall, FX_PLAIN, 0, ink);
      for (let d = t0 + 4; d < t1; d += 9) bx(b, T, side * 4.42 - 0.06, 4.7, d - 0.7, side * 4.42 + 0.06, 5.0, d + 0.7, P.lit, FX_GLOW, 0, ink);
    }
    bx(b, T, -4.95, 6.2, t0, 4.95, 6.8, t1, mix(wall, P.ink, 0.15), FX_PLAIN, 0, ink);
    // embankment on top and portals at both ends
    bx(b, T, -16, 6.8, t0 + 1, 16, 8.4, t1 - 1, mix(P.card, P.good, 0.42), FX_PLAIN, 0.08, ink);
    for (const pd of [t0, t1]) {
      const f = pd === t0 ? -1 : 1;
      bx(b, T, -12, 6.0, pd - 0.5 * f - 0.5, 12, 11.5, pd - 0.5 * f + 0.5, P.portal, FX_PLAIN, 0.08, ink);
      for (const side of [-1, 1]) bx(b, T, side * 5.0 - side * 0.0, -0.12, pd - 0.6, side * 7.5, 6.0, pd + 0.6, P.portal, FX_PLAIN, 0.07, ink);
      bx(b, T, -5.1, 6.0, pd - 0.65, 5.1, 6.6, pd + 0.65, mix(P.portal, P.ink, 0.25), FX_PLAIN, 0.05, ink);
    }
  } else {
    // catenary gantries every 25 m
    for (let d = Math.floor(d0 / 25) * 25 + 12.5; d < d1; d += 25) {
      if (d < d0) continue;
      for (const side of [-1, 1]) {
        bx(b, T, side * 4.62 - 0.13, -0.12, d - 0.13, side * 4.62 + 0.13, 6.5, d + 0.13, P.pole, FX_PLAIN, 0.035, ink);
        bx(b, T, side * 4.45 - 0.1, 5.85, d - 0.1, side * 4.45 + 0.1, 6.05, d + 0.1, P.lit, FX_GLOW, 0, ink);
      }
      bx(b, T, -4.85, 6.3, d - 0.11, 4.85, 6.55, d + 0.11, P.pole, FX_PLAIN, 0.035, ink);
    }
    for (let l = -1; l <= 1; l++) bx(b, T, l * LANE_W - 0.025, 5.6, d0, l * LANE_W + 0.025, 5.65, d1, P.pole, FX_PLAIN, 0, ink);
  }

  // parked trains and ramps
  for (const o of c.obs) {
    if (o.t === O_TRAIN) trainCars(b, o.lane * LANE_W, o.z0, o.cars, P.trains[o.liv % 4], false, T, P);
    else if (o.t === O_RAMP) {
      b.add(T.wedge, o.lane * LANE_W, ROOF / 2, -(o.z0 + o.z1) / 2, 2.2, ROOF, o.z1 - o.z0, 0, mix(P.card, P.hl, 0.5), FX_PLAIN, OL, ink);
      for (const sx of [-1.12, 1.12]) bx(b, T, o.lane * LANE_W + sx - 0.05, 0, o.z0, o.lane * LANE_W + sx + 0.05, 0.12, o.z1, P.pole, FX_PLAIN, 0, ink);
    }
  }

  // buildings (deterministic per chunk)
  for (const side of [-1, 1]) {
    let d = d0 + r() * 3;
    while (d < d1) {
      const w = 8 + Math.floor(r() * 10);
      const de = Math.min(d + w, d1);
      if (de - d > 3) {
        const inner = 7.2 + r() * 1.2;
        const depth = 7 + r() * 6;
        const h = tun && d < tun[1] && de > tun[0] ? 2 + r() * 6 : 4 + Math.floor(r() * 7) * 3.2;
        const col = P.buildings[Math.floor(r() * P.buildings.length)];
        const x0 = side * inner; const x1 = side * (inner + depth);
        bx(b, T, Math.min(x0, x1), -8, d + 0.4, Math.max(x0, x1), h, de - 0.4, col, FX_FACADE, 0.09, ink);
        const cap = mix(col, P.ink, 0.18);
        bx(b, T, Math.min(x0, x1) - 0.2, h, d + 0.2, Math.max(x0, x1) + 0.2, h + 0.45, de - 0.2, cap, FX_PLAIN, 0.06, ink);
        // shop band + awning facing the track
        const sb = mix(col, P.ink, 0.28);
        bx(b, T, x0 - side * 0.15, -8, d + 0.6, x0 + side * 0.4, -4.6, de - 0.6, sb, FX_PLAIN, 0, ink);
        if (r() < 0.6) {
          const aw = [P.a, P.b, P.hl, P.good][Math.floor(r() * 4)];
          bx(b, T, x0 - side * 1.3, -4.7, d + 1, x0, -4.3, de - 1, aw, FX_PAPER, 0.05, ink);
        }
        const q = r();
        const xm = (x0 + x1) / 2;
        if (q < 0.28) {
          // water tank
          b.add(T.cyl6, xm, h + 2.2, -(d + de) / 2, 2.4, 2.2, 2.4, 0, mix(P.card, P.ink, 0.3), FX_PLAIN, 0.06, ink);
          for (const ox of [-0.8, 0.8]) bx(b, T, xm + ox - 0.08, h + 0.45, (d + de) / 2 - 0.08, xm + ox + 0.08, h + 1.1, (d + de) / 2 + 0.08, P.pole, FX_PLAIN, 0, ink);
        } else if (q < 0.5) {
          bx(b, T, xm - 1.2, h + 0.45, d + 1.5, xm + 1.2, h + 1.6, d + 3.5, mix(P.card, P.ink, 0.15), FX_PLAIN, 0.05, ink);
        } else if (q < 0.62 && h < 22) {
          // billboard facing the track
          const bc = r() < 0.5 ? P.a : P.b;
          const zz = (d + de) / 2;
          bx(b, T, x0 + side * 0.5 - 0.3, h + 0.45, zz - 3.2, x0 + side * 0.5 + 0.3, h + 4.6, zz + 3.2, bc, FX_PLAIN, 0.07, ink);
          bx(b, T, x0 + side * 0.2 - 0.32, h + 1.6, zz - 1.0, x0 + side * 0.2 + 0.32, h + 3.5, zz + 1.0, P.white, FX_GLOW, 0.04, ink);
        }
      }
      d = de + 1 + r() * 4;
    }
    // back row: taller, simpler
    let e = d0 + r() * 8;
    while (e < d1) {
      const w = 12 + Math.floor(r() * 14);
      const ee = Math.min(e + w, d1);
      if (ee - e > 4) {
        const inner = 22 + r() * 6;
        const h = 16 + Math.floor(r() * 10) * 3.2;
        const col = mix(P.buildings[Math.floor(r() * P.buildings.length)], P.bg, 0.25);
        bx(b, T, side > 0 ? inner : -inner - 14, -8, e, side > 0 ? inner + 14 : -inner, h, ee, col, FX_FACADE, 0.12, ink);
      }
      e = ee + 2 + r() * 6;
    }
  }
}

function buildSkyline(b, T, P) {
  const r = rng(424242);
  const ink = P.outline;
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + r() * 0.05;
    const rad = 240 + r() * 40;
    const w = 16 + r() * 26;
    const h = 22 + r() * 70;
    const col = P.skyline[Math.floor(r() * P.skyline.length)];
    b.add(T.box, Math.sin(a) * rad, h / 2 - 8, -Math.cos(a) * rad, w, h, w, a, col, FX_SKY, 0, ink);
  }
  // sun / moon
  b.add(T.discZ, -70, 92, -300, 46, 46, 2, 0, P.dark ? mix(P.card, P.white, 0.7) : mix(P.hl, P.white, 0.25), FX_SKY, 0, ink);
}
