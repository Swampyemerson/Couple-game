// Body movement for Blend & Seek: free walking (world.step) and sticky-feet crawling
// (world.crawl) on walls, ceilings and undersides, plus the helpers that turn a body into an
// orientation quaternion and map screen-relative stick input onto whatever surface the body is
// on. Pure functions over a body object; no three.js, no allocations per frame.
import { dims } from './world.js';

/** A fresh body (feet / contact point at x,y,z). */
export function mkBody() {
  return {
    x: 0, y: 0, z: 0, vy: 0, r: 0.24, step: 0.24, head: 0.34, jumpV: 4.6, s: 1, onGround: true,
    yaw: 0, pose: 'stand', wallN: null, wa: 0, lookYaw: 0, lookPitch: 0, speed: 0, vis: 1,
    at: false, nx: 0, ny: 1, nz: 0, fx: 0, fy: 0, fz: 1, box: null, sq: false, kx: 0, kz: 0, lockY: false,
    cnx: 0, cnz: 0, pushT: 0, zip: null, stillT: 0,
  };
}

/** Apply a size factor (collider, step, head, jump). */
export function sizeBody(b, s) {
  const d = dims(s);
  b.s = s; b.r = d.r; b.step = d.step; b.head = d.head; b.jumpV = d.jump;
}

/** Back to free, upright mode at the current spot. */
export function resetBody(b) {
  b.at = false; b.nx = 0; b.ny = 1; b.nz = 0; b.box = null; b.sq = false; b.kx = 0; b.kz = 0; b.lockY = false; b.cnx = 0; b.cnz = 0; b.pushT = 0; b.zip = null; b.vy = 0;
  b.fx = Math.sin(b.yaw); b.fy = 0; b.fz = Math.cos(b.yaw); b.wallN = null; b.stillT = 0;
}

/** Heading yaw of a body (for first-person views and legacy fields). */
export function headingYaw(b) {
  if (!b.at) return b.yaw;
  const h = Math.hypot(b.fx, b.fz);
  if (h > 0.3) return Math.atan2(b.fx, b.fz);
  // heading straight up/down a wall: look out from the wall
  if (Math.abs(b.ny) < 0.7) return Math.atan2(b.nx, b.nz);
  return b.yaw;
}

/** 'floor' | 'top' | 'wall' | 'ceiling' for the surface a body is on. */
export function surfaceKind(b) {
  if (!b.at) return 'floor';
  if (b.ny > 0.7) return 'top';
  if (b.ny < -0.7) return 'ceiling';
  return 'wall';
}

/** Stick to a face. Heading: (hx,hy,hz) projected onto it (default: world up / old heading). */
export function attachBody(world, b, x, y, z, nx, ny, nz, box, hx, hy, hz) {
  b.at = true; b.x = x; b.y = y; b.z = z; b.nx = nx; b.ny = ny; b.nz = nz; b.box = box || null;
  b.vy = 0; b.kx = 0; b.kz = 0; b.sq = false; b.cnx = 0; b.cnz = 0; b.onGround = false;
  if (hx == null) { hx = b.fx; hy = b.fy; hz = b.fz; if (Math.abs(ny) < 0.7) { hx = 0; hy = 1; hz = 0; } }
  world.reHead(b, hx, hy, hz);
  b.wa = Math.abs(ny) < 0.7 ? Math.atan2(nx, nz) : b.wa;
  b.yaw = headingYaw(b);
}

/**
 * Let go. From a wall or ceiling the body drops (free mode, gravity) a radius off the surface;
 * push (m/s) shoves it away from the surface, lift adds upward speed (wall jump).
 */
export function detachBody(world, b, push = 0.6, lift = 0) {
  const nx = b.nx; const ny = b.ny; const nz = b.nz;
  const yaw = headingYaw(b);
  b.at = false; b.box = null; b.cnx = 0; b.cnz = 0; b.lockY = false;
  if (ny < 0.7) {
    // contact point → feet position
    if (ny < -0.7) b.y -= b.head + 0.03; // under a ceiling: feet go below it
    else b.y = Math.max(0, b.y - b.r * 0.8);
    b.x += nx * (b.r + 0.02); b.z += nz * (b.r + 0.02);
    b.kx = nx * push; b.kz = nz * push; b.vy = lift; b.onGround = false;
  } else { b.vy = lift; b.onGround = lift <= 0; }
  b.nx = 0; b.ny = 1; b.nz = 0;
  b.yaw = yaw; b.fx = Math.sin(yaw); b.fy = 0; b.fz = Math.cos(yaw);
  world.pushOut(b);
}

