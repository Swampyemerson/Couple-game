// Getaway car visuals: the runner's muscle car (player colour + stripes) and the police cruiser
// (black & white, lightbar) from carmodel.js, all player wheels as one instanced mesh (tyres,
// rims, steering and rolling), traffic in four silhouettes with three levels of detail, and the
// per-car light state: head / tail / brake / reverse lenses, glow halos and night beams, the
// lightbar flash, a soft contact shadow, body lean, dirt, scratches and dents.
// Lights, halos and contact shadows go through world.lights (reached as mats.lights).
import { Builder, makeToon, cssRGB } from './gfx.js';
import { buildPlayerCar, buildPlayerWheel, buildTrafficCar, buildTrafficFar, SHAPES } from './carmodel.js';
import { castShadow, SHADOW_LAYER } from './render.js';

const WHEELS = [[0.885, 1.4], [-0.885, 1.4], [0.885, -1.38], [-0.885, -1.38]]; // x, z (front = +z)
const WHEEL_R = 0.37;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The player car body geometry (model space: +z forward, y up, origin on the ground at the centre). */
export function buildCarBody(THREE, P, kind, ink) { return buildPlayerCar(THREE, P, kind, ink); }
export function buildWheel(THREE, P) { return buildPlayerWheel(THREE, P); }

