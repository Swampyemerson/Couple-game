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
    // crawl bookkeeping: surface-session id (bumped on every attach / detach / reset), and the face just left
    // (normal vn, heading vf) that world.crawl won't re-enter for vt seconds unless the motion reverses
    sid: 0, vnx: 0, vny: 0, vnz: 0, vfx: 0, vfy: 0, vfz: 0, vt: 0, wt: 0, wtr: 0,
    // walking feel: the smoothed (accelerated) velocity, last grounded / jumped times, held jump
    svx: 0, svz: 0, wasMoving: false, groundT: -1e9, jumpT: -1e9, jumpHeld: false,
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
  b.svx = 0; b.svz = 0; b.wasMoving = false; b.jumpHeld = false; b.sid++; b.vt = 0; b.wt = 0; b.wtr = 0;
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
  b.vy = 0; b.kx = 0; b.kz = 0; b.sq = false; b.cnx = 0; b.cnz = 0; b.onGround = false; b.sid++; b.vt = 0; b.wt = 0; b.wtr = 0;
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
  b.at = false; b.box = null; b.cnx = 0; b.cnz = 0; b.lockY = false; b.sid++; b.vt = 0; b.wt = 0; b.wtr = 0;
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

/**
 * Walking feel. The stick gives a target velocity (tx,tz); the body's smoothed velocity (svx,svz)
 * accelerates toward it at ACCEL.ground (≈0.14 s to full speed), brakes at ACCEL.brake (≈0.1 s to
 * a stop) and drifts at ACCEL.air mid-jump. Returns a code for the feel layer: 1 = just stopped
 * (settle squash), 2 = hard reversal at speed (dust puff), else 0. A dash (scurry) is instant.
 */
export const ACCEL = { ground: 22, brake: 30, air: 8 };
export function accelStep(b, tx, tz, moving, dt, dashing = false) {
  let ev = 0;
  if (dashing) { b.svx = tx; b.svz = tz; b.wasMoving = true; return 0; }
  const acc = !b.onGround ? ACCEL.air : moving ? ACCEL.ground : ACCEL.brake;
  const ddx = tx - b.svx; const ddz = tz - b.svz; const dd = Math.hypot(ddx, ddz);
  const mx = acc * dt;
  const cur = Math.hypot(b.svx, b.svz);
  if (moving && b.onGround && cur > 1.8 && b.svx * tx + b.svz * tz < -0.5 * cur * Math.hypot(tx, tz)) ev = 2;
  if (dd > mx) { b.svx += (ddx / dd) * mx; b.svz += (ddz / dd) * mx; } else { b.svx = tx; b.svz = tz; }
  if (!moving && b.onGround && dd <= mx && b.wasMoving && cur > 0.4) ev = 1;
  b.wasMoving = moving;
  return ev;
}

/**
 * Jump feel: tap buffer (a tap up to 120 ms before landing still jumps), coyote time (a tap up to
 * 100 ms after walking off a ledge, never after a jump) and a short hop when a held key is let go
 * early. jumpOnGround(): should world.step jump this frame? coyoteJump(): launch in mid-air now?
 */
