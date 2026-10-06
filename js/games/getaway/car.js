// Getaway car physics: an arcade bicycle model stepped at 120 Hz (no THREE, no allocation per
// step except rare collision events). Velocity lives in world space; each step the tyres pull
// the lateral (sideways) part of it towards zero, capped by grip, so turning faster than grip
// allows (or pulling the handbrake) slides the car. Yaw rate chases the kinematic bicycle rate,
// capped by grip. Collisions: the car is three circles along its length against oriented boxes,
// the map bounds and bridge rails; car vs car uses the same circles.
import { CAR, SURF, DAMAGE, G } from './tune.js';

const SF = SURF;

export function newCar(role) {
  return {
    role, x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0, steer: 0,
    hp: 100, flat: 0, spinT: 0, cutT: 0, oilT: 0, nitro: 1, boost: false, boostT: 0,
    level: -1, surf: 'road', water: false, deckS: 0,
    vf: 0, vl: 0, speed: 0, slip: 0, skid: false, hand: false, braking: false, accel: 0,
    pitch: 0, roll: 0, accF: 0, accL: 0, wheel: 0, rpm: 0, gear: 1, gas: 0,
    stopT: 0, topSpeed: 0, ev: [], hitCD: 0, wallCD: 0, frozen: false, offT: 0,
  };
}

export function placeCar(c, x, z, yaw, geo) {
  c.x = x; c.z = z; c.yaw = yaw; c.vx = 0; c.vz = 0; c.r = 0; c.steer = 0; c.level = -1;
  c.y = geo ? geo.ground(x, z) : 0; c.pitch = 0; c.roll = 0; c.spinT = 0; c.cutT = 0; c.oilT = 0;
  c.stopT = 0; c.water = false; c.vf = 0; c.vl = 0; c.speed = 0;
}

const nq = { road: -1 };
const tmpS = { x: 0, z: 0, tx: 0, tz: 0, s: 0 };

/** Which level (bridge deck road idx or −1 = ground) and surface the car is on; sets c.y. */
function updateLevel(c, geo) {
  const roads = geo.roads;
  if (c.level >= 0) {
    const r = roads[c.level];
    geo.nearestRoad(c.x, c.z, nq, r.hw + 24, (o) => o === r);
    if (nq.road < 0 || (!r.closed && (nq.s <= 0.6 || nq.s >= r.len - 0.6) && nq.d > 0.5) || nq.d > r.hw + 6) c.level = -1;
    else {
      c.deckS = nq.s; c.y = geo.deckY(r, nq.s); c.surf = 'road'; c.water = false;
      // rails: keep the car on the deck
      const lim = r.hw - CAR.wid * 0.5;
      if (nq.d > lim && (r.closed || (nq.s > 1 && nq.s < r.len - 1))) {
        const nx = (nq.px - c.x) / (nq.d || 1); const nz = (nq.pz - c.z) / (nq.d || 1);
        const pen = nq.d - lim;
        c.x += nx * pen; c.z += nz * pen;
        const vn = c.vx * nx + c.vz * nz;
        if (vn < 0) {
          c.vx -= (1 + CAR.wallE) * vn * nx; c.vz -= (1 + CAR.wallE) * vn * nz;
          c.vx *= 1 - CAR.wallFric; c.vz *= 1 - CAR.wallFric;
          if (-vn > DAMAGE.wallMin && c.wallCD <= 0) { c.ev.push({ t: 'wall', dmg: (-vn - DAMAGE.wallMin) * DAMAGE.wallK, x: c.x - nx, z: c.z - nz, v: -vn }); c.wallCD = 0.25; }
        }
      }
      return;
    }
  }
  // ground: step onto a bridge deck from one of its ends
  geo.nearestRoad(c.x, c.z, nq, 24, (o) => o.bridge);
  if (nq.road >= 0) {
    const r = roads[nq.road];
    if (nq.d <= r.hw && (nq.s < 14 || nq.s > r.len - 14)) {
      const dy = geo.deckY(r, nq.s) - geo.ground(c.x, c.z);
      if (dy < 2) { c.level = r.idx; c.deckS = nq.s; c.y = geo.deckY(r, nq.s); c.surf = 'road'; c.water = false; return; }
    }
  }
  c.level = -1;
  c.y = geo.ground(c.x, c.z);
  const s = geo.surfaceAt(c.x, c.z);
  c.water = s === 'water';
  c.surf = s === 'water' ? 'sand' : s;
}

