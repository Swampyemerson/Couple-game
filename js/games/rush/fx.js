// Rail Rush effects: pooled instanced particles (outlined comic puffs + sparkle bits) and the chase
// camera rig (smoothing, lane lead, shake, FOV kick, lobby orbit, finale orbit, spectate).
import { GeoBuf, FX_PLAIN, FX_GLOW, mix } from './gfx.js';
import { LANE_W, CHUNK } from './tune.js';
import { districtSeq, districtIn, DISTRICT_FIRST, DISTRICT_ZONE } from './track.js';
import { makeBio } from './bio.js';

const PUFFS = 96;
const BITS = 220;
const AMB = 28;       // ambient motes per viewer (drawn on the same instanced mesh as the sparkle bits)
const AMB_WIN = 64;   // metres of track ahead of a viewer they live in
const GOLD_C = [1, 0.74, 0.18];   // trail kind 5 (gold dust)
const PINK_C = [1, 0.36, 0.55];   // trail kind 6 (love hearts)
const RED_C = [0.93, 0.2, 0.3];

export function createFx(THREE, world) {
  const T = world.T; const P = world.P;
  const b = new GeoBuf(THREE, 600, { dynamic: false });
  b.add(T.lowSphere, 0, 0, 0, 1, 1, 1, 0, [1, 1, 1], FX_PLAIN, 0.11, P.outline);
  const puffGeo = b.freeze(THREE);
  b.reset();
  b.add(T.octa, 0, 0, 0, 1, 1, 1, 0, [1, 1, 1], FX_GLOW, 0, P.outline);
  const bitGeo = b.freeze(THREE);
  b.dispose();
  const mk = (geo, n) => {
    const m = new THREE.InstancedMesh(geo, world.matInstC, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false;
    world.scene.add(m);
    return m;
  };
  const puffs = mk(puffGeo, PUFFS);
  const bits = mk(bitGeo, BITS + AMB * 2);

  const mkPool = (n) => ({
    n, cur: 0,
    x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n),
    life: new Float32Array(n), max: new Float32Array(n), size: new Float32Array(n), rot: new Float32Array(n),
    r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), grav: new Float32Array(n), drag: new Float32Array(n),
    kind: new Uint8Array(n), // 0 normal, 1 orbit (stars), 2 grow-fade (puff)
    ox: new Float32Array(n), oz: new Float32Array(n),
  });
  const PP = mkPool(PUFFS);
  const dustCol = P.dark ? [0.42, 0.4, 0.44] : [0.86, 0.83, 0.78];
  const BP = mkPool(BITS);

  function spawn(pool, x, y, z, vx, vy, vz, life, size, col, grav, drag, kind) {
    let i = -1;
    for (let k = 0; k < pool.n; k++) { const j = (pool.cur + k) % pool.n; if (pool.life[j] <= 0) { i = j; break; } }
    if (i < 0) i = pool.cur;
    pool.cur = (i + 1) % pool.n;
    pool.x[i] = x; pool.y[i] = y; pool.z[i] = z; pool.vx[i] = vx; pool.vy[i] = vy; pool.vz[i] = vz;
    pool.life[i] = life; pool.max[i] = life; pool.size[i] = size; pool.rot[i] = Math.random() * 6;
    pool.r[i] = col[0]; pool.g[i] = col[1]; pool.b[i] = col[2]; pool.grav[i] = grav; pool.drag[i] = drag; pool.kind[i] = kind;
    pool.ox[i] = x; pool.oz[i] = z;
    return i;
  }
  const R = () => Math.random() * 2 - 1;

  // ── ambient motes per district: harbour spray and gulls, Greenway leaves and petals, Old Town confetti,
  // Neon Market lantern sparks, Freight Yard embers and dust. Stateless: each mote lives on a fixed lattice of the
  // track (a window of AMB_WIN m ahead of each viewer; it re-rolls its look every lap), so nothing is spawned,
  // pooled or allocated per frame; one pass writes straight into the instance arrays after the sparkle bits.
  const calmMotion = (() => { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } })();
  const BIO = makeBio(P);
  const orangeC = mix(P.bad, P.hl, 0.5);
  const mc = (c) => [c[0], c[1], c[2]];
  const MOTE = [
    null,
    [mc(P.white), mc(mix(P.a, P.white, 0.6)), mc(BIO[1].foam)],                                     // harbour: spray; gulls are white
    [mc(BIO[2].crown[0]), mc(BIO[2].crown[1]), mc(BIO[2].crown[2]), mc(BIO[2].blossom), mc(P.white)], // greenway
    BIO[3].bunt.map(mc),                                                                              // old town confetti
    BIO[4].glow.map(mc),                                                                              // neon market lanterns
    [mc(P.bad), mc(orangeC), mc(mix(P.bad, P.white, 0.3)), mc(mix(P.muted, P.card, 0.4)), mc(mix(P.muted, P.card, 0.4))], // freight embers + dust
  ];
  const AOFF = new Float32Array(AMB);
  // (squared: denser close to the runner, where a mote is big enough to read on a phone)
  for (let i = 0; i < AMB; i++) { const u = (i + 0.5 + Math.sin(i * 12.9898) * 0.35) / AMB; AOFF[i] = u * (0.35 + 0.65 * u); }
  const AS = { seed: null, seq: null, n: 0 };

  const api = {
    /** Landing / slide dust at track position (x, y, d). */
    dust(x, y, d, n = 6, k = 1) {
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        spawn(PP, x + side * (0.25 + Math.random() * 0.3), y + 0.12, d + R() * 0.3, side * (1 + Math.random() * 1.6) * k, 0.5 + Math.random() * 1.2 * k, -1.5 - Math.random() * 2, 0.38 + Math.random() * 0.25, 0.34 + Math.random() * 0.24 * k, dustCol, -1.4, 3.2, 2);
      }
    },
    coin(x, y, d) {
      for (let i = 0; i < 5; i++) spawn(BP, x, y, d, R() * 3, 2 + Math.random() * 3, R() * 2 + 4, 0.35, 0.16, P.hl, 9, 1.5, 0);
    },
    trail(x, y, d) { spawn(BP, x + R() * 0.15, y + R() * 0.15, d + R() * 0.15, 0, 0.3, 0, 0.25, 0.12, P.hl, 0, 0, 0); },
    burst(x, y, d, col, n = 10, spd = 5) {
      for (let i = 0; i < n; i++) spawn(BP, x, y, d, R() * spd, Math.random() * spd, R() * spd, 0.5 + Math.random() * 0.3, 0.18 + Math.random() * 0.12, col, 12, 1.2, 0);
    },
    crash(x, y, d) {
      for (let i = 0; i < 9; i++) spawn(PP, x + R() * 0.5, y + 0.6 + Math.random(), d + R() * 0.5, R() * 3, 1 + Math.random() * 3, R() * 3, 0.5 + Math.random() * 0.3, 0.35 + Math.random() * 0.3, P.paper, -0.5, 2.5, 2);
      api.burst(x, y + 1, d, P.hl, 8, 6);
      api.burst(x, y + 1, d, P.outline, 6, 5);
    },
    /** Comic stars circling a head. */
    stars(x, y, d, n = 3, life = 1.6) {
      for (let i = 0; i < n; i++) {
        const j = spawn(BP, x, y, d, 0, 0, 0, life, 0.2, P.hl, 0, 0, 1);
        BP.rot[j] = (i / n) * Math.PI * 2;
      }
    },
    confetti(x, y, d, cols, n = 40) {
      for (let i = 0; i < n; i++) spawn(BP, x + R() * 3, y + 3 + Math.random() * 3, d + R() * 3, R() * 4, 2 + Math.random() * 5, R() * 4, 1.6 + Math.random() * 1.2, 0.16 + Math.random() * 0.1, cols[i % cols.length], 5, 1.8, 0);
    },
    /** Near-miss sparkle: a ring of glints beside the runner on the obstacle's side. */
    sparkle(x, y, d, side) {
      for (let i = 0; i < 7; i++) spawn(BP, x + side * 0.7 + R() * 0.2, y + 0.6 + Math.random() * 1.2, d + R() * 0.4, side * (1.5 + Math.random() * 2), 1 + Math.random() * 2.5, -2 - Math.random() * 3, 0.32 + Math.random() * 0.2, 0.14 + Math.random() * 0.1, P.white, 2, 2.5, 0);
      for (let i = 0; i < 4; i++) spawn(BP, x + side * 0.6, y + 1 + Math.random() * 0.8, d, side * (0.5 + Math.random()), 0.5 + Math.random(), -1, 0.4, 0.2, P.hl, 1, 2, 1);
    },
    /**
     * Unlockable trail behind a runner. kind 1 sparkle, 2 ink puffs (player colour), 3 confetti,
     * 4 embers, 5 gold dust, 6 love hearts. Called every frame; it spawns on its own cadence.
     */
    trailFx(kind, x, y, d, col, k) {
      if (kind === 1) { spawn(BP, x + R() * 0.35, y + 0.5 + Math.random() * 1.0, d - 0.5, R() * 0.8, 0.8 + Math.random() * 1.2, -0.5, 0.5, 0.13 + Math.random() * 0.1, Math.random() < 0.6 ? P.hl : P.white, 0, 1.5, 0); }
      else if (kind === 2) { if (k % 3) return; spawn(PP, x + R() * 0.25, y + 0.35 + Math.random() * 0.3, d - 0.6, R() * 0.5, 0.4 + Math.random() * 0.6, -1.5, 0.5 + Math.random() * 0.2, 0.18 + Math.random() * 0.14, col, -0.4, 2.2, 2); }
      else if (kind === 3) { spawn(BP, x + R() * 0.5, y + 0.8 + Math.random() * 1.2, d - 0.4, R() * 2.5, 1.5 + Math.random() * 2.5, -1 - Math.random() * 2, 0.8 + Math.random() * 0.5, 0.16 + Math.random() * 0.1, k % 6 < 2 ? P.a : k % 6 < 4 ? P.b : P.hl, 5, 1.6, 0); }
      else if (kind === 4) { if (k % 2) return; spawn(BP, x + R() * 0.3, y + 0.2 + Math.random() * 0.4, d - 0.5, R() * 0.4, 1.2 + Math.random() * 2, -1 - Math.random() * 2, 0.35 + Math.random() * 0.25, 0.1 + Math.random() * 0.1, Math.random() < 0.5 ? P.bad : P.hl, -2, 1.2, 0); }
      // 5 gold dust: glints in coin gold (and the theme's highlight) that settle slowly
      else if (kind === 5) { spawn(BP, x + R() * 0.3, y + 0.4 + Math.random() * 1.1, d - 0.5, R() * 0.5, 0.15 + Math.random() * 0.5, -0.6, 0.6 + Math.random() * 0.25, 0.12 + Math.random() * 0.1, Math.random() < 0.65 ? GOLD_C : P.hl, 0.9, 1.3, 0); }
      // 6 love hearts: three bits that travel together (two lobes over a point = a small heart from behind), pink or red, drifting up
      else if (kind === 6) {
        if (k % 4) return;
        const hx = x + R() * 0.35; const hy = y + 0.9 + Math.random() * 0.8; const hz = d - 0.5;
        const vx = R() * 0.35; const vy = 0.7 + Math.random() * 0.5;
        const c = k % 8 ? PINK_C : RED_C;
        spawn(BP, hx - 0.1, hy + 0.07, hz, vx, vy, -0.6, 1.3, 0.17, c, 0, 0.6, 0);
        spawn(BP, hx + 0.1, hy + 0.07, hz, vx, vy, -0.6, 1.3, 0.17, c, 0, 0.6, 0);
        spawn(BP, hx, hy - 0.08, hz, vx, vy, -0.6, 1.3, 0.17, c, 0, 0.6, 0);
      }
    },
    ink(x, y, d, col, n = 8) {
      for (let i = 0; i < n; i++) spawn(PP, x + R() * 0.4, y + R() * 0.4, d + R() * 0.4, R() * 4, R() * 3 + 1, R() * 4, 0.5 + Math.random() * 0.3, 0.25 + Math.random() * 0.25, col, 6, 1.5, 2);
    },
    clear() { PP.life.fill(0); BP.life.fill(0); },
    update(dt, t) {
      writePool(PP, puffs, dt, t);
      writePool(BP, bits, dt, t);
    },
    /** Ambient motes around the viewers at track positions zs[0..nz) (call after update, before drawing). */
    ambient(seed, zs, nz, t) {
      if (calmMotion) return;
      if (AS.seed !== seed || !AS.seq) { AS.seed = seed; AS.seq = districtSeq(seed); }
      const seq = AS.seq;
      const a = bits.instanceMatrix.array; const ca = bits.instanceColor.array;
      let n = bits.count;
      for (let v = 0; v < nz && v < 2; v++) {
        const z0 = zs[v];
        if (!(z0 > 0)) continue;
        const base = z0 - 1;
        for (let i = 0; i < AMB; i++) {
          const off = AOFF[i] * AMB_WIN;
          const lap = Math.floor((base - off) / AMB_WIN) + 1;
          const zw = off + lap * AMB_WIN;
          const ci = Math.floor(zw / CHUNK);
          const dd = ci < 0 ? 0 : districtIn(seq, ci);
          if (dd === 0) continue;
          let h = Math.imul(i * 7919 + lap * 104729 + 17, 0x9E3779B1);
          h ^= h >>> 15; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13;
          const r1 = (h & 1023) / 1023; const r2 = ((h >>> 10) & 1023) / 1023; const r3 = ((h >>> 20) & 1023) / 1023;
          const u = (zw - base) / AMB_WIN;
          let fade = u * 12; if (fade > 1) fade = 1; const fo = (1 - u) * 5; if (fo < fade) fade = fo;
          const pal = MOTE[dd];
          const side = r2 < 0.5 ? -1 : 1;
          let x = 0; let y = 0; let s = 0.15; let sy = 1; let sx = 1; let ci2 = 0; let ry = r3 * 6.28 + t * 2;
          const ph = r1 * 6.28;
          if (dd === 1) {
            // harbour: gulls over the water, spray just above it (the water side swaps every zone, as in bio.js)
            const ws = Math.floor((ci - DISTRICT_FIRST) / DISTRICT_ZONE) % 2 ? 1 : -1;
            if (r3 < 0.2) {
              x = ws * (9 + r1 * 16) + Math.sin(t * 0.3 + ph) * 3; y = 6.5 + r2 * 4 + Math.sin(t * 0.7 + ph) * 0.4; s = 0.5; sx = 1.5; sy = 0.12 + 0.4 * Math.abs(Math.sin(t * 5 + ph * 3)); ry = 0.4 + Math.sin(t * 0.3 + ph) * 0.3; ci2 = 0;
            } else {
              const k = (t * 0.45 + r3 * 7) % 1;
              x = ws * (9.6 + r1 * 7); y = -3.1 + k * 2.4 + r2 * 0.6; s = 0.1 + 0.07 * r2; fade *= Math.sin(k * 3.14159); ci2 = 1 + (r1 > 0.6 ? 1 : 0);
            }
          } else if (dd === 2) {
            // greenway: leaves and petals swirling down
            const k = (t * 0.22 + r3 * 5) % 1;
            x = side * (3.9 + r1 * 5) + Math.sin(t * 0.9 + ph) * 0.8; y = 5.2 - k * 4.6 + r2 * 0.8; s = 0.15 + 0.07 * r1; fade *= Math.sin(k * 3.14159); ci2 = Math.floor(r1 * 5); sy = 0.35 + 0.65 * Math.abs(Math.sin(t * 4 + ph * 2));
          } else if (dd === 3) {
            // old town: confetti fluttering down from the bunting
            const k = (t * 0.3 + r3 * 5) % 1;
            x = side * (3.9 + r1 * 3.2) + Math.sin(t * 1.4 + ph) * 0.6; y = 6.6 - k * 5.8 + r2 * 0.6; s = 0.14 + 0.06 * r1; fade *= Math.sin(k * 3.14159); ci2 = Math.floor(r1 * 5); sy = 0.15 + 0.85 * Math.abs(Math.sin(t * 7 + ph * 3));
          } else if (dd === 4) {
            // neon market: lantern sparks drifting up
            const k = (t * 0.2 + r3 * 5) % 1;
            x = side * (3.9 + r1 * 4.5) + Math.sin(t * 0.8 + ph) * 0.6; y = 0.4 + k * 7.5; s = 0.1 + 0.07 * r2; fade *= Math.sin(k * 3.14159); ci2 = Math.floor(r2 * 5);
          } else {
            // freight yard: embers rising from the sidings, dust drifting along the rail
            const k = (t * 0.25 + r3 * 5) % 1;
            if (r2 < 0.5) { x = side * (4.2 + r1 * 4) + Math.sin(t * 1.1 + ph) * 0.7; y = 0.3 + k * 4.6; s = 0.08 + 0.06 * r1; fade *= Math.sin(k * 3.14159); ci2 = r1 < 0.5 ? 0 : 1 + (r1 > 0.8 ? 1 : 0); }
            else { x = side * (3.8 + r1 * 5) + Math.sin(t * 0.5 + ph) * 1.4; y = 0.6 + r3 * 3.5 + Math.sin(t * 0.6 + ph) * 0.3; s = 0.22 + 0.12 * r1; fade *= 0.55; ci2 = 3 + (r1 > 0.5 ? 1 : 0); sy = 0.5; }
          }
          const sz = s * fade;
          if (sz < 0.01) continue;
          const c = Math.cos(ry); const sn = Math.sin(ry);
          const o = n * 16;
          a[o] = c * sz * sx; a[o + 1] = 0; a[o + 2] = -sn * sz * sx; a[o + 3] = 0;
          a[o + 4] = 0; a[o + 5] = sz * sy; a[o + 6] = 0; a[o + 7] = 0;
          a[o + 8] = sn * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
          a[o + 12] = x; a[o + 13] = y; a[o + 14] = -zw; a[o + 15] = 1;
          const col = pal[ci2 % pal.length];
          ca[n * 3] = col[0]; ca[n * 3 + 1] = col[1]; ca[n * 3 + 2] = col[2];
          n++;
        }
      }
      bits.count = n;
      bits.instanceMatrix.needsUpdate = true; bits.instanceColor.needsUpdate = true;
    },
    warm: [puffs, bits],
    dispose() {
      world.scene.remove(puffs); world.scene.remove(bits);
      puffGeo.dispose(); bitGeo.dispose();
      try { puffs.dispose(); bits.dispose(); } catch { /* ignore */ }
    },
  };

  function writePool(pool, mesh, dt, t) {
    const a = mesh.instanceMatrix.array;
    const ca = mesh.instanceColor.array;
    let n = 0;
    for (let i = 0; i < pool.n; i++) {
      if (pool.life[i] <= 0) continue;
      pool.life[i] -= dt;
      if (pool.life[i] <= 0) continue;
      const u = pool.life[i] / pool.max[i];
      let s = pool.size[i];
      let x; let y; let z;
      if (pool.kind[i] === 1) {
        // orbit around the spawn point
        const ang = pool.rot[i] + t * 7;
        x = pool.ox[i] + Math.cos(ang) * 0.45; y = pool.y[i] + Math.sin(t * 9 + pool.rot[i]) * 0.06; z = pool.oz[i] + Math.sin(ang) * 0.45;
        s *= Math.min(1, u * 4);
      } else {
        const dr = Math.exp(-pool.drag[i] * dt);
        pool.vx[i] *= dr; pool.vy[i] = pool.vy[i] * dr - pool.grav[i] * dt; pool.vz[i] *= dr;
        pool.x[i] += pool.vx[i] * dt; pool.y[i] += pool.vy[i] * dt; pool.z[i] += pool.vz[i] * dt;
        x = pool.x[i]; y = pool.y[i]; z = pool.z[i];
        if (pool.kind[i] === 2) s *= 0.6 + (1 - u) * 0.8 * (u > 0.3 ? 1 : u / 0.3) + 0.0; else s *= Math.min(1, u * 3);
        if (pool.kind[i] === 2 && u < 0.3) s *= u / 0.3;
      }
      pool.rot[i] += dt * 6;
      const r = pool.rot[i];
      const c = Math.cos(r) * s; const sn = Math.sin(r) * s;
      const o = n * 16;
      a[o] = c; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0;
      a[o + 12] = x; a[o + 13] = y; a[o + 14] = -z; a[o + 15] = 1;
      ca[n * 3] = pool.r[i]; ca[n * 3 + 1] = pool.g[i]; ca[n * 3 + 2] = pool.b[i];
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
  return api;
}

/** Chase camera for one view. */
export function createRig(THREE) {
  const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 460);
  const look = new THREE.Vector3();
  const st = { x: 0, y: 4, z: 8, lx: 0, ly: 1, lz: -10, shake: 0, kick: 0, fov: 70, aspect: 1, ready: false, roll: 0, back: 0, orbit: 0, short: false };
  // Run mode follows with critically damped springs (Game Programming Gems 4.4 "SmoothDamp"): a lane
  // change moves the follow target by a step, and an exponential blend answers a step with an instant
  // velocity (infinite jerk); a spring starts from rest, so the camera eases into the move yet is
  // already travelling the next frame. Sideways (x and look x) two springs in series (a 0.025 s one
  // smooths the target, a 0.09 s one follows it) so the acceleration is continuous too: about half
  // the peak jerk of one spring, still 1 cm of travel in the first 60 Hz frame and settled in ~0.25 s
  // with no overshoot. Frame-rate independent (the GPG formula is exact to a few ‰ at 30 Hz).
  // S holds channel c at [2c] (position) and [2c+1] (velocity): 0 x, 1 y, 2 look x, 3 look y, 4 roll,
  // 5 / 6 the smoothed x / look x targets. D: target, smooth time, dt (scratch doubles: no boxing per call).
  const S = new Float64Array(14); const D = new Float64Array(3);
  const dbg = typeof window !== 'undefined' ? window.__RUSH_DEBUG : null; // dbg.oldCam: the earlier exponential follow (to measure against)
  function damp(c) {
    const om = 2 / D[1]; const x = om * D[2];
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const ch = S[2 * c] - D[0]; const tmp = (S[2 * c + 1] + om * ch) * D[2];
    S[2 * c + 1] = (S[2 * c + 1] - om * tmp) * e;
    S[2 * c] = D[0] + (ch + tmp) * e;
  }
  return {
    cam,
    /** short: a landscape phone, where the lobby sheet covers the left half */
    resize(w, h, short = false) { st.aspect = w / Math.max(1, h); st.short = !!short; cam.aspect = st.aspect; cam.updateProjectionMatrix(); },
    shake(a) { st.shake = Math.max(st.shake, a); },
    kick(a) { st.kick = Math.max(st.kick, a); },
    /** Crash punch: the view snaps a few degrees narrower and relaxes (a zoom-in hit). */
    punch(a) { st.kick = Math.min(st.kick, -a); },
    snap() { st.ready = false; },
    /**
     * mode 'run' | 'lobby' | 'finale' | 'spectate'
     * tg: { x, y, z, ground, laneX, speed, down, boost, air }
     */
    update(dt, mode, tg, t) {
      const portrait = st.aspect < 0.9;
      let px; let py; let pz; let lx; let ly; let lz; let k;
      if (mode === 'lobby') {
        // in front of the two runners, looking back at their faces, swaying slowly
        const a = Math.sin(t * 0.25) * 0.3;
        const R = portrait ? 11.5 : 7.6;
        // landscape phone: both runners in the right half, clear of the sheet (this camera looks back
        // along the track, so its right is world -x: aim at +x)
        const sx = st.short ? 5.4 : 0;
        px = sx + Math.sin(a) * R; py = portrait ? 2.3 : 2.1; pz = -tg.z - Math.cos(a) * R;
        lx = sx; ly = portrait ? 0.35 : 1.0; lz = -tg.z;
        k = 1 - Math.exp(-dt * 3);
      } else if (mode === 'finale') {
        st.orbit += dt * 0.5;
        const a = st.orbit + 0.6;
        px = tg.x + Math.sin(a) * 5.2; py = tg.ground + 2.4; pz = -tg.z - Math.cos(a) * 5.2;
        lx = tg.x; ly = tg.ground + 1.3; lz = -tg.z;
        k = 1 - Math.exp(-dt * 2.5);
      } else {
        const lead = (tg.laneX - tg.x) * 0.28;
        px = tg.x * 0.6 + lead;
        const back = tg.down ? 2.4 : 0;
        st.back += (back - st.back) * (1 - Math.exp(-dt * 3));
        // a little higher and steeper than eye level: more track ahead, less empty sky
        py = tg.ground * 0.92 + (portrait ? 4.5 : 4.2) + Math.max(0, tg.y - tg.ground) * 0.28 + st.back * 0.5;
        pz = -tg.z + (portrait ? 6.5 : 7.2) + st.back;
        lx = tg.x * 0.72 + lead * 1.4; ly = tg.ground * 0.95 + (portrait ? 0.75 : 0.45) + Math.max(0, tg.y - tg.ground) * 0.2; lz = -tg.z - (portrait ? 15 : 10);
        k = 1 - Math.exp(-dt * (mode === 'spectate' ? 5 : 12));
      }
      if (!st.ready) { st.x = px; st.y = py; st.z = pz; st.lx = lx; st.ly = ly; st.lz = lz; S.fill(0); S[10] = px; S[12] = lx; st.ready = true; }
      const spring = mode === 'run' && !(dbg && dbg.oldCam);
      if (spring) {
        // sideways 0.025 s into 0.09 s, vertical 0.18 s (ground steps up onto a roof, jumps), roll 0.14 s
        S[0] = st.x; S[2] = st.y; S[4] = st.lx; S[6] = st.ly;
        D[2] = dt < 0.25 ? dt : 0.25;
        D[1] = 0.025; D[0] = px; damp(5); D[0] = lx; damp(6);
        D[1] = 0.09; D[0] = S[10]; damp(0); D[0] = S[12]; damp(2);
        D[1] = 0.18; D[0] = py; damp(1); D[0] = ly; damp(3);
        st.x = S[0]; st.y = S[2]; st.lx = S[4]; st.ly = S[6];
        st.z = pz; st.lz = lz;
      } else {
        st.x += (px - st.x) * k;
        st.y += (py - st.y) * (mode === 'run' ? 1 - Math.exp(-dt * 7) : k);
        st.z = mode === 'run' ? pz : st.z + (pz - st.z) * k;
        st.lx += (lx - st.lx) * k; st.ly += (ly - st.ly) * (mode === 'run' ? 1 - Math.exp(-dt * 7) : k);
        st.lz = mode === 'run' ? lz : st.lz + (lz - st.lz) * k;
        S.fill(0); S[10] = st.x; S[12] = st.lx; // (so a spring starts from rest, where the camera is)
      }
      st.shake *= Math.exp(-dt * 7);
      st.kick *= Math.exp(-dt * 3);
      const sh = st.shake;
      const sx = sh * (Math.sin(t * 61) * 0.6 + Math.sin(t * 37) * 0.4);
      const sy = sh * (Math.sin(t * 53) * 0.6 + Math.sin(t * 29) * 0.4);
      cam.position.set(st.x + sx, st.y + sy, st.z);
      look.set(st.lx + sx * 0.5, st.ly + sy * 0.5, st.lz);
      cam.lookAt(look);
      const rollT = mode === 'run' ? -(tg.laneX - tg.x) * 0.012 : 0;
      if (spring) { S[8] = st.roll; D[2] = dt < 0.25 ? dt : 0.25; D[1] = 0.14; D[0] = rollT; damp(4); st.roll = S[8]; }
      else st.roll += (rollT - st.roll) * (1 - Math.exp(-dt * 8));
      cam.rotateZ(st.roll);
      // narrower than before so obstacles 50 m out are ~10 % larger; speed still widens it
      const base = portrait ? 69 : 58;
      const spd = mode === 'run' ? Math.min(1, Math.max(0, (tg.speed - 12) / 18)) * 8 : 0;
      const fov = base + spd + st.kick * 10;
      if (Math.abs(fov - st.fov) > 0.01) { st.fov = fov; cam.fov = fov; cam.updateProjectionMatrix(); }
    },
    get shakeAmt() { return st.shake; },
    laneW: LANE_W,
  };
}