/** Free-mode step with momentum (kx,kz) that decays (fast on the ground, slowly in the air). */
export function freeStep(world, b, vx, vz, dt, jump) {
  const decay = b.onGround ? 14 : 1.6;
  const k = Math.exp(-decay * dt);
  b.kx *= k; b.kz *= k;
  if (Math.abs(b.kx) < 0.01) b.kx = 0; if (Math.abs(b.kz) < 0.01) b.kz = 0;
  return world.step(b, vx + b.kx, vz + b.kz, dt, jump);
}

/**
 * Crawl along the current surface with world velocity (vx,vy,vz) (made tangent). Turns the
 * heading toward the motion. Returns world.crawl's result; a concave step down onto an
 * upward-facing floor releases the body back to free walking (returns 4).
 */
export function crawlStep(world, b, vx, vy, vz, dt) {
  if (b.lockY) {
    // floor-only rules: slide sideways along the wall, never up or onto another face
    const d = vx * b.nx + vy * b.ny + vz * b.nz; vx -= b.nx * d; vy = 0; vz -= b.nz * d;
    const sx = b.x; const sy = b.y; const sz = b.z; const box = b.box;
    const res = world.crawl(b, vx, 0, vz, dt);
    if (res === 1 || res === 2) { b.x = sx; b.y = sy; b.z = sz; b.box = box; b.nx = Math.sign(b.nx) * (Math.abs(b.nx) > 0.5 ? 1 : 0); return 3; }
    return res;
  }
  const pnx = b.nx; const pny = b.ny; const pnz = b.nz;
  const res = world.crawl(b, vx, vy, vz, dt);
  if (res === 1 || res === 2) {
    // a new face: keep the heading continuous (already set by crawl), refresh legacy fields
    b.cnx = 0; b.cnz = 0;
    b.wa = Math.abs(b.ny) < 0.7 ? Math.atan2(b.nx, b.nz) : b.wa;
    if (res === 1 && b.ny > 0.7 && pny < 0.7) {
      // climbed down a wall onto the floor / a top: walk normally from here
      const yaw = Math.atan2(-pnx, -pnz);
      b.at = false; b.box = null; b.nx = 0; b.ny = 1; b.nz = 0; b.vy = 0; b.onGround = true;
      b.yaw = Number.isFinite(yaw) && Math.hypot(pnx, pnz) > 0.5 ? yaw : b.yaw;
      b.fx = Math.sin(b.yaw); b.fy = 0; b.fz = Math.cos(b.yaw);
      world.pushOut(b);
      return 4;
    }
  } else if (res === 0) {
    // turn toward the motion
    const sp = Math.hypot(vx, vy, vz);
    if (sp > 0.05) {
      const k = 1 - Math.exp(-10 * dt);
      world.reHead(b, b.fx + (vx / sp - b.fx) * k, b.fy + (vy / sp - b.fy) * k, b.fz + (vz / sp - b.fz) * k);
    }
  }
  b.yaw = headingYaw(b);
  return res;
}

/**
 * Screen-relative input → a world velocity on the body's surface plane: the stick direction
 * (mx right, my up the screen) is matched to the tangent direction whose on-screen image points
 * the same way. proj(x, y, z, out2) projects a world point to screen space (y up, any scale;
 * returns false behind the camera). F/R: camera forward/right (fallback when the surface is seen
 * edge-on). Writes out[0..2] (length = stick magnitude, or 0).
 */