/**
 * One fixed step. inp: { steer −1..1, gas 0..1, brake 0..1, hand bool, nitro bool }.
 * T: the role's handling (CAR.runner / CAR.cop). nit: nitro drain/regen.
 */
export function stepCar(c, inp, dt, geo, T, nit) {
  if (c.frozen) { c.vx = 0; c.vz = 0; c.r = 0; return; }
  c.hitCD -= dt; c.wallCD -= dt;
  if (c.spinT > 0) c.spinT -= dt;
  if (c.cutT > 0) c.cutT -= dt;
  if (c.oilT > 0) c.oilT -= dt;
  const sy = Math.sin(c.yaw); const cy = Math.cos(c.yaw);
  const fx = sy; const fz = -cy; const rx = cy; const rz = sy;
  let vf = c.vx * fx + c.vz * fz;
  let vl = c.vx * rx + c.vz * rz;
  const sf = SF[c.surf] || SF.grass;
  const hpK = c.role === 'cop' ? 0.72 + 0.28 * Math.max(0, c.hp) / 100 : 0.86 + 0.14 * Math.max(0, c.hp) / 100;
  const flatTop = 1 - 0.3 * c.flat; const flatGrip = 1 - 0.4 * c.flat;
  // nitro
  const wantBoost = !!inp.nitro && c.nitro > 0.02 && nit.regen > 0 && vf > 2 && c.cutT <= 0;
  c.boost = wantBoost;
  if (wantBoost) { c.nitro = Math.max(0, c.nitro - nit.drain * dt); c.boostT = 0.6; }
  else { if (c.boostT > 0) c.boostT -= dt; else c.nitro = Math.min(1, c.nitro + nit.regen * dt); }
  const vTop = T.vTop * sf.top * hpK * flatTop * (wantBoost ? T.nitroTop : 1);
  const spin = c.spinT > 0;
  const grip = T.grip * sf.grip * flatGrip * (spin ? 0.32 : 1) * (c.oilT > 0 ? 0.3 : 1);
  const gas = c.cutT > 0 ? 0 : Math.max(0, Math.min(1, inp.gas || 0));
  const brake = Math.max(0, Math.min(1, inp.brake || 0));
  const hand = !!inp.hand;
  c.hand = hand; c.gas = gas;
  // ── longitudinal ──
  let a = 0;
  c.braking = false;
  if (brake > 0 && vf > 0.8) { a = -T.brake * brake * (0.55 + 0.45 * sf.grip); c.braking = true; }
  else if (brake > 0 && gas <= 0) { a = vf > -CAR.revTop ? -CAR.revAccel * brake : 0; if (vf > 0) a = -T.brake; }
  else if (gas > 0) {
    if (vf < -0.5) { a = T.brake * gas; c.braking = true; }
    else { const u = Math.max(0, vf) / vTop; a = gas * T.accel * Math.max(0, 1 - u * u * u) + (wantBoost ? T.nitroA : 0); }
  } else a = vf > 0.2 ? -CAR.coast : vf < -0.2 ? CAR.coast : -vf * 4;
  a -= CAR.drag * vf * Math.abs(vf) + CAR.roll * vf + sf.drag * Math.sign(vf) * Math.min(1, Math.abs(vf) * 0.2);
  if (vf > vTop) a -= (vf - vTop) * 0.9;
  if (hand && Math.abs(vf) > 0.5) a -= Math.sign(vf) * CAR.handDecel;
  if (geo.hasHeight && c.level < 0) {
    const s = (geo.ground(c.x + fx * 1.5, c.z + fz * 1.5) - geo.ground(c.x - fx * 1.5, c.z - fz * 1.5)) / 3;
    a -= G * Math.max(-0.2, Math.min(0.2, s));
  }
  const vf0 = vf;
  vf += a * dt;
  if ((c.braking || hand || (brake > 0 && gas <= 0 && vf0 > 0)) && vf0 > 0 && vf < 0) vf = 0; // brakes stop, they don't reverse
  c.accel = a;
  // ── steering + yaw ──
  const st = Math.max(-1, Math.min(1, inp.steer || 0));
  c.steer += Math.max(-9 * dt, Math.min(9 * dt, st - c.steer));
  const lock = T.steer / (1 + Math.abs(vf) / CAR.steerSpeed);
  const delta = c.steer * lock;
  let rT = (vf * Math.tan(delta)) / CAR.base;
  if (c.braking && vf > 6) rT *= 1.12; else if (gas > 0.5 && vf > 15) rT *= 0.96; // weight shift
  const maxR = (grip * 0.97) / Math.max(Math.abs(vf), 4) * (hand ? 2.3 : 1);
  if (rT > maxR) rT = maxR; else if (rT < -maxR) rT = -maxR;
  let k = T.yawK;
  if (hand) k = 4.5; else if (Math.abs(vl) > CAR.slipSkid * 1.5) k = 5.5;
  if (spin) { rT = c.r * 0.985; k = 2; }
  c.r += (rT - c.r) * Math.min(1, k * dt);
  // ── lateral grip ──
  let latG = grip;
  if (hand) latG *= CAR.handGrip;
  const want = Math.abs(vl) * Math.min(1, 16 * dt);
  const dvl = Math.min(want, latG * dt);
  vl -= Math.sign(vl) * dvl;
  // a sliding car scrubs speed
  if (Math.abs(vl) > 2) vf -= Math.sign(vf) * Math.min(Math.abs(vf), Math.abs(vl) * 0.25 * dt);
  c.vf = vf; c.vl = vl; c.slip = Math.abs(vl);
  c.skid = (c.slip > CAR.slipSkid && Math.abs(vf) > 3) || (hand && Math.abs(vf) > 7) || (c.braking && brake > 0.7 && vf > 14 && sf === SF.road);
  c.vx = fx * vf + rx * vl; c.vz = fz * vf + rz * vl;
  // weight-shift visuals
  c.accF += (a - c.accF) * Math.min(1, 6 * dt);
  c.accL += (vf * c.r - c.accL) * Math.min(1, 6 * dt);
  c.pitch = Math.max(-0.06, Math.min(0.06, -c.accF * 0.006));
  c.roll = Math.max(-0.08, Math.min(0.08, c.accL * 0.0055));
  // integrate
  c.x += c.vx * dt; c.z += c.vz * dt; c.yaw += c.r * dt;
  if (c.yaw > Math.PI) c.yaw -= Math.PI * 2; else if (c.yaw < -Math.PI) c.yaw += Math.PI * 2;
  c.speed = Math.hypot(c.vx, c.vz);
  if (c.speed > c.topSpeed) c.topSpeed = c.speed;
  c.wheel += vf * dt / 0.36;
  // engine note: a fake 5-speed box
  const gears = [0, 9, 17, 26, 35, 99];
  let g = 1; while (g < 5 && Math.abs(vf) > gears[g]) g++;
  c.gear = g;
  const lo = gears[g - 1]; const hi = Math.min(gears[g], T.vTop * 1.25);
  c.rpm += ((0.2 + 0.8 * Math.min(1, (Math.abs(vf) - lo) / Math.max(1, hi - lo)) * (gas > 0 || brake > 0 ? 1 : 0.85)) - c.rpm) * Math.min(1, 10 * dt);
  updateLevel(c, geo);
  collideWorld(c, geo);
}

