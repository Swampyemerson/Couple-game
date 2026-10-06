// Getaway car visuals: the runner's muscle car (player ink + stripes), the cop cruiser (black &
// white with a flashing red/blue lightbar), traffic cars (two instanced meshes: tinted paint and
// untinted trim), and all player wheels as one instanced mesh. Blob shadows are baked into each
// body as a flat dark quad (no extra draw calls).
import { Builder, FX_GLOW, mix, makeToon } from './gfx.js';

const WHEELS = [[0.86, 1.38], [-0.86, 1.38], [0.86, -1.38], [-0.86, -1.38]]; // x, z (front = +z)

/** The player car body (model space: +z forward, y up, origin on the ground at the centre). */
export function buildCarBody(THREE, P, kind, ink) {
  const b = new Builder(THREE, P.outline);
  const ol = 0.055;
  const glass = P.dark ? [0.12, 0.16, 0.26] : [0.24, 0.3, 0.42];
  const dark = [0.13, 0.13, 0.15];
  const lights = [1, 0.97, 0.8]; const tail = [0.95, 0.15, 0.2];
  // blob shadow (an upward-facing quad: listed CW seen from below = CCW from above)
  const sh = P.dark ? [0.03, 0.03, 0.05] : mix(P.asphalt, [0, 0, 0], 0.5);
  b.poly([[-1.15, 0.05, -2.45], [-1.15, 0.05, 2.45], [1.15, 0.05, 2.45], [1.15, 0.05, -2.45]], sh, 0, [0, 1, 0]);
  if (kind === 'runner') {
    const body = ink; const stripe = P.dark ? [0.95, 0.95, 0.92] : [0.98, 0.97, 0.94];
    b.box(0, 0.62, 0, 2.0, 0.62, 4.5, 0, body, ol);                  // lower body
    b.box(0, 0.98, 1.25, 1.86, 0.18, 1.9, 0, body, ol);               // long hood
    b.box(0, 0.96, -1.6, 1.86, 0.16, 1.1, 0, body, ol);               // trunk deck
    b.add(b.T.wedge, 0, 1.22, 0.05, 1.62, 0.44, 0.7, 0, glass, ol);   // windscreen
    b.box(0, 1.33, -0.6, 1.6, 0.26, 1.15, 0, body, ol);               // roof
    b.add(b.T.wedge, 0, 1.2, -1.32, 1.6, 0.38, 0.5, Math.PI, glass, ol); // rear window
    b.box(0, 1.19, -0.6, 1.64, 0.2, 1.05, 0, glass, 0);               // side windows
    b.box(0.26, 1.08, 1.25, 0.24, 0.02, 1.92, 0, stripe, 0); b.box(-0.26, 1.08, 1.25, 0.24, 0.02, 1.92, 0, stripe, 0); // racing stripes
    b.box(0.26, 1.47, -0.6, 0.24, 0.02, 1.16, 0, stripe, 0); b.box(-0.26, 1.47, -0.6, 0.24, 0.02, 1.16, 0, stripe, 0);
    b.box(0, 1.08, 0.8, 0.5, 0.16, 0.7, 0, dark, 0.03);               // hood scoop
    b.box(0, 1.18, -2.12, 1.9, 0.08, 0.3, 0, dark, 0.03);             // spoiler
    b.box(0.75, 1.05, -2.05, 0.08, 0.2, 0.12, 0, dark, 0); b.box(-0.75, 1.05, -2.05, 0.08, 0.2, 0.12, 0, dark, 0);
    b.box(0, 0.45, 2.27, 2.02, 0.26, 0.12, 0, dark, 0.03);            // bumpers
    b.box(0, 0.45, -2.27, 2.02, 0.26, 0.12, 0, dark, 0.03);
    b.box(0.68, 0.72, 2.27, 0.36, 0.16, 0.06, 0, lights, 0, FX_GLOW); b.box(-0.68, 0.72, 2.27, 0.36, 0.16, 0.06, 0, lights, 0, FX_GLOW);
    b.box(0.66, 0.72, -2.27, 0.42, 0.14, 0.06, 0, tail, 0, FX_GLOW); b.box(-0.66, 0.72, -2.27, 0.42, 0.14, 0.06, 0, tail, 0, FX_GLOW);
    b.box(0.5, 0.3, -2.32, 0.14, 0.14, 0.2, 0, [0.6, 0.6, 0.62], 0); b.box(-0.5, 0.3, -2.32, 0.14, 0.14, 0.2, 0, [0.6, 0.6, 0.62], 0); // exhausts
  } else {
    const black = P.copBody; const white = P.copDoor;
    b.box(0, 0.62, 0, 1.98, 0.6, 4.6, 0, black, ol);
    b.box(0, 0.64, -0.15, 2.0, 0.5, 2.0, 0, white, 0);                // white doors
    b.box(0, 0.98, 1.4, 1.84, 0.16, 1.5, 0, black, ol);
    b.box(0, 0.96, -1.65, 1.84, 0.14, 1.1, 0, black, ol);
    b.add(b.T.wedge, 0, 1.25, 0.32, 1.66, 0.5, 0.8, 0, glass, ol);
    b.box(0, 1.4, -0.42, 1.66, 0.22, 1.35, 0, white, ol);             // white roof
    b.add(b.T.wedge, 0, 1.22, -1.32, 1.62, 0.42, 0.55, Math.PI, glass, ol);
    b.box(0, 1.24, -0.42, 1.7, 0.24, 1.25, 0, glass, 0);
    b.box(0, 1.56, -0.4, 1.3, 0.1, 0.34, 0, dark, 0.03);              // lightbar base
    b.box(0, 0.48, 2.36, 2.04, 0.36, 0.2, 0, dark, 0.04);             // push bar
    b.box(0.55, 0.62, 2.48, 0.1, 0.5, 0.1, 0, dark, 0); b.box(-0.55, 0.62, 2.48, 0.1, 0.5, 0.1, 0, dark, 0);
    b.box(0, 0.45, -2.32, 2.0, 0.24, 0.12, 0, dark, 0.03);
    b.box(0.66, 0.74, 2.31, 0.38, 0.14, 0.06, 0, lights, 0, FX_GLOW); b.box(-0.66, 0.74, 2.31, 0.38, 0.14, 0.06, 0, lights, 0, FX_GLOW);
    b.box(0.66, 0.74, -2.31, 0.38, 0.14, 0.06, 0, tail, 0, FX_GLOW); b.box(-0.66, 0.74, -2.31, 0.38, 0.14, 0.06, 0, tail, 0, FX_GLOW);
    b.box(1.01, 0.72, -0.15, 0.02, 0.22, 0.6, 0, [0.85, 0.7, 0.2], 0); b.box(-1.01, 0.72, -0.15, 0.02, 0.22, 0.6, 0, [0.85, 0.7, 0.2], 0); // star badges
  }
  return b.geometryOut();
}