/** A player car. pose() places it; update(c, dt) drives lights, lean, dirt and damage. */
export function createCarView(THREE, P, U, kind, ink, mats) {
  const group = new THREE.Group();
  const tilt = new THREE.Group(); group.add(tilt);
  const mat = makeToon(THREE, U, null, { vertexColors: true }); // own uCar / uFlash, same program
  const geo = buildCarBody(THREE, P, kind, ink);
  const body = new THREE.Mesh(geo, mat);
  body.frustumCulled = false;
  tilt.add(body);
  castShadow(group);
  const uCar = mat.userData.gtw.uCar.value; const uFlash = mat.userData.gtw.uFlash.value;
  const pa = geo.getAttribute('position'); const orig = pa.array.slice();
  const flash = { t: 0, on: false, ph: -1 };
  const st = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, vp: 0, vr: 0, pvx: 0, pvz: 0, hp: 100, dirt: 0, dmg: 0, init: false, given: false };
  const L = () => mats && mats.lights;
  const night = !!P.dark;
  const isCop = kind === 'cop';
  function local(lx, ly, lz, out) {
    const s = Math.sin(st.yaw); const c = Math.cos(st.yaw);
    // forward = (sin, −cos), right = (cos, sin)
    out[0] = st.x + c * lx + s * lz; out[1] = st.y + ly; out[2] = st.z + s * lx - c * lz; return out;
  }
  const tp = [0, 0, 0];
  function dentAt(lx, lz, k) {
    const A = pa.array; const n = pa.count; const R = 0.95;
    for (let i = 0; i < n; i++) {
      const x = A[i * 3]; const y = A[i * 3 + 1]; const z = A[i * 3 + 2];
      const dx = x - lx; const dz = z - lz; const dy = y - 0.75; const d2 = dx * dx + dz * dz + dy * dy * 0.6;
      if (d2 > R * R) continue;
      const f = (1 - Math.sqrt(d2) / R) * k;
      const nx = -Math.sign(x) * Math.min(1, Math.abs(x)); const nz = Math.abs(lz) > 1.6 ? -Math.sign(z) : 0;
      A[i * 3] += nx * f * 0.12; A[i * 3 + 2] += nz * f * 0.12; A[i * 3 + 1] -= f * 0.035;
    }
    pa.needsUpdate = true;
  }
  const api = {
    group, tilt, body, red: null, blue: null, mat,
    /** pose: x y z yaw pitch roll; flat 0..1 sags the car */
    pose(x, y, z, yaw, pitch, roll, flat) {
      group.position.set(x, y, z);
      group.rotation.set(0, Math.PI - yaw, 0);
      st.x = x; st.y = y; st.z = z; st.yaw = yaw;
      st.given = !!(pitch || roll);
      if (st.given) { st.pitch = pitch; st.roll = roll; }
      tilt.rotation.set(st.pitch, 0, -st.roll, 'YXZ');
      tilt.position.y = -0.12 * flat;
    },
    /** lightbar flashing; returns 0 (red), 1 (blue) or −1 (off) for the surface tint */
    flash(dt, on) {
      if (!isCop) return -1;
      flash.t += dt; flash.on = on;
      if (!on) { uFlash.set(0.32, 0.32); flash.ph = -1; return -1; }
      const ph = Math.floor(flash.t * 7) % 4; // R R B B
      const rOn = ph === 0 || ph === 1; const bOn = ph === 2 || ph === 3;
      const pul = (Math.floor(flash.t * 14) & 1) ? 1 : 0.6;
      uFlash.set(rOn ? 1.5 * pul : 0.3, bOn ? 1.5 * pul : 0.3);
      flash.ph = rOn ? 0 : 1; flash.pul = pul;
      return rOn ? 0 : 1;
    },
    /**
     * Per-frame state from the car c (fields are feature-detected): braking / vf (reverse),
     * hp (scratches; a drop dents the side it came from), surf (dirt), vx/vz (lean when the
     * physics gives no pitch/roll). Pushes lights and the contact shadow. Call after pose().
     */
    update(c, dt) {
      if (!group.visible || !c) return;
      dt = Math.min(0.1, dt || 0.016);
      const vx = c.vx || 0; const vz = c.vz || 0;
      if (!st.init) { st.pvx = vx; st.pvz = vz; st.init = true; st.hp = c.hp == null ? 100 : c.hp; }
      const fx = Math.sin(st.yaw); const fz = -Math.cos(st.yaw);
      // lean from acceleration when the physics doesn't give one (remote cars)
      if (!st.given) {
        const ax = (vx - st.pvx) / dt; const az = (vz - st.pvz) / dt;
        const aF = ax * fx + az * fz; const aL = ax * -fz + az * fx;
        const tp0 = Math.max(-0.06, Math.min(0.06, -aF * 0.004)); const tr0 = Math.max(-0.07, Math.min(0.07, aL * 0.005));
        st.vp += ((tp0 - st.pitch) * 60 - st.vp * 9) * dt; st.vr += ((tr0 - st.roll) * 60 - st.vr * 9) * dt;
        st.pitch += st.vp * dt; st.roll += st.vr * dt;
        tilt.rotation.set(st.pitch, 0, -st.roll, 'YXZ');
      }
      if (typeof c.heave === 'number' && Number.isFinite(c.heave)) tilt.position.y += Math.max(-0.15, Math.min(0.15, c.heave));
      // damage: scratches with hp, a dent where the hit came from
      const hp = c.hp == null ? 100 : c.hp;
      if (hp > st.hp + 20) api.reset();
      else if (hp < st.hp - 1.5) {
        const dvx = vx - st.pvx; const dvz = vz - st.pvz; const dF = dvx * fx + dvz * fz; const dR = dvx * -fz + dvz * fx;
        const l = Math.hypot(dF, dR);
        // the hit pushed the car along dv, so it came from the opposite side
        const lx = l > 0.5 ? Math.max(-1, Math.min(1, -dR / l)) * 1.0 : (Math.random() - 0.5) * 2; const lz = l > 0.5 ? Math.max(-1, Math.min(1, -dF / l)) * 2.2 : (Math.random() - 0.5) * 4;
        dentAt(-lx, lz, Math.min(1, (st.hp - hp) / 12));
        st.dmg = Math.min(1, st.dmg + (st.hp - hp) / 60);
      }
      st.hp = hp;
      const off = c.surf === 'grass' || c.surf === 'dirt' || c.surf === 'sand';
      if (off && (c.speed || 0) > 3) st.dirt = Math.min(1, st.dirt + dt * (c.surf === 'grass' ? 0.04 : 0.09));
      st.pvx = vx; st.pvz = vz;
      const vf = vx * fx + vz * fz;
      const braking = !!c.braking || (c.brake > 0.1 && vf > 0.5);
      const rev = vf < -0.4 && !braking;
      uCar.set(st.dirt, Math.max(st.dmg, 1 - hp / 100) * 0.9, braking ? 1 : 0, rev ? 1 : 0);
      const l = L(); if (!l) return;
      // contact shadow
      l.blob(st.x, st.y + 0.04, st.z, st.yaw, 2.5, 5.4, 0.95);
      // headlights: halos always (dim by day), beams + a per-pixel spot at night
      for (const sx of [-1, 1]) {
        local(sx * 0.72, 0.68, 2.36, tp); l.glow(tp[0], tp[1], tp[2], night ? 1.5 : 0.55, night ? 1.0 : 0.5, night ? 0.95 : 0.48, night ? 0.82 : 0.4);
        local(sx * 0.7, 0.7, -2.32, tp);
        const tk = braking ? 1 : night ? 0.45 : 0.12;
        if (tk > 0.15) l.glow(tp[0], tp[1], tp[2], braking ? 1.3 : 0.9, 1.0 * tk, 0.1 * tk, 0.12 * tk);
        if (rev) { local(sx * 0.45, 0.7, -2.32, tp); l.glow(tp[0], tp[1], tp[2], 0.8, 0.8, 0.8, 0.8); }
      }
      if (night) {
        local(0, 0.7, 2.3, tp);
        l.spot(tp[0], tp[1], tp[2], fx, -0.07, fz, 1);
        for (const sx of [-1, 1]) { local(sx * 0.7, 0.7, 2.36, tp); l.beam(tp[0], tp[1], tp[2], fx, -0.05, fz, 16, 1); }
      }
      // lightbar halos
      if (isCop && flash.on && flash.ph >= 0) {
        const red = flash.ph === 0; const k = (flash.pul || 1) * (night ? 1.1 : 0.85);
        local(red ? -0.36 : 0.36, 1.68 + 0.12 * flash.pul, -0.3, tp);
        if (red) l.glow(tp[0], tp[1], tp[2], night ? 4 : 2.6, 1.3 * k, 0.12 * k, 0.12 * k); else l.glow(tp[0], tp[1], tp[2], night ? 4 : 2.6, 0.15 * k, 0.35 * k, 1.4 * k);
      }
    },
    /** A dent at world (x, z) of strength k (0..1). */
    dent(x, z, k = 0.5) {
      const dx = x - st.x; const dz = z - st.z; const s = Math.sin(st.yaw); const c = Math.cos(st.yaw);
      dentAt(dx * c + dz * s, dx * s - dz * c, k);
    },
    /** Undo dents, dirt and scratches (new round). */
    reset() { pa.array.set(orig); pa.needsUpdate = true; st.dirt = 0; st.dmg = 0; st.hp = 100; uCar.set(0, 0, 0, 0); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
  return api;
}

/** All player wheels in one instanced mesh. setWheel(i, car pose…) per wheel. */
export function createWheels(THREE, P, mats, count = 8) {
  const geo = buildWheel(THREE, P);
  const mesh = new THREE.InstancedMesh(geo, mats.vc, count);
  mesh.frustumCulled = false; mesh.layers.enable(SHADOW_LAYER);
  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler(0, 0, 0, 'YXZ'); const p = new THREE.Vector3(); const s = new THREE.Vector3(1, 1, 1);
  return {
    mesh,
    /** Car-relative wheel k (0 FL,1 FR,2 RL,3 RR) of car slot c. */
    set(c, k, x, y, z, yaw, steer, spin, flat, visible) {
      const sy = Math.sin(yaw); const cy = Math.cos(yaw);
      const fx = sy; const fz = -cy; const rx = cy; const rz = sy;
      const w = WHEELS[k];
      // w[0] > 0 = the right-hand side of the car
      const wx = x + rx * w[0] + fx * w[1]; const wz = z + rz * w[0] + fz * w[1];
      const sag = flat > 0 && k >= 0 ? 0.1 * flat : 0;
      p.set(wx, y + WHEEL_R - sag, wz);
      e.set(spin, Math.PI - yaw - (k < 2 ? steer : 0), 0, 'YXZ');
      q.setFromEuler(e);
      s.setScalar(visible ? 1 : 0.0001);
      m4.compose(p, q, s);
      mesh.setMatrixAt(c * 4 + k, m4);
    },
    commit() { mesh.instanceMatrix.needsUpdate = true; },
    dispose() { geo.dispose(); },
  };
}

/** Legacy traffic geometry ({ paint, trim }); new code uses createTrafficView. */
export function buildTrafficGeos(THREE, P) {
  return { paint: buildTrafficCar(THREE, P, 'sedan', 1), trim: new Builder(THREE, P.outline).box(0, -50, 0, 0.01, 0.01, 0.01, 0, [0, 0, 0]).geometryOut() };
}

const SHAPE_OF = ['sedan', 'sedan', 'suv', 'sedan', 'pickup', 'suv', 'van', 'sedan'];
/** Which silhouette traffic car `id` uses (deterministic). */
export function trafficShape(id) { const v = (id * 2654435761) >>> 0; return SHAPE_OF[(v >>> 3) % SHAPE_OF.length]; }

/**
 * Traffic drawing: per silhouette a near (full detail, casts shadows) and a mid mesh, plus one
 * far box mesh for everything beyond `midR`. begin(camPos) → add(id, pose) … → end().
 * Paint is tinted per instance; glass, trim and lights keep their colours.
 */
export function createTrafficView(THREE, P, mats, max = 64, opts = {}) {
  const nearR = opts.nearR || 40; const midR = opts.midR || 90;
  const shapes = ['sedan', 'suv', 'pickup', 'van'];
  const NN = 6; const NM = 24;
  const mk = (geo, n, shadow) => {
    const m = new THREE.InstancedMesh(geo, mats.vcColor || mats.vc, n);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    m.frustumCulled = false; m.count = 0; m.visible = false;
    if (shadow) m.layers.enable(SHADOW_LAYER);
    return m;
  };
  const near = {}; const mid = {};
  for (const s of shapes) { near[s] = mk(buildTrafficCar(THREE, P, s, 0), NN, true); mid[s] = mk(buildTrafficCar(THREE, P, s, 1), NM, false); }
  const far = mk(buildTrafficFar(THREE, P), max, false);
  const all = [...shapes.map((s) => near[s]), ...shapes.map((s) => mid[s]), far];
  const dm = new THREE.Object3D(); const tc = new THREE.Color();
  const len = { sedan: 4.38, suv: 4.6, pickup: 4.58, van: 4.58 };
  let cx = 0; let cz = 0; let n = 0; let night = !!P.dark; let nBeam = 0;
  // per-instance view culling: a car is drawn when it is inside any viewer's frustum (or close to
  // a viewer, so shadows / mirrors near the camera stay right)
  const frs = [new THREE.Frustum(), new THREE.Frustum()]; let nFr = 0; const pm = new THREE.Matrix4(); const sph = new THREE.Sphere(new THREE.Vector3(), 3.2);
  const camXZ = [];
  const L = () => mats && mats.lights;
  const tp = [0, 0, 0];
  return {
    meshes: all,
    /** camPos: the main camera position; cams (optional): every camera that renders this frame. */
    begin(camPos, cams) {
      cx = camPos.x; cz = camPos.z; n = 0; nBeam = 0; nFr = 0; camXZ.length = 0;
      for (const m of all) m.count = 0;
      if (cams) for (const c of cams) {
        if (!c || !c.projectionMatrix || nFr >= frs.length) continue;
        c.updateMatrixWorld(); pm.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse); frs[nFr++].setFromProjectionMatrix(pm);
        camXZ.push(c.position.x, c.position.z);
      }
    },
    /** pose: { x y z yaw sc hl? } from traffic.each / select. */
    add(id, pose) {
      if (n >= max) return;
      const d = Math.hypot(pose.x - cx, pose.z - cz);
      if (nFr) {
        let seen = false;
        // radius grows with distance: ~6° of slack for a camera that turned since last frame
        sph.center.set(pose.x, pose.y + 1, pose.z); sph.radius = 3.2 + d * 0.1;
        for (let k = 0; k < nFr && !seen; k++) seen = frs[k].intersectsSphere(sph) || Math.hypot(pose.x - camXZ[k * 2], pose.z - camXZ[k * 2 + 1]) < 14;
        if (!seen) return;
      }
      const shape = trafficShape(id);
      let m = d < nearR ? near[shape] : d < midR ? mid[shape] : far;
      if (m.count >= m.instanceMatrix.count) m = d < nearR ? mid[shape] : far;
      if (m.count >= m.instanceMatrix.count) return;
      const v = (id * 2654435761) >>> 0;
      const sl = 0.92 + ((v >>> 8) % 100) / 400; const sh = 0.95 + ((v >>> 16) % 20) / 100;
      const L0 = m === far ? 4.4 : len[shape];
      const zk = (4.46 * sl) / L0; // match the collision length (hl = 2.23 × sl)
      dm.position.set(pose.x, pose.y, pose.z); dm.rotation.set(pose.pitch || 0, Math.PI - pose.yaw, pose.roll || 0, 'YXZ');
      dm.scale.set(pose.sc, pose.sc * sh, pose.sc * zk); dm.updateMatrix();
      const i = m.count++;
      m.setMatrixAt(i, dm.matrix);
      const col = P.traffic[v % P.traffic.length]; tc.setRGB(col[0], col[1], col[2]); m.setColorAt(i, tc);
      n++;
      const l = L(); if (!l || d > 130) return;
      const s = Math.sin(pose.yaw); const c = Math.cos(pose.yaw);
      const at = (lx, ly, lz) => { tp[0] = pose.x + c * lx + s * lz * zk; tp[1] = pose.y + ly; tp[2] = pose.z + s * lx - c * lz * zk; return tp; };
      l.blob(pose.x, pose.y + 0.04, pose.z, pose.yaw, 2.4 * pose.sc, 5.0 * pose.sc * zk, 0.85);
      if (night) {
        for (const sx of [-1, 1]) {
          at(sx * 0.68, 0.68, 2.2); l.glow(tp[0], tp[1], tp[2], 1.2, 0.9, 0.86, 0.72);
          at(sx * 0.66, 0.7, -2.2); l.glow(tp[0], tp[1], tp[2], 0.8, 0.5, 0.05, 0.06);
        }
        if (nBeam < 4 && d < 70) { nBeam++; at(0, 0.68, 2.2); l.beam(tp[0], tp[1], tp[2], s, -0.06, -c, 12, 0.7); }
      } else if (d < 60 && (pose.speed || 0) < 2) {
        // stopped at a light: brake lamps on
        for (const sx of [-1, 1]) { at(sx * 0.66, 0.7, -2.2); l.glow(tp[0], tp[1], tp[2], 0.9, 0.8, 0.08, 0.1); }
      }
    },
    end() {
      for (const m of all) { m.visible = m.count > 0; if (m.count) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } }
      return n;
    },
    count: () => n,
    dispose() { for (const m of all) { if (m.parent) m.parent.remove(m); m.geometry.dispose(); } },
  };
}