const CZ = [CAR.circZ, 0, -CAR.circZ];
/** Circles vs solid boxes + map bounds. */
export function collideWorld(c, geo) {
  const B = geo.bounds;
  const R = CAR.circR;
  const sy = Math.sin(c.yaw); const cy = Math.cos(c.yaw);
  const fx = sy; const fz = -cy;
  const onDeck = c.level >= 0;
  const gy = onDeck ? geo.ground(c.x, c.z) : c.y;
  geo.eachSolid(c.x, c.z, 4, (o) => {
    if (o.broken) return;
    if (onDeck && gy + o.h < c.y - 0.5) return; // passing over it on a deck
    if (!onDeck && o.y != null && o.y > c.y + 2) return; // overhead (signs, decks)
    let best = 0; let bnx = 0; let bnz = 0; let bpx = 0; let bpz = 0;
    for (let k = 0; k < 3; k++) {
      const px = c.x + fx * CZ[k]; const pz = c.z + fz * CZ[k];
      const ax = px - o.x; const az = pz - o.z;
      const lx = ax * o.c - az * o.s; const lz = ax * o.s + az * o.c;
      const qx = lx < -o.hw ? -o.hw : lx > o.hw ? o.hw : lx;
      const qz = lz < -o.hd ? -o.hd : lz > o.hd ? o.hd : lz;
      let dx = lx - qx; let dz = lz - qz; let d = Math.hypot(dx, dz); let pen;
      if (d < 1e-6) { // centre inside: push out along the shallowest face
        const ex = o.hw - Math.abs(lx); const ez = o.hd - Math.abs(lz);
        if (ex < ez) { dx = Math.sign(lx) || 1; dz = 0; pen = ex + R; } else { dx = 0; dz = Math.sign(lz) || 1; pen = ez + R; }
        d = 1;
      } else { if (d >= R) continue; pen = R - d; }
      if (pen > best) {
        best = pen;
        const nlx = dx / d; const nlz = dz / d;
        // local → world (inverse of the rotation above)
        bnx = nlx * o.c + nlz * o.s; bnz = -nlx * o.s + nlz * o.c;
        const wqx = qx * o.c + qz * o.s; const wqz = -qx * o.s + qz * o.c;
        bpx = o.x + wqx; bpz = o.z + wqz;
      }
    }
    if (best <= 0) return;
    if (o.breakable && c.speed > DAMAGE.breakable) {
      o.broken = true;
      c.vx *= 0.86; c.vz *= 0.86;
      c.ev.push({ t: 'break', solid: o.i, x: o.x, z: o.z, vx: c.vx, vz: c.vz });
      return;
    }
    wallHit(c, bnx, bnz, best, bpx, bpz, o.breakable ? 0.4 : 1);
  });
  // bounds
  const m = 1.2;
  if (c.x < B.x0 + m) wallHit(c, 1, 0, B.x0 + m - c.x, B.x0, c.z, 1);
  if (c.x > B.x1 - m) wallHit(c, -1, 0, c.x - (B.x1 - m), B.x1, c.z, 1);
  if (c.z < B.z0 + m) wallHit(c, 0, 1, B.z0 + m - c.z, c.x, B.z0, 1);
  if (c.z > B.z1 - m) wallHit(c, 0, -1, c.z - (B.z1 - m), c.x, B.z1, 1);
}