export const JUMP = { buffer: 0.12, coyote: 0.1, shortV: 2.8 };
export function coyoteJump(b, want, tSec) {
  if (!want || b.onGround || b.sq || b.at || b.vy > 0.5) return false;
  if (!(tSec - b.groundT < JUMP.coyote) || !(b.groundT > b.jumpT)) return false;
  b.vy = b.jumpV; b.onGround = false; b.jumpT = tSec;
  return true;
}
/** Release a held jump early → short hop. Returns true when it clipped the jump. */
export function shortHop(b, held) {
  if (!b.jumpHeld || held) return false;
  b.jumpHeld = false;
  if (b.vy > JUMP.shortV && !b.at) { b.vy = JUMP.shortV; return true; }
  return false;
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
      b.at = false; b.box = null; b.nx = 0; b.ny = 1; b.nz = 0; b.vy = 0; b.onGround = true; b.sid++; b.vt = 0;
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

/** Longest crawl step: a frame is cut into equal pieces of at most 1/60 s (same result at 30, 60 and 120 Hz). */
export const CRAWL_DT = 1 / 60;

/**
 * Per-body input state for crawling (see surfaceVel): the "input-frame lock". Walking up a wall and
 * over the ceiling swings the camera, and the screen-relative mapping with it; when the surface
 * changes while the stick is held, the body keeps going the way it was heading (lock) until the stick
 * is released or turned by LOCK.breakDeg, then eases into the screen-relative mapping.
 */
export function mkFrameState() {
  return { sid: -1, lock: false, lx: 0, ly: 0, lz: 0, sx: 0, sy: 1, blend: 0, cmx: 0, cmy: 0, cmag: 0, age: 0 };
}
export const LOCK = { breakDeg: 40, blendS: 0.2, minMag: 0.25, maxS: 1.2, agree: 0.55 };

/**
 * Crawl a frame's worth: dt is cut into pieces of at most CRAWL_DT. With a frame state (fs) a transfer
 * (res 1 / 2) starts the input-frame lock and re-aims the rest of the frame along the new heading.
 * Returns 4 if the body was released onto a floor, else the last transfer code (1 / 2), else 0 (moved) or
 * 3 (blocked on every piece).
 */
export function crawlSteps(world, b, fs, vx, vy, vz, dt) {
  const n = Math.max(1, Math.ceil(dt / CRAWL_DT - 1e-6));
  const h = dt / n;
  let xfer = 0; let moved = false;
  for (let i = 0; i < n; i++) {
    const r = crawlStep(world, b, vx, vy, vz, h);
    if (r === 4) return 4;
    if (r === 1 || r === 2) {
      xfer = r; moved = true;
      if (fs) {
        const sp = Math.hypot(vx, vy, vz);
        fs.lx = b.fx; fs.ly = b.fy; fs.lz = b.fz; fs.age = 0;
        if (fs.cmag >= LOCK.minMag) { fs.lock = true; fs.sx = fs.cmx; fs.sy = fs.cmy; fs.blend = 0; }
        vx = b.fx * sp; vy = b.fy * sp; vz = b.fz * sp; // the rest of the frame goes the way it now heads
      }
    } else if (r === 0) moved = true;
  }
  return xfer || (moved ? 0 : 3);
}

const ULK = [0, 0, 0];
const sstep = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
/**
 * Stick (mx,my) → world velocity direction on the surface (length = stick magnitude): the
 * screen-relative mapping (inputOnSurface) unless the input-frame lock holds. While locked the stick
 * only steers: turning it by θ turns the heading by θ (up to LOCK.breakDeg); past that the lock blends
 * out into the screen mapping over LOCK.blendS. Releasing the stick drops the lock.
 */
export function surfaceVel(b, fs, mx, my, proj, F, R, dt, out) {
  if (fs.sid !== b.sid) { fs.sid = b.sid; fs.lock = false; fs.blend = 0; }
  const mag = Math.min(1, Math.hypot(mx, my));
  fs.cmx = mx; fs.cmy = my; fs.cmag = mag; fs.age += dt;
  inputOnSurface(b, mx, my, proj, F, R, out);
  if (mag < 0.05) { fs.lock = false; b.wt = 0; b.wtr = 0; return out; }
  if (!fs.lock) return out;
  // the locked heading, kept tangent to the surface we are on now
  const nx = b.nx; const ny = b.ny; const nz = b.nz;
  let lx = fs.lx; let ly = fs.ly; let lz = fs.lz;
  let d = lx * nx + ly * ny + lz * nz; lx -= nx * d; ly -= ny * d; lz -= nz * d;
  let L = Math.hypot(lx, ly, lz);
  if (L < 1e-4) { fs.lock = false; return out; }
  lx /= L; ly /= L; lz /= L;
  // steer: the stick's turn since the lock, as a turn about the surface normal on the viewer's side
  const lockA = Math.atan2(fs.sy, fs.sx);
  let th = Math.atan2(my, mx) - lockA;
  if (th > Math.PI) th -= 2 * Math.PI; else if (th < -Math.PI) th += 2 * Math.PI;
  const lim = (LOCK.breakDeg * Math.PI) / 180;
  const A = Math.abs(th);
  const sgn = F[0] * nx + F[1] * ny + F[2] * nz < 0 ? 1 : -1;
  const tc = Math.max(-lim, Math.min(lim, th)) * sgn;
  const cs = Math.cos(tc); const sn = Math.sin(tc);
  // (n × l) sinθ + l cosθ
  const cx = ny * lz - nz * ly; const cy = nz * lx - nx * lz; const cz = nx * ly - ny * lx;
  let ux = lx * cs + cx * sn; let uy = ly * cs + cy * sn; let uz = lz * cs + cz * sn;
  // break: the stick turned too far, or (a while after the corner) the screen mapping agrees anyway
  const ml = Math.hypot(out[0], out[1], out[2]);
  let want = A > lim ? 1 : 0;
  if (!want && fs.age > LOCK.maxS && ml > 1e-4 && (out[0] * ux + out[1] * uy + out[2] * uz) / ml > LOCK.agree) want = 1;
  if (want) fs.blend = Math.min(1, fs.blend + dt / LOCK.blendS); else fs.blend = Math.max(0, fs.blend - dt / 0.15);
  if (fs.blend >= 1) { fs.lock = false; b.wt = 0; b.wtr = 0; return out; }
  if (ml > 1e-4) {
    const k = sstep(fs.blend);
    ux = ux * (1 - k) + (out[0] / ml) * k; uy = uy * (1 - k) + (out[1] / ml) * k; uz = uz * (1 - k) + (out[2] / ml) * k;
    d = ux * nx + uy * ny + uz * nz; ux -= nx * d; uy -= ny * d; uz -= nz * d;
  }
  L = Math.hypot(ux, uy, uz) || 1;
  ULK[0] = ux / L; ULK[1] = uy / L; ULK[2] = uz / L;
  out[0] = ULK[0] * mag; out[1] = ULK[1] * mag; out[2] = ULK[2] * mag;
  return out;
}

/** One frame of crawling by stick: surfaceVel + crawlSteps. speed = m/s at full stick. Returns crawlSteps' code; out = the velocity used. */
export function crawlFrame(world, b, fs, mx, my, proj, F, R, speed, dt, out) {
  surfaceVel(b, fs, mx, my, proj, F, R, dt, out);
  return crawlSteps(world, b, fs, out[0] * speed, out[1] * speed, out[2] * speed, dt);
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

// ── springs ────────────────────────────────────────────────────────
/**
 * Critically damped spring toward a target (Unity's SmoothDamp, solved exactly so any dt gives the same
 * curve): no overshoot, velocity carried between frames. smoothTime ≈ the time to get most of the way.
 */
export function spring1(x, v, target, smoothTime, dt, out) {
  const w = 2 / Math.max(1e-3, smoothTime);
  const d = x - target; const c = v + w * d; const e = Math.exp(-w * dt);
  out[0] = target + (d + c * dt) * e; out[1] = (v - w * c * dt) * e;
  return out;
}
const SP1 = [0, 0];
export function mkSpring3() { return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, init: false }; }
export function spring3Snap(sp, x, y, z) { sp.x = x; sp.y = y; sp.z = z; sp.vx = 0; sp.vy = 0; sp.vz = 0; sp.init = true; }
export function spring3Step(sp, tx, ty, tz, smoothTime, dt) {
  if (!sp.init) { spring3Snap(sp, tx, ty, tz); return sp; }
  spring1(sp.x, sp.vx, tx, smoothTime, dt, SP1); sp.x = SP1[0]; sp.vx = SP1[1];
  spring1(sp.y, sp.vy, ty, smoothTime, dt, SP1); sp.y = SP1[0]; sp.vy = SP1[1];
  spring1(sp.z, sp.vz, tz, smoothTime, dt, SP1); sp.z = SP1[0]; sp.vz = SP1[1];
  return sp;
}

// ── drawn pose (visual continuity layer) ───────────────────────────
/**
 * The simulation moves a body by its contact point (feet) and turns it in one step at a corner, so
 * drawing the raw sim pose pops the body (and the camera on it) at every transfer, wrap, stick,
 * let-go, step-up and push-out. The drawn pose is the sim pose plus an error that decays: the body is
 * pivoted about its CENTRE (feet + up·h), the centre's offset from the sim centre and the orientation's
 * offset from the sim orientation are kept as critically damped springs, and the drawn feet are
 * centre − up(drawn)·h. A body moving normally has zero error (no lag); a discontinuity in the sim
 * pose adds (drawn − new sim) to the error, so the drawn pose continues from where it was and settles
 * in about a tenth of a second. A convex wrap reads as rolling over the edge, a concave one as tipping
 * up onto the wall. Everything runs at the render rate with the exact spring solution (any dt).
 */
export const VIS = {
  h: 0.2, // pivot height above the feet, × body size
  wPos: 17, // position error spring ω (half-life ≈ 0.1 s)
  wRot: 20, // orientation error spring ω (half-life ≈ 0.085 s)
  jumpPos: 0.06, // a sim centre move beyond this + 1.5 × speed·dt is a discontinuity
  jumpUp: 0.15, // the up vector turning more than this (rad) in one frame is one
  jumpAng: 0.9, // so is the whole orientation turning more than this
  snapDist: 1.2, // a bigger jump is a teleport: no glide
};
export function mkVis() {
  return {
    init: false, snap: false,
    cx: 0, cy: 0, cz: 0, fx: 0, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0, qx: 0, qy: 0, qz: 0, qw: 1,
    tx: 0, ty: 0, tz: 0, tux: 0, tuy: 1, tuz: 0, tqx: 0, tqy: 0, tqz: 0, tqw: 1,
    ox: 0, oy: 0, oz: 0, ovx: 0, ovy: 0, ovz: 0, ex: 0, ey: 0, ez: 0, ewx: 0, ewy: 0, ewz: 0,
    jumps: 0, h: 0.2, lt: -1e9,
  };
}
/** Next update starts on the sim pose (teleports, new rounds). */
export function visSnap(vs) { vs.snap = true; }
function stepExp(x, v, w, dt, out) {
  const c = v + w * x; const e = Math.exp(-w * dt);
  out[0] = (x + c * dt) * e; out[1] = (v - w * c * dt) * e;
}
const SE = [0, 0];
/**
 * Core update from a feet position (px,py,pz) and an orientation (qx,qy,qz,qw): speed (m/s, incl. any
 * vertical) sets what counts as normal motion; size s scales the pivot height; free = a tongue-zip
 * in flight (a long, smooth glide: no kicks). Leaves the drawn pose in vs (centre c, feet f, up u, quat q).
 */
export function visCore(vs, px, py, pz, qx, qy, qz, qw, speed, s, dt, free) {
  const h = VIS.h * s; vs.h = h;
  const ux = 2 * (qx * qy - qw * qz); const uy = 1 - 2 * (qx * qx + qz * qz); const uz = 2 * (qy * qz + qw * qx);
  const tcx = px + ux * h; const tcy = py + uy * h; const tcz = pz + uz * h;
  if (!vs.init || vs.snap) {
    vs.init = true; vs.snap = false;
    vs.ox = 0; vs.oy = 0; vs.oz = 0; vs.ovx = 0; vs.ovy = 0; vs.ovz = 0; vs.ex = 0; vs.ey = 0; vs.ez = 0; vs.ewx = 0; vs.ewy = 0; vs.ewz = 0;
    vs.cx = tcx; vs.cy = tcy; vs.cz = tcz; vs.qx = qx; vs.qy = qy; vs.qz = qz; vs.qw = qw;
  } else if (!free) {
    // discontinuity detection against last frame's sim pose
    const dx = tcx - vs.tx; const dy = tcy - vs.ty; const dz = tcz - vs.tz;
    const dd = Math.hypot(dx, dy, dz);
    if (dd > VIS.jumpPos + 1.5 * speed * dt) {
      if (dd > VIS.snapDist + 2 * speed * dt) { vs.ox = 0; vs.oy = 0; vs.oz = 0; vs.ovx = 0; vs.ovy = 0; vs.ovz = 0; vs.cx = tcx; vs.cy = tcy; vs.cz = tcz; }
      else { vs.ox = vs.cx - tcx; vs.oy = vs.cy - tcy; vs.oz = vs.cz - tcz; vs.jumps++; }
    }
    const upd = ux * vs.tux + uy * vs.tuy + uz * vs.tuz;
    const qd = Math.abs(qx * vs.tqx + qy * vs.tqy + qz * vs.tqz + qw * vs.tqw);
    if (upd < Math.cos(VIS.jumpUp) || 2 * Math.acos(Math.min(1, qd)) > VIS.jumpAng) {
      // e := log(drawn_prev · conj(target_new)), kept in the shorter hemisphere
      let ax = vs.qx; let ay = vs.qy; let az = vs.qz; let aw = vs.qw;
      let rx = aw * -qx + ax * qw + ay * -qz - az * -qy; let ry = aw * -qy - ax * -qz + ay * qw + az * -qx; let rz = aw * -qz + ax * -qy - ay * -qx + az * qw; let rw = aw * qw - ax * -qx - ay * -qy - az * -qz;
      if (rw < 0) { rx = -rx; ry = -ry; rz = -rz; rw = -rw; }
      const sl = Math.hypot(rx, ry, rz);
      if (sl < 1e-6) { vs.ex = 0; vs.ey = 0; vs.ez = 0; } else { const ang = 2 * Math.atan2(sl, rw); vs.ex = (rx / sl) * ang; vs.ey = (ry / sl) * ang; vs.ez = (rz / sl) * ang; }
    }
  } else if (free) {
    // a zip in flight: follow the sim pose exactly
    vs.ox = 0; vs.oy = 0; vs.oz = 0; vs.ovx = 0; vs.ovy = 0; vs.ovz = 0;
  }
  vs.tx = tcx; vs.ty = tcy; vs.tz = tcz; vs.tux = ux; vs.tuy = uy; vs.tuz = uz; vs.tqx = qx; vs.tqy = qy; vs.tqz = qz; vs.tqw = qw;
  // springs: position offset and orientation error decay to zero
  const wp = VIS.wPos; const wr = VIS.wRot;
  stepExp(vs.ox, vs.ovx, wp, dt, SE); vs.ox = SE[0]; vs.ovx = SE[1];
  stepExp(vs.oy, vs.ovy, wp, dt, SE); vs.oy = SE[0]; vs.ovy = SE[1];
  stepExp(vs.oz, vs.ovz, wp, dt, SE); vs.oz = SE[0]; vs.ovz = SE[1];
  stepExp(vs.ex, vs.ewx, wr, dt, SE); vs.ex = SE[0]; vs.ewx = SE[1];
  stepExp(vs.ey, vs.ewy, wr, dt, SE); vs.ey = SE[0]; vs.ewy = SE[1];
  stepExp(vs.ez, vs.ewz, wr, dt, SE); vs.ez = SE[0]; vs.ewz = SE[1];
  // drawn orientation = exp(e) · target
  const el = Math.hypot(vs.ex, vs.ey, vs.ez);
  if (el < 1e-5) { vs.qx = qx; vs.qy = qy; vs.qz = qz; vs.qw = qw; }
  else {
    const sn = Math.sin(el / 2) / el; const ex = vs.ex * sn; const ey = vs.ey * sn; const ez = vs.ez * sn; const ew = Math.cos(el / 2);
    vs.qx = ew * qx + ex * qw + ey * qz - ez * qy; vs.qy = ew * qy - ex * qz + ey * qw + ez * qx; vs.qz = ew * qz + ex * qy - ey * qx + ez * qw; vs.qw = ew * qw - ex * qx - ey * qy - ez * qz;
    const n = Math.hypot(vs.qx, vs.qy, vs.qz, vs.qw) || 1; vs.qx /= n; vs.qy /= n; vs.qz /= n; vs.qw /= n;
  }
  vs.cx = tcx + vs.ox; vs.cy = tcy + vs.oy; vs.cz = tcz + vs.oz;
  vs.ux = 2 * (vs.qx * vs.qy - vs.qw * vs.qz); vs.uy = 1 - 2 * (vs.qx * vs.qx + vs.qz * vs.qz); vs.uz = 2 * (vs.qy * vs.qz + vs.qw * vs.qx);
  vs.fx = vs.cx - vs.ux * h; vs.fy = vs.cy - vs.uy * h; vs.fz = vs.cz - vs.uz * h;
  return vs;
}
const VQ = [0, 0, 0, 1];
/** Update a body's drawn pose from its sim state (a zip in flight follows exactly). */
export function visUpdate(vs, b, dt) {
  bodyQuat(b, VQ);
  return visCore(vs, b.x, b.y, b.z, VQ[0], VQ[1], VQ[2], VQ[3], b.speed + Math.abs(b.vy), b.s || 1, dt, !!b.zip);
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
