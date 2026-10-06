// Rail Rush effects: pooled instanced particles (outlined comic puffs + sparkle bits) and the chase
// camera rig (smoothing, lane lead, shake, FOV kick, lobby orbit, finale orbit, spectate).
import { GeoBuf, FX_PLAIN, FX_GLOW } from './gfx.js';
import { LANE_W } from './tune.js';

const PUFFS = 96;
const BITS = 220;

export function createFx(THREE, world) {
  const T = world.T; const P = world.P;
  const b = new GeoBuf(THREE, 600, { dynamic: false });
  b.add(T.ico, 0, 0, 0, 1, 1, 1, 0, [1, 1, 1], FX_PLAIN, 0.07, P.outline);
  const puffGeo = b.freeze(THREE);
  b.reset();
  b.add(T.octa, 0, 0, 0, 1, 1, 1, 0, [1, 1, 1], FX_GLOW, 0, P.outline);
  const bitGeo = b.freeze(THREE);
  b.dispose();
  const mk = (geo, n) => {
    const m = new THREE.InstancedMesh(geo, world.mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false;
    world.scene.add(m);
    return m;
  };
  const puffs = mk(puffGeo, PUFFS);
  const bits = mk(bitGeo, BITS);

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

  const api = {
    /** Landing / slide dust at track position (x, y, d). */
    dust(x, y, d, n = 6, k = 1) {
      for (let i = 0; i < n; i++) spawn(PP, x + R() * 0.4, y + 0.1, d + R() * 0.3, R() * 2.2 * k, 0.6 + Math.random() * 1.4 * k, -2 - Math.random() * 3, 0.35 + Math.random() * 0.25, 0.22 + Math.random() * 0.2 * k, P.paper, -1.2, 3.5, 2);
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
    ink(x, y, d, col, n = 8) {
      for (let i = 0; i < n; i++) spawn(PP, x + R() * 0.4, y + R() * 0.4, d + R() * 0.4, R() * 4, R() * 3 + 1, R() * 4, 0.5 + Math.random() * 0.3, 0.25 + Math.random() * 0.25, col, 6, 1.5, 2);
    },
    clear() { PP.life.fill(0); BP.life.fill(0); },
    update(dt, t) {
      writePool(PP, puffs, dt, t);
      writePool(BP, bits, dt, t);
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
  const st = { x: 0, y: 4, z: 8, lx: 0, ly: 1, lz: -10, shake: 0, kick: 0, fov: 70, aspect: 1, ready: false, roll: 0, back: 0, orbit: 0 };
  return {
    cam,
    resize(w, h) { st.aspect = w / Math.max(1, h); cam.aspect = st.aspect; cam.updateProjectionMatrix(); },
    shake(a) { st.shake = Math.max(st.shake, a); },
    kick(a) { st.kick = Math.max(st.kick, a); },
    snap() { st.ready = false; },
    /**
     * mode 'run' | 'lobby' | 'finale' | 'spectate'
     * tg: { x, y, z, ground, laneX, speed, down, boost, air }
     */
    update(dt, mode, tg, t) {
      const portrait = st.aspect < 0.9;
      let px; let py; let pz; let lx; let ly; let lz; let k;
      if (mode === 'lobby') {
        const a = Math.sin(t * 0.22) * 0.55 + 0.2;
        px = Math.sin(a) * 7.5; py = 2.7; pz = -tg.z + Math.cos(a) * 7.5 - 0.5;
        lx = 0; ly = 1.25; lz = -tg.z - 0.5;
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
        py = tg.ground * 0.92 + (portrait ? 4.1 : 3.3) + Math.max(0, tg.y - tg.ground) * 0.28 + st.back * 0.5;
        pz = -tg.z + (portrait ? 6.6 : 6.0) + st.back;
        lx = tg.x * 0.72 + lead * 1.4; ly = tg.ground * 0.95 + 1.0 + Math.max(0, tg.y - tg.ground) * 0.2; lz = -tg.z - 14;
        k = 1 - Math.exp(-dt * (mode === 'spectate' ? 5 : 12));
      }
      if (!st.ready) { st.x = px; st.y = py; st.z = pz; st.lx = lx; st.ly = ly; st.lz = lz; st.ready = true; }
      st.x += (px - st.x) * k;
      st.y += (py - st.y) * (mode === 'run' ? 1 - Math.exp(-dt * 7) : k);
      st.z = mode === 'run' ? pz : st.z + (pz - st.z) * k;
      st.lx += (lx - st.lx) * k; st.ly += (ly - st.ly) * (mode === 'run' ? 1 - Math.exp(-dt * 7) : k);
      st.lz = mode === 'run' ? lz : st.lz + (lz - st.lz) * k;
      st.shake *= Math.exp(-dt * 7);
      st.kick *= Math.exp(-dt * 3);
      const sh = st.shake;
      const sx = sh * (Math.sin(t * 61) * 0.6 + Math.sin(t * 37) * 0.4);
      const sy = sh * (Math.sin(t * 53) * 0.6 + Math.sin(t * 29) * 0.4);
      cam.position.set(st.x + sx, st.y + sy, st.z);
      look.set(st.lx + sx * 0.5, st.ly + sy * 0.5, st.lz);
      cam.lookAt(look);
      const rollT = mode === 'run' ? -(tg.laneX - tg.x) * 0.012 : 0;
      st.roll += (rollT - st.roll) * (1 - Math.exp(-dt * 8));
      cam.rotateZ(st.roll);
      const base = portrait ? 72 : 56;
      const spd = mode === 'run' ? Math.min(1, Math.max(0, (tg.speed - 12) / 18)) * 7 : 0;
      const fov = base + spd + st.kick * 10;
      if (Math.abs(fov - st.fov) > 0.01) { st.fov = fov; cam.fov = fov; cam.updateProjectionMatrix(); }
    },
    get shakeAmt() { return st.shake; },
    laneW: LANE_W,
  };
}