export function buildWheel(THREE, P) {
  const b = new Builder(THREE, P.outline);
  b.add(b.T.wheel, 0, 0, 0, 0.32, 0.72, 0.72, 0, [0.12, 0.12, 0.13], 0.04);
  b.add(b.T.wheel, 0, 0, 0, 0.34, 0.36, 0.36, 0, [0.72, 0.72, 0.74], 0);
  b.box(0, 0, 0, 0.36, 0.08, 0.5, 0, [0.5, 0.5, 0.52], 0); // spoke so spinning reads
  return b.geometryOut();
}

/** A player car: body mesh + lightbar meshes (cop). Wheels come from the shared wheel pool. */
export function createCarView(THREE, P, U, kind, ink, mats) {
  const group = new THREE.Group();
  const tilt = new THREE.Group(); group.add(tilt);
  const body = new THREE.Mesh(buildCarBody(THREE, P, kind, ink), mats.vc);
  tilt.add(body);
  let red = null; let blue = null;
  if (kind === 'cop') {
    const mr = makeToon(THREE, U, P.red, { fx: FX_GLOW }); const mb = makeToon(THREE, U, P.blue, { fx: FX_GLOW });
    const g = new THREE.BoxGeometry(0.56, 0.18, 0.3);
    red = new THREE.Mesh(g, mr); red.position.set(-0.33, 1.68, -0.4);
    blue = new THREE.Mesh(g, mb); blue.position.set(0.33, 1.68, -0.4);
    tilt.add(red); tilt.add(blue);
  }
  const flash = { t: 0, on: false };
  return {
    group, tilt, body, red, blue,
    /** pose: x y z yaw pitch roll; flat 0..1 sags the car */
    pose(x, y, z, yaw, pitch, roll, flat) {
      group.position.set(x, y, z);
      group.rotation.set(0, Math.PI - yaw, 0);
      tilt.rotation.set(pitch, 0, -roll, 'YXZ');
      tilt.position.y = -0.12 * flat;
    },
    /** lightbar flashing; returns 0 (red), 1 (blue) or −1 (off) for the surface tint */
    flash(dt, on) {
      if (!red) return -1;
      flash.t += dt;
      if (!on) { red.material.color.setRGB(0.35, 0.08, 0.1); blue.material.color.setRGB(0.08, 0.14, 0.35); return -1; }
      const ph = Math.floor(flash.t * 7) % 4; // R R B B with a gap
      const rOn = ph === 0 || ph === 1; const bOn = ph === 2 || ph === 3;
      const pul = (Math.floor(flash.t * 14) & 1) ? 1 : 0.55;
      red.material.color.setRGB(rOn ? 1.1 * pul : 0.3, rOn ? 0.15 : 0.06, rOn ? 0.2 : 0.08);
      blue.material.color.setRGB(bOn ? 0.2 : 0.06, bOn ? 0.45 * pul : 0.12, bOn ? 1.1 * pul : 0.3);
      return rOn ? 0 : 1;
    },
    dispose() { body.geometry.dispose(); if (red) { red.geometry.dispose(); red.material.dispose(); blue.material.dispose(); } },
  };
}