// ── screen overlay: manga speed lines + a corner vignette, drawn in WebGL after the scene ──
// Both are thin geometry in clip space (no full-screen layer, so no full-screen overdraw): ~30
// opaque tapered triangles that radiate from the vanishing point, and four translucent corner
// wedges. Two draw calls per view; the line positions are rewritten in place each frame.
const OV_VERT = `attribute float va; varying float vA;
void main() { vA = va; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;
const OV_FRAG = `uniform vec3 uCol; uniform float uK; varying float vA;
void main() { gl_FragColor = vec4( uCol, vA * uK ); }`;
const LINES = 30;
const VIG_SEG = 40;

export function createOverlay(THREE, P) {
  const scene = new THREE.Scene();
  scene.autoUpdate = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mkMat = (col, transparent) => new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color().fromArray(col) }, uK: { value: 1 } },
    vertexShader: OV_VERT, fragmentShader: OV_FRAG, depthTest: false, depthWrite: false, transparent, fog: false,
    side: THREE.DoubleSide, // the line triangles wind either way
  });
  // speed lines (opaque paper streaks)
  const lp = new Float32Array(LINES * 9);
  const la = new Float32Array(LINES * 3).fill(1);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage));
  lg.setAttribute('va', new THREE.BufferAttribute(la, 1));
  lg.setDrawRange(0, 0);
  const lineMat = mkMat(P.dark ? mix3(P.white, P.hl, 0.2) : P.white, false);
  const lines = new THREE.Mesh(lg, lineMat);
  lines.frustumCulled = false; lines.matrixAutoUpdate = false; lines.renderOrder = 2;
  scene.add(lines);
  // vignette: wedges between the inscribed ellipse and the frame (alpha 0 inside, ink in corners)
  const vp = new Float32Array(VIG_SEG * 2 * 3);
  const vaa = new Float32Array(VIG_SEG * 2);
  const vi = [];
  for (let i = 0; i < VIG_SEG; i++) {
    const j = (i + 1) % VIG_SEG;
    vi.push(i * 2, i * 2 + 1, j * 2, j * 2, i * 2 + 1, j * 2 + 1);
  }
  for (let i = 0; i < VIG_SEG; i++) {
    const t = (i / VIG_SEG) * Math.PI * 2;
    const cx = Math.cos(t); const sy = Math.sin(t);
    const edge = Math.min(1 / Math.max(1e-6, Math.abs(cx)), 1 / Math.max(1e-6, Math.abs(sy)));
    vp[i * 6] = cx; vp[i * 6 + 1] = sy;                 // on the ellipse (touches the edge midpoints)
    vp[i * 6 + 3] = cx * edge; vp[i * 6 + 4] = sy * edge; // on the frame
    vaa[i * 2] = 0; vaa[i * 2 + 1] = Math.min(1, Math.max(0, (edge - 1.04) / 0.38));
  }
  const vg = new THREE.BufferGeometry();
  vg.setAttribute('position', new THREE.BufferAttribute(vp, 3));
  vg.setAttribute('va', new THREE.BufferAttribute(vaa, 1));
  vg.setIndex(vi);
  const vigMat = mkMat(P.outline, true);
  vigMat.uniforms.uK.value = P.dark ? 0.32 : 0.15;
  const vig = new THREE.Mesh(vg, vigMat);
  vig.frustumCulled = false; vig.matrixAutoUpdate = false; vig.renderOrder = 1;
  scene.add(vig);

  const ang = new Float32Array(LINES); const inn = new Float32Array(LINES); const wid = new Float32Array(LINES);
  // xorshift32 in an Int32Array: Math.random's result gets boxed when V8 doesn't inline the call
  const seed = new Int32Array([0x2f6b5a1d]);
  const rnd = () => { let x = seed[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; seed[0] = x; return (x >>> 0) / 4294967296; };
  const reroll = (i) => { ang[i] = rnd() * Math.PI * 2; inn[i] = rnd(); wid[i] = 0.5 + rnd(); };
  for (let i = 0; i < LINES; i++) reroll(i);
  const O = { aspect: 0.5, tick: 0 }; O.aspect = 1; // object fields: no per-frame boxing (see avatar.js)
  const VY = 0.16; // the vanishing point sits a little above the middle of the view

  function writeLines(k) {
    const n = k > 0 ? Math.min(LINES, 6 + Math.round((LINES - 6) * Math.min(1, k))) : 0;
    O.tick++;
    for (let i = 0; i < n; i++) {
      if ((i + O.tick) % 3 === 0) reroll(i); // flicker: a third of the lines jump every frame
      const c = Math.cos(ang[i]); const s = Math.sin(ang[i]);
      // in "y units" (x stretched by the aspect), the frame is |x| <= aspect, |y| <= 1
      const dx = c; const dy = s;
      const tx = Math.abs(dx) > 1e-6 ? O.aspect / Math.abs(dx) : 1e9;
      const ty = Math.abs(dy) > 1e-6 ? (dy > 0 ? 1 - VY : 1 + VY) / Math.abs(dy) : 1e9;
      const edge = Math.min(tx, ty);
      const kk = Math.min(1, k);
      const r0 = edge * (1 - (0.2 + 0.28 * inn[i]) * (0.55 + 0.45 * kk)); const r1 = edge * 1.06;
      const w = (0.012 + 0.016 * wid[i]) * (0.7 + 0.5 * kk);
      const o = i * 9;
      lp[o] = (dx * r0) / O.aspect; lp[o + 1] = VY + dy * r0;
      lp[o + 3] = (dx * r1 - dy * w) / O.aspect; lp[o + 4] = VY + dy * r1 + dx * w;
      lp[o + 6] = (dx * r1 + dy * w) / O.aspect; lp[o + 7] = VY + dy * r1 - dx * w;
    }
    lg.setDrawRange(0, n * 3);
    const at = lg.getAttribute('position');
    at.updateRange.offset = 0; at.updateRange.count = n * 9; at.needsUpdate = true;
    lines.visible = n > 0;
  }

  return {
    scene, cam,
    resize(w, h) { const a = w / Math.max(1, h); if (a !== O.aspect) O.aspect = a; },
    /** Lay out the speed lines for one view. k: 0..1 speed (0 = none). */
    update(k) { writeLines(k > 0.02 ? k : 0); },
    /** Draw the overlay into the current viewport (right after the scene). */
    render(renderer) { renderer.render(scene, cam); },
    /** Make every overlay program compile (shader warm-up). */
    warm(renderer) { writeLines(1); renderer.render(scene, cam); writeLines(0); },
    dispose() { lg.dispose(); vg.dispose(); lineMat.dispose(); vigMat.dispose(); },
  };
}
function mix3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