/** Static parked cars (instanced, one mesh per call): list [{ x, y, z, yaw, color?, shape? }]. */
export function createParkedCars(THREE, P, mats, list, rnd = Math.random) {
  if (!list.length) return null;
  const geoBy = {};
  const groups = new Map();
  for (const c of list) { const s = c.shape && SHAPES[c.shape] && c.shape !== 'runner' && c.shape !== 'cop' ? c.shape : ['sedan', 'sedan', 'suv', 'pickup', 'van'][Math.floor(rnd() * 5)]; let g = groups.get(s); if (!g) { g = []; groups.set(s, g); } g.push(c); }
  const out = [];
  const dm = new THREE.Object3D(); const tc = new THREE.Color();
  for (const [s, cs] of groups) {
    const geo = geoBy[s] || (geoBy[s] = buildTrafficCar(THREE, P, s, 1));
    const m = new THREE.InstancedMesh(geo, mats.vcColor || mats.vc, cs.length);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cs.length * 3), 3);
    cs.forEach((c, i) => {
      dm.position.set(c.x, c.y || 0, c.z); dm.rotation.set(0, Math.PI - (c.yaw || 0), 0); dm.scale.set(1, 1, 1); dm.updateMatrix();
      m.setMatrixAt(i, dm.matrix);
      const col = c.color ? cssRGB(c.color) : P.traffic[Math.floor(rnd() * P.traffic.length)]; tc.setRGB(col[0], col[1], col[2]); m.setColorAt(i, tc);
    });
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.userData.noMerge = true;
    out.push(m);
  }
  return out;
}