/** All player wheels in one instanced mesh. setWheel(i, car pose…) per wheel. */
export function createWheels(THREE, P, mats, count = 8) {
  const geo = buildWheel(THREE, P);
  const mesh = new THREE.InstancedMesh(geo, mats.vc, count);
  mesh.frustumCulled = false;
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
      p.set(wx, y + 0.36 - sag, wz);
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

/** Traffic car: paint (white, tinted per instance) + trim (untinted) geometries. */
export function buildTrafficGeos(THREE, P) {
  const paint = new Builder(THREE, P.outline); const trim = new Builder(THREE, P.outline);
  const ol = 0.05; const white = [1, 1, 1];
  const glass = P.dark ? [0.12, 0.16, 0.26] : [0.26, 0.32, 0.44];
  paint.box(0, 0.62, 0, 1.9, 0.62, 4.3, 0, white, ol);
  paint.box(0, 1.2, -0.25, 1.66, 0.5, 2.1, 0, white, ol);
  trim.box(0, 1.2, -0.25, 1.7, 0.32, 1.95, 0, glass, 0);
  trim.add(trim.T.wedge, 0, 1.18, 0.98, 1.6, 0.45, 0.45, 0, glass, 0);
  const sh = P.dark ? [0.03, 0.03, 0.05] : mix(P.asphalt, [0, 0, 0], 0.5);
  trim.poly([[-1.1, 0.05, -2.3], [-1.1, 0.05, 2.3], [1.1, 0.05, 2.3], [1.1, 0.05, -2.3]], sh, 0, [0, 1, 0]);
  for (const [x, z] of [[0.86, 1.3], [-0.86, 1.3], [0.86, -1.3], [-0.86, -1.3]]) trim.add(trim.T.wheel, x, 0.34, z, 0.3, 0.66, 0.66, 0, [0.12, 0.12, 0.13], 0.03);
  trim.box(0.62, 0.7, 2.16, 0.32, 0.14, 0.06, 0, [1, 0.97, 0.8], 0, FX_GLOW); trim.box(-0.62, 0.7, 2.16, 0.32, 0.14, 0.06, 0, [1, 0.97, 0.8], 0, FX_GLOW);
  trim.box(0.62, 0.7, -2.16, 0.36, 0.12, 0.06, 0, [0.95, 0.15, 0.2], 0, FX_GLOW); trim.box(-0.62, 0.7, -2.16, 0.36, 0.12, 0.06, 0, [0.95, 0.15, 0.2], 0, FX_GLOW);
  trim.box(0, 0.42, 2.18, 1.94, 0.22, 0.1, 0, [0.2, 0.2, 0.22], 0); trim.box(0, 0.42, -2.18, 1.94, 0.22, 0.1, 0, [0.2, 0.2, 0.22], 0);
  return { paint: paint.geometryOut(), trim: trim.geometryOut() };
}