const S0 = [0, 0]; const S1 = [0, 0]; const S2 = [0, 0];
export function inputOnSurface(b, mx, my, proj, F, R, out) {
  const nx = b.at ? b.nx : 0; const ny = b.at ? b.ny : 1; const nz = b.at ? b.nz : 0;
  out[0] = 0; out[1] = 0; out[2] = 0;
  if (!mx && !my) return out;
  let t1x = 1; let t1y = 0; let t1z = 0;
  if (Math.abs(ny) < 0.9) { t1x = -nz; t1y = 0; t1z = nx; }
  let L = Math.hypot(t1x, t1y, t1z); t1x /= L; t1y /= L; t1z /= L;
  const t2x = ny * t1z - nz * t1y; const t2y = nz * t1x - nx * t1z; const t2z = nx * t1y - ny * t1x;
  const e = 0.15;
  const cx = b.x + nx * 0.1; const cy = b.y + ny * 0.1; const cz = b.z + nz * 0.1;
  let wx; let wy; let wz;
  const ok = proj(cx, cy, cz, S0) && proj(cx + t1x * e, cy + t1y * e, cz + t1z * e, S1) && proj(cx + t2x * e, cy + t2y * e, cz + t2z * e, S2);
  const a11 = S1[0] - S0[0]; const a21 = S1[1] - S0[1]; const a12 = S2[0] - S0[0]; const a22 = S2[1] - S0[1];
  const det = a11 * a22 - a12 * a21;
  const mag = Math.hypot(a11, a21) * Math.hypot(a12, a22);
  if (ok && mag > 1e-9 && Math.abs(det) > 0.2 * mag) {
    const p = (a22 * mx - a12 * my) / det; const q = (-a21 * mx + a11 * my) / det;
    wx = t1x * p + t2x * q; wy = t1y * p + t2y * q; wz = t1z * p + t2z * q;
  } else {
    // seen edge-on: forward = camera forward (else world up) projected, right = camera right projected
    let fx = F[0]; let fy = F[1] + 0.35; let fz = F[2];
    let d = fx * nx + fy * ny + fz * nz; fx -= nx * d; fy -= ny * d; fz -= nz * d;
    let rx = R[0]; let ry = R[1]; let rz = R[2];
    d = rx * nx + ry * ny + rz * nz; rx -= nx * d; ry -= ny * d; rz -= nz * d;
    const lf = Math.hypot(fx, fy, fz) || 1; const lr = Math.hypot(rx, ry, rz) || 1;
    wx = (fx / lf) * my + (rx / lr) * mx; wy = (fy / lf) * my + (ry / lr) * mx; wz = (fz / lf) * my + (rz / lr) * mx;
  }
  L = Math.hypot(wx, wy, wz);
  if (L < 1e-6) return out;
  const m = Math.min(1, Math.hypot(mx, my));
  out[0] = (wx / L) * m; out[1] = (wy / L) * m; out[2] = (wz / L) * m;
  return out;
}

/**
 * Orientation of a body as a quaternion (out[0..3] = x, y, z, w): up = surface normal (or the
 * corner diagonal), forward = heading. Free mode: upright, facing yaw.
 */
export function bodyQuat(b, out) {
  let Yx; let Yy; let Yz; let Zx; let Zy; let Zz;
  if (!b.at) { Yx = 0; Yy = 1; Yz = 0; Zx = Math.sin(b.yaw); Zy = 0; Zz = Math.cos(b.yaw); }
  else {
    Yx = b.nx; Yy = b.ny; Yz = b.nz; Zx = b.fx; Zy = b.fy; Zz = b.fz;
    if (b.pose === 'corner' && (b.cnx || b.cnz)) {
      Yx = b.nx + b.cnx; Yy = 0; Yz = b.nz + b.cnz; const L = Math.hypot(Yx, Yz) || 1; Yx /= L; Yz /= L;
      Zx = 0; Zy = 1; Zz = 0;
    }
  }
  // X = Y × Z
  let Xx = Yy * Zz - Yz * Zy; let Xy = Yz * Zx - Yx * Zz; let Xz = Yx * Zy - Yy * Zx;
  const L = Math.hypot(Xx, Xy, Xz) || 1; Xx /= L; Xy /= L; Xz /= L;
  // re-orthogonalise Z = X × Y
  Zx = Xy * Yz - Xz * Yy; Zy = Xz * Yx - Xx * Yz; Zz = Xx * Yy - Xy * Yx;
  // rotation matrix (columns X, Y, Z) → quaternion
  const m00 = Xx; const m01 = Yx; const m02 = Zx; const m10 = Xy; const m11 = Yy; const m12 = Zy; const m20 = Xz; const m21 = Yz; const m22 = Zz;
  const tr = m00 + m11 + m22;
  let x; let y; let z; let w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  out[0] = x; out[1] = y; out[2] = z; out[3] = w;
  return out;
}

/** Up vector (body normal) from a quaternion (x,y,z,w): R·(0,1,0). */
export function quatUpY(x, y, z, w) { return 1 - 2 * (x * x + z * z); }
export function quatUp(q, out) {
  const [x, y, z, w] = q;
  out[0] = 2 * (x * y - w * z); out[1] = 1 - 2 * (x * x + z * z); out[2] = 2 * (y * z + w * x);
  return out;
}

/** Where was this body hiding? (recap headline) */
export function spotKind(pose, upY, y) {
  if (pose === 'squeeze') return 'squeeze';
  if (pose === 'corner') return 'corner';
  if (pose === 'perch') return 'perch';
  if (pose === 'hang') return y > 1.5 ? 'hangHigh' : 'hang';
  if (upY < -0.6) return y > 1.5 ? 'ceiling' : 'under';
  if (upY < 0.6) return pose === 'wall' && y < 1.1 ? 'flat' : 'wall';
  return null;
}