/** Resolve a static contact: normal n (pointing out of the wall), penetration, contact point. */
function wallHit(c, nx, nz, pen, px, pz, dmgK) {
  c.x += nx * pen; c.z += nz * pen;
  const rpx = px - c.x; const rpz = pz - c.z;
  // contact point velocity = v + ω × rp, with ω × p = ω(−pz, px)
  const vpx = c.vx - c.r * rpz; const vpz = c.vz + c.r * rpx;
  const vn = vpx * nx + vpz * nz;
  if (vn >= 0) return;
  const rxn = rpx * nz - rpz * nx;
  const j = (-(1 + CAR.wallE) * vn) / (1 + (rxn * rxn) / CAR.inertia);
  c.vx += j * nx; c.vz += j * nz;
  c.r += (rpx * (j * nz) - rpz * (j * nx)) / CAR.inertia;
  // scrape: lose some of the speed along the wall
  const tx = -nz; const tz = nx; const vt = c.vx * tx + c.vz * tz;
  c.vx -= tx * vt * CAR.wallFric; c.vz -= tz * vt * CAR.wallFric;
  if (-vn > DAMAGE.wallMin * 0.6 && c.wallCD <= 0) {
    c.ev.push({ t: 'wall', dmg: Math.max(0, -vn - DAMAGE.wallMin) * DAMAGE.wallK * dmgK, x: px, z: pz, v: -vn });
    c.wallCD = 0.22;
  }
}

/** Deepest overlap between car a and car b (a pose: x, z, yaw). Returns pen > 0 or 0. out gets
 *  { pen, nx, nz (from b to a), px, pz (contact point), ia, ib (circle index: 0 front, 1 mid, 2 rear) }. */
export function carContact(a, b, out) {
  const R2 = CAR.circR * 2;
  const dx0 = a.x - b.x; const dz0 = a.z - b.z;
  if (dx0 * dx0 + dz0 * dz0 > 49) return 0;
  if (Math.abs(a.y - b.y) > 2.5) return 0; // one is on a bridge deck above the other
  const afx = Math.sin(a.yaw); const afz = -Math.cos(a.yaw);
  const bfx = Math.sin(b.yaw); const bfz = -Math.cos(b.yaw);
  let best = 0;
  for (let i = 0; i < 3; i++) {
    const ax = a.x + afx * CZ[i]; const az = a.z + afz * CZ[i];
    for (let j = 0; j < 3; j++) {
      const bx = b.x + bfx * CZ[j]; const bz = b.z + bfz * CZ[j];
      const dx = ax - bx; const dz = az - bz; const d = Math.hypot(dx, dz);
      if (d >= R2) continue;
      const pen = R2 - d;
      if (pen > best) {
        best = pen;
        out.nx = d > 1e-6 ? dx / d : 1; out.nz = d > 1e-6 ? dz / d : 0;
        out.px = (ax + bx) / 2; out.pz = (az + bz) / 2; out.ia = i; out.ib = j;
      }
    }
  }
  out.pen = best;
  return best;
}

/** Apply the contact impulse to car `a` only (b is the other device's car, as predicted), equal
 *  masses. Returns the closing speed along the normal (≥ 0) and fills info.relLat etc. */
export function resolveCar(a, b, ct, mA = 1, mB = 1) {
  a.x += ct.nx * ct.pen * 0.55; a.z += ct.nz * ct.pen * 0.55;
  const rax = ct.px - a.x; const raz = ct.pz - a.z;
  const rbx = ct.px - b.x; const rbz = ct.pz - b.z;
  const vax = a.vx - a.r * raz; const vaz = a.vz + a.r * rax;
  const vbx = b.vx - (b.r || 0) * rbz; const vbz = b.vz + (b.r || 0) * rbx;
  const vn = (vax - vbx) * ct.nx + (vaz - vbz) * ct.nz;
  if (vn >= 0) return 0;
  const rxn = rax * ct.nz - raz * ct.nx; const rbn = rbx * ct.nz - rbz * ct.nx;
  const j = (-(1 + CAR.carE) * vn) / (1 / mA + 1 / mB + (rxn * rxn) / (CAR.inertia * mA) + (rbn * rbn) / (CAR.inertia * mB));
  a.vx += (j * ct.nx) / mA; a.vz += (j * ct.nz) / mA;
  a.r += (rax * (j * ct.nz) - raz * (j * ct.nx)) / (CAR.inertia * mA);
  return -vn;
}

/** PIT check, from the victim's side (v = runner, cop = the attacker as predicted).
 *  A PIT is a push on the victim's rear quarter, from the side, by a car running roughly the same
 *  way, at speed. Returns 0 (not a PIT) or the spin direction (±1). */
export function judgePit(v, cop, ct) {
  if (Math.hypot(v.vx, v.vz) < DAMAGE.pitMinSpeed) return 0;
  const vfx = Math.sin(v.yaw); const vfz = -Math.cos(v.yaw); const vrx = Math.cos(v.yaw); const vrz = Math.sin(v.yaw);
  const lx = (ct.px - v.x) * vrx + (ct.pz - v.z) * vrz;  // + = right side
  const lz = (ct.px - v.x) * vfx + (ct.pz - v.z) * vfz;  // + = front
  if (lz > -0.35) return 0;                               // not behind the middle
  if (Math.abs(lx) < 0.35) return 0;                      // dead behind: a ram, not a PIT
  let dh = cop.yaw - v.yaw; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
  if (Math.abs(dh) > DAMAGE.pitMaxAngle) return 0;        // T-bone or head-on
  const side = Math.sign(lx);
  const push = -((cop.vx - v.vx) * vrx + (cop.vz - v.vz) * vrz) * side; // cop moving into that side
  const along = (cop.vx * vfx + cop.vz * vfz);
  if (push < DAMAGE.pitMinRel || along < DAMAGE.pitMinSpeed * 0.7) return 0;
  // pushing the rear sideways swings the nose the other way: rear pushed left (contact on the
  // right) → yaw increases (clockwise from above)
  return side;
}
