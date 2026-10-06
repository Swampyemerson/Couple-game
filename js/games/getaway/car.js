// Getaway car physics: an arcade bicycle model stepped at 120 Hz (no THREE, no allocation per
// step except rare collision events). Velocity lives in world space; each step the tyres pull
// the lateral (sideways) part of it towards zero, capped by grip, so turning faster than grip
// allows (or pulling the handbrake) slides the car. Yaw rate chases the kinematic bicycle rate,
// capped by grip, with weight transfer (braking turns in, power at the limit swings the tail).
//
// Collisions: the car is an oriented box (CAR.hl × CAR.hw, the body's size) tested with SAT
// against solid boxes, against small breakables as circles the size of their trunk, against the
// map bounds and bridge rails; car vs car is box vs box. A sliding car remembers the wall it is
// scraping so seams between boxes don't catch it.
//
// Body motion for the renderer (all smoothed by spring-dampers, so curbs and hits bounce):
//   c.pitch  rad, > 0 nose down (braking dive; cars.js tilt.rotation.x = pitch)
//   c.roll   rad, > 0 while turning right (body leans out; cars.js tilt.rotation.z = −roll)
//   c.heave  m, body height offset (< 0 compressed: kerbs, landings)
//   c.susp   Float32Array(4) wheel compression in m (FL, FR, RL, RR), > 0 = compressed
//   c.drift  0..1 how much the car is drifting (smoke, tyre audio), c.slip m/s sideways
//   c.grip   0..1 current surface grip factor (smoothed; the HUD/FX may read it)
import { CAR, SURF, DAMAGE, G } from './tune.js';

const SF = SURF;

export function newCar(role) {
  return {
    role, x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0, steer: 0,
    hp: 100, flat: 0, spinT: 0, cutT: 0, oilT: 0, nitro: 1, boost: false, boostT: 0,
    level: -1, surf: 'road', water: false, deckS: 0,
    vf: 0, vl: 0, speed: 0, slip: 0, skid: false, hand: false, braking: false, accel: 0,
    pitch: 0, roll: 0, heave: 0, pv: 0, rv: 0, hv: 0, susp: new Float32Array(4), drift: 0, grip: 1,
    sg: 1, st: 1, sd: 0, accF: 0, accL: 0, wheel: 0, rpm: 0, gear: 1, gas: 0,
    stopT: 0, topSpeed: 0, ev: [], hitCD: 0, wallCD: 0, frozen: false, offT: 0,
    wnx: 0, wnz: 0, wnT: 0, // the wall normal it is sliding along (seam memory)
    hl: CAR.hl, hw: CAR.hw,
  };
}

export function placeCar(c, x, z, yaw, geo) {
  c.x = x; c.z = z; c.yaw = yaw; c.vx = 0; c.vz = 0; c.r = 0; c.steer = 0; c.level = -1;
  c.y = geo ? geo.ground(x, z) : 0; c.pitch = 0; c.roll = 0; c.heave = 0; c.pv = 0; c.rv = 0; c.hv = 0; c.susp.fill(0);
  c.spinT = 0; c.cutT = 0; c.oilT = 0; c.drift = 0; c.wnT = 0;
  c.stopT = 0; c.water = false; c.vf = 0; c.vl = 0; c.speed = 0;
  if (geo) { const s = geo.surfaceAt(x, z); const sf = SF[s === 'water' ? 'sand' : s] || SF.road; c.sg = sf.grip; c.st = sf.top; c.sd = sf.drag; c.surf = s === 'water' ? 'sand' : s; }
}

const nq = { road: -1 };

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
        wallHit(c, nx, nz, pen, c.x - nx * CAR.wid * 0.5, c.z - nz * CAR.wid * 0.5, 1, true);
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

const ROUGH = { grass: 1, dirt: 1, sand: 1 };

/**
 * One fixed step. inp: { steer −1..1, gas 0..1, brake 0..1, hand bool, nitro bool }.
 * T: the role's handling (CAR.runner / CAR.cop). nit: nitro drain/regen.
 */
export function stepCar(c, inp, dt, geo, T, nit) {
  if (c.frozen) { c.vx = 0; c.vz = 0; c.r = 0; return; }
  c.hitCD -= dt; c.wallCD -= dt; if (c.wnT > 0) c.wnT -= dt;
  if (c.spinT > 0) c.spinT -= dt;
  if (c.cutT > 0) c.cutT -= dt;
  if (c.oilT > 0) c.oilT -= dt;
  const sy = Math.sin(c.yaw); const cy = Math.cos(c.yaw);
  const fx = sy; const fz = -cy; const rx = cy; const rz = sy;
  let vf = c.vx * fx + c.vz * fz;
  let vl = c.vx * rx + c.vz * rz;
  // surface: grip, top speed and drag ease in over ~0.15 s (no wall-like step at a kerb)
  const sf = SF[c.surf] || SF.grass;
  const ke = Math.min(1, dt * 7);
  c.sg += (sf.grip - c.sg) * ke; c.st += (sf.top - c.st) * ke; c.sd += (sf.drag - c.sd) * ke;
  c.grip = c.sg;
  const hpK = c.role === 'cop' ? 0.72 + 0.28 * Math.max(0, c.hp) / 100 : 0.86 + 0.14 * Math.max(0, c.hp) / 100;
  const flatTop = 1 - 0.3 * c.flat; const flatGrip = 1 - 0.4 * c.flat;
  // nitro
  const wantBoost = !!inp.nitro && c.nitro > 0.02 && nit.regen > 0 && vf > 2 && c.cutT <= 0;
  c.boost = wantBoost;
  if (wantBoost) { c.nitro = Math.max(0, c.nitro - nit.drain * dt); c.boostT = 0.6; }
  else { if (c.boostT > 0) c.boostT -= dt; else c.nitro = Math.min(1, c.nitro + nit.regen * dt); }
  const vTop = T.vTop * c.st * hpK * flatTop * (wantBoost ? T.nitroTop : 1);
  const spin = c.spinT > 0;
  const grip = T.grip * c.sg * flatGrip * (spin ? 0.32 : 1) * (c.oilT > 0 ? 0.3 : 1);
  const gas = c.cutT > 0 ? 0 : Math.max(0, Math.min(1, inp.gas || 0));
  const brake = Math.max(0, Math.min(1, inp.brake || 0));
  const hand = !!inp.hand;
  c.hand = hand; c.gas = gas;
  // ── longitudinal ──
  let a = 0;
  c.braking = false;
  if (brake > 0 && vf > 0.8) { a = -T.brake * brake * (0.55 + 0.45 * c.sg); c.braking = true; }
  else if (brake > 0 && gas <= 0) { a = vf > -CAR.revTop ? -CAR.revAccel * brake : 0; if (vf > 0) a = -T.brake; }
  else if (gas > 0) {
    if (vf < -0.5) { a = T.brake * gas; c.braking = true; }
    else { const u = Math.max(0, vf) / vTop; a = gas * T.accel * Math.max(0, 1 - u * u * u) + (wantBoost ? T.nitroA : 0); }
  } else a = vf > 0.2 ? -CAR.coast : vf < -0.2 ? CAR.coast : -vf * 4;
  a -= CAR.drag * vf * Math.abs(vf) + CAR.roll * vf + c.sd * Math.sign(vf) * Math.min(1, Math.abs(vf) * 0.2);
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
  // weight transfer: + under braking (load on the nose), − under power
  const wt = Math.max(-1, Math.min(1, -c.accF / 12));
  // ── steering + yaw ──
  const st = Math.max(-1, Math.min(1, inp.steer || 0));
  c.steer += Math.max(-9 * dt, Math.min(9 * dt, st - c.steer));
  const lock = T.steer / (1 + Math.abs(vf) / CAR.steerSpeed);
  const delta = c.steer * lock;
  let rT = (vf * Math.tan(delta)) / CAR.base;
  if (vf > 6) rT *= 1 + CAR.weightTurn * wt; // braking turns in, throttle pushes wide
  // the grip cap on yaw rate: the handbrake frees the rear; power while sliding holds the angle
  const capK = hand ? CAR.handYaw : 1;
  const maxR = (grip * 0.97) / Math.max(Math.abs(vf), 4) * capK;
  if (rT > maxR) rT = maxR; else if (rT < -maxR) rT = -maxR;
  let k = T.yawK;
  if (hand) k = 4.5; else if (Math.abs(vl) > CAR.slipSkid * 1.5) k = 5.5;
  if (spin) { rT = c.r * 0.985; k = 2; }
  c.r += (rT - c.r) * Math.min(1, k * dt);
  // ── lateral grip ──
  let latG = grip;
  if (hand) latG *= CAR.handGrip;
  else if (Math.abs(vl) > CAR.slipSkid * 1.4 && gas > 0.5 && vf > 8) {
    // power slide: the rear stays loose; counter-steer (steering into the slide) holds the angle
    latG *= Math.sign(c.steer) === Math.sign(vl) && Math.abs(c.steer) > 0.15 ? CAR.driftGrip * 0.9 : CAR.driftGrip;
  }
  latG *= 1 - 0.08 * Math.max(0, -wt) * gas; // a little power oversteer
  const want = Math.abs(vl) * Math.min(1, 16 * dt);
  const dvl = Math.min(want, latG * dt);
  vl -= Math.sign(vl) * dvl;
  // a sliding car scrubs speed
  if (Math.abs(vl) > 2) vf -= Math.sign(vf) * Math.min(Math.abs(vf), Math.abs(vl) * 0.25 * dt);
  c.vf = vf; c.vl = vl; c.slip = Math.abs(vl);
  c.drift += ((Math.abs(vf) > 6 ? Math.min(1, Math.max(0, (c.slip - 1.5) / 6)) : 0) - c.drift) * Math.min(1, dt * 8);
  c.skid = (c.slip > CAR.slipSkid && Math.abs(vf) > 3) || (hand && Math.abs(vf) > 7) || (c.braking && brake > 0.7 && vf > 14 && c.surf === 'road');
  c.vx = fx * vf + rx * vl; c.vz = fz * vf + rz * vl;
  // ── body: spring-damped pitch / roll / heave (≈1.6 Hz, ζ ≈ 0.45) ──
  c.accF += (a - c.accF) * Math.min(1, 10 * dt);
  c.accL += (vf * c.r - c.accL) * Math.min(1, 10 * dt);
  const K = CAR.suspK; const D = CAR.suspD;
  const pT = Math.max(-0.07, Math.min(0.07, -c.accF * 0.0062));
  const rTg = Math.max(-0.09, Math.min(0.09, c.accL * 0.0056));
  c.pv += (K * (pT - c.pitch) - D * c.pv) * dt; c.pitch += c.pv * dt;
  c.rv += (K * (rTg - c.roll) - D * c.rv) * dt; c.roll += c.rv * dt;
  c.hv += (K * 1.3 * (0 - c.heave) - D * 1.1 * c.hv) * dt; c.heave += c.hv * dt;
  // rough ground shakes the body
  if (ROUGH[c.surf] && c.speed > 4) { const n = Math.min(1, c.speed / 25) * dt; c.hv += (Math.random() - 0.5) * 9 * n; c.rv += (Math.random() - 0.5) * 1.2 * n; }
  if (c.pitch > 0.12) c.pitch = 0.12; else if (c.pitch < -0.12) c.pitch = -0.12;
  if (c.roll > 0.14) c.roll = 0.14; else if (c.roll < -0.14) c.roll = -0.14;
  if (c.heave > 0.15) c.heave = 0.15; else if (c.heave < -0.18) c.heave = -0.18;
  const sp = c.susp; const hp0 = -c.heave; const pp = c.pitch * 1.38; const rp = c.roll * 0.86;
  sp[0] = hp0 + pp + rp * -1; sp[1] = hp0 + pp + rp; sp[2] = hp0 - pp - rp; sp[3] = hp0 - pp + rp;
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
  const surf0 = c.surf; const lv0 = c.level;
  updateLevel(c, geo);
  // a kerb: changing between road and the verge at speed bumps the suspension
  if (surf0 !== c.surf && lv0 === c.level && c.speed > 4 && (surf0 === 'road' || c.surf === 'road')) {
    const k2 = Math.min(1, c.speed / 22);
    c.hv -= 0.9 * k2; c.rv += (Math.random() < 0.5 ? -1 : 1) * 0.35 * k2; c.pv += 0.12 * k2;
    c.ev.push({ t: 'kerb', v: c.speed });
  }
  collideWorld(c, geo);
}

// ── box geometry helpers ──
// An OBB here: centre (x, z), unit axes U (half extent eu) and V (half extent ev).
const A0 = { x: 0, z: 0, ux: 0, uz: 0, eu: 0, vx: 0, vz: 0, ev: 0 };
const B0 = { x: 0, z: 0, ux: 0, uz: 0, eu: 0, vx: 0, vz: 0, ev: 0 };
function carBox(o, c, hl = c.hl || CAR.hl, hw = c.hw || CAR.hw) {
  const s = Math.sin(c.yaw); const co = Math.cos(c.yaw);
  o.x = c.x; o.z = c.z; o.ux = co; o.uz = s; o.eu = hw; o.vx = s; o.vz = -co; o.ev = hl; // U = right, V = forward
  return o;
}
function solidBox(o, s) {
  o.x = s.x; o.z = s.z; o.ux = s.c; o.uz = -s.s; o.eu = s.hw; o.vx = s.s; o.vz = s.c; o.ev = s.hd;
  return o;
}
const projR = (b, nx, nz) => b.eu * Math.abs(b.ux * nx + b.uz * nz) + b.ev * Math.abs(b.vx * nx + b.vz * nz);
const SAT = { pen: 0, nx: 0, nz: 0, px: 0, pz: 0, axis: 0, alt: [0, 0, 0, 0, 0, 0, 0, 0] };
/** Box A vs box B. Returns the penetration (> 0 overlap) with SAT.nx/nz from B to A and a contact
 *  point; SAT.alt holds every axis' [overlap, nx, nz…] pair for the seam fix. */
function boxBox(A, B) {
  const dx = A.x - B.x; const dz = A.z - B.z;
  let best = Infinity; let bnx = 0; let bnz = 0; let bAxis = -1;
  for (let k = 0; k < 4; k++) {
    let nx; let nz;
    if (k === 0) { nx = A.ux; nz = A.uz; } else if (k === 1) { nx = A.vx; nz = A.vz; } else if (k === 2) { nx = B.ux; nz = B.uz; } else { nx = B.vx; nz = B.vz; }
    const d = dx * nx + dz * nz;
    const ov = projR(A, nx, nz) + projR(B, nx, nz) - Math.abs(d);
    if (ov <= 0) return 0;
    const sg = d >= 0 ? 1 : -1;
    SAT.alt[k * 2] = ov; SAT.alt[k * 2 + 1] = k; // overlap, axis id (normal recomputed on demand)
    if (ov < best) { best = ov; bnx = nx * sg; bnz = nz * sg; bAxis = k; }
  }
  SAT.pen = best; SAT.nx = bnx; SAT.nz = bnz; SAT.axis = bAxis;
  contactPoint(A, B, bAxis);
  return best;
}
/** Contact point for the chosen axis: the deepest corner of the incident box (two corners at the
 *  same depth = an edge: their midpoint), moved half the overlap back. */
function contactPoint(A, B, axis) {
  const fromB = axis >= 2; // reference face on B: A's corner digs into B
  const I = fromB ? A : B; const nx = fromB ? -SAT.nx : SAT.nx; const nz = fromB ? -SAT.nz : SAT.nz;
  let d1 = -Infinity; let d2 = -Infinity; let x1 = 0; let z1 = 0; let x2 = 0; let z2 = 0;
  for (let k = 0; k < 4; k++) {
    const su = k & 1 ? 1 : -1; const sv = k & 2 ? 1 : -1;
    const px = I.x + I.ux * I.eu * su + I.vx * I.ev * sv; const pz = I.z + I.uz * I.eu * su + I.vz * I.ev * sv;
    const d = px * nx + pz * nz;
    if (d > d1) { d2 = d1; x2 = x1; z2 = z1; d1 = d; x1 = px; z1 = pz; } else if (d > d2) { d2 = d; x2 = px; z2 = pz; }
  }
  let px = x1; let pz = z1;
  if (d1 - d2 < 0.08) { px = (x1 + x2) / 2; pz = (z1 + z2) / 2; }
  // the corner pokes into the other box; the touch point is half way back out
  const h = SAT.pen * 0.5;
  SAT.px = px - nx * h; SAT.pz = pz - nz * h;
}
/** Circle (x, z, r) vs box A. Returns pen with SAT.nx/nz from the circle to the box. */
function circleBox(A, x, z, r) {
  const dx = A.x - x; const dz = A.z - z;
  const lu = -(dx * A.ux + dz * A.uz); const lv = -(dx * A.vx + dz * A.vz); // circle centre in A's frame
  const qu = Math.max(-A.eu, Math.min(A.eu, lu)); const qv = Math.max(-A.ev, Math.min(A.ev, lv));
  const ex = lu - qu; const ez = lv - qv; const d = Math.hypot(ex, ez);
  const qx = A.x + A.ux * qu + A.vx * qv; const qz = A.z + A.uz * qu + A.vz * qv;
  if (d > 1e-6) {
    if (d >= r) return 0;
    // from the circle centre towards the box's closest point
    SAT.nx = (qx - x) / d; SAT.nz = (qz - z) / d; SAT.pen = r - d;
  } else { // centre inside the box: out through the nearest face
    const fu = A.eu - Math.abs(lu); const fv = A.ev - Math.abs(lv);
    if (fu < fv) { const sg = lu >= 0 ? -1 : 1; SAT.nx = A.ux * sg; SAT.nz = A.uz * sg; SAT.pen = fu + r; } else { const sg = lv >= 0 ? -1 : 1; SAT.nx = A.vx * sg; SAT.nz = A.vz * sg; SAT.pen = fv + r; }
  }
  SAT.px = qx; SAT.pz = qz;
  return SAT.pen;
}
const axisN = (A, B, k, out) => { if (k === 0) { out[0] = A.ux; out[1] = A.uz; } else if (k === 1) { out[0] = A.vx; out[1] = A.vz; } else if (k === 2) { out[0] = B.ux; out[1] = B.uz; } else { out[0] = B.vx; out[1] = B.vz; } return out; };
const an = [0, 0];

/** The car vs solids, breakables and the map bounds (one pass; contacts resolved in turn). */
export function collideWorld(c, geo) {
  const B = geo.bounds;
  const onDeck = c.level >= 0;
  const gy = onDeck ? geo.ground(c.x, c.z) : c.y;
  geo.eachSolid(c.x, c.z, 4, (o) => {
    if (o.broken) return;
    if (onDeck && gy + o.h < c.y - 0.5) return; // passing over it on a deck
    if (!onDeck && o.y != null && o.y > c.y + 2) return; // overhead (signs, decks)
    if (Math.abs(o.x - c.x) > o.rad + 3 || Math.abs(o.z - c.z) > o.rad + 3) return;
    const A = carBox(A0, c);
    let pen;
    if (o.cr > 0) pen = circleBox(A, o.x, o.z, o.cr);
    else pen = boxBox(A, solidBox(B0, o));
    if (pen <= 0) return;
    let nx = SAT.nx; let nz = SAT.nz;
    // seam fix: sliding along a wall, a neighbouring box's end face must not catch the car
    if (o.cr <= 0 && c.wnT > 0 && (nx * c.wnx + nz * c.wnz) < 0.9) {
      for (let k = 0; k < 4; k++) {
        axisN(A, B0, k, an);
        const d = (A.x - B0.x) * an[0] + (A.z - B0.z) * an[1]; const sg = d >= 0 ? 1 : -1;
        const ax = an[0] * sg; const az = an[1] * sg;
        if (ax * c.wnx + az * c.wnz > 0.97) {
          const ov = projR(A, an[0], an[1]) + projR(B0, an[0], an[1]) - Math.abs(d);
          if (ov > 0 && ov < 0.3) { nx = ax; nz = az; pen = ov; }
          break;
        }
      }
    }
    const sp = c.speed;
    if (o.soft) { // shrubs: flatten them, lose a little speed
      if (sp > 1.5) { o.broken = true; c.vx *= 0.96; c.vz *= 0.96; c.ev.push({ t: 'break', solid: o.i, x: o.x, z: o.z, vx: c.vx, vz: c.vz, soft: true }); }
      return;
    }
    if (o.breakable && sp > (o.flimsy ? DAMAGE.flimsy : DAMAGE.breakable)) {
      o.broken = true;
      const k = o.flimsy ? 0.95 : 0.86;
      c.vx *= k; c.vz *= k;
      c.ev.push({ t: 'break', solid: o.i, x: o.x, z: o.z, vx: c.vx, vz: c.vz, flimsy: o.flimsy });
      return;
    }
    wallHit(c, nx, nz, pen, SAT.px, SAT.pz, o.breakable ? 0.4 : 1, !o.breakable);
  });
  // bounds
  const m = CAR.hl * 0.6;
  if (c.x < B.x0 + m) wallHit(c, 1, 0, B.x0 + m - c.x, B.x0, c.z, 1, true);
  if (c.x > B.x1 - m) wallHit(c, -1, 0, c.x - (B.x1 - m), B.x1, c.z, 1, true);
  if (c.z < B.z0 + m) wallHit(c, 0, 1, B.z0 + m - c.z, c.x, B.z0, 1, true);
  if (c.z > B.z1 - m) wallHit(c, 0, -1, c.z - (B.z1 - m), c.x, B.z1, 1, true);
}

/** Resolve a static contact: normal n (pointing out of the wall), penetration, contact point. */
function wallHit(c, nx, nz, pen, px, pz, dmgK, remember) {
  c.x += nx * pen; c.z += nz * pen;
  if (remember) { c.wnx = nx; c.wnz = nz; c.wnT = 0.15; }
  const rpx = px - c.x; const rpz = pz - c.z;
  // contact point velocity = v + ω × rp, with ω × p = ω(−pz, px)
  const vpx = c.vx - c.r * rpz; const vpz = c.vz + c.r * rpx;
  const vn = vpx * nx + vpz * nz;
  if (vn >= 0) return;
  const rxn = rpx * nz - rpz * nx;
  // light scrapes don't bounce
  const e = -vn < 2 ? 0 : CAR.wallE;
  const j = (-(1 + e) * vn) / (1 + (rxn * rxn) / CAR.inertia);
  c.vx += j * nx; c.vz += j * nz;
  // spin from an off-centre hit, damped for glancing scrapes so a wall doesn't twist the car
  c.r += ((rpx * (j * nz) - rpz * (j * nx)) / CAR.inertia) * (-vn < 3 ? 0.35 : 1);
  // scrape: lose some of the speed along the wall (less when barely touching)
  const tx = -nz; const tz = nx; const vt = c.vx * tx + c.vz * tz;
  const fr = CAR.wallFric * Math.min(1, 0.25 + -vn / 6);
  c.vx -= tx * vt * fr; c.vz -= tz * vt * fr;
  // body: a hard hit jolts the suspension
  const fwd = nx * Math.sin(c.yaw) - nz * Math.cos(c.yaw); const rgt = nx * Math.cos(c.yaw) + nz * Math.sin(c.yaw);
  const k = Math.min(1, -vn / 15);
  c.pv -= fwd * 0.9 * k; c.rv -= rgt * 0.9 * k; c.hv += 0.4 * k;
  if (-vn > DAMAGE.wallFx && c.wallCD <= 0) {
    c.ev.push({ t: 'wall', dmg: Math.max(0, -vn - DAMAGE.wallMin) * DAMAGE.wallK * dmgK, x: px, z: pz, v: -vn });
    c.wallCD = 0.22;
  } else if (c.wallCD <= 0 && Math.abs(vt) > 4) { c.ev.push({ t: 'scrape', v: Math.abs(vt), x: px, z: pz }); c.wallCD = 0.3; }
}

/** Deepest overlap between car a and car b (poses: x, z, yaw; optional hl/hw for traffic).
 *  Returns pen > 0 or 0. out gets { pen, nx, nz (from b to a), px, pz (contact point), ia, ib
 *  (0 front, 1 middle, 2 rear third of each car) }. */
export function carContact(a, b, out) {
  const dx0 = a.x - b.x; const dz0 = a.z - b.z;
  if (dx0 * dx0 + dz0 * dz0 > 49) return 0;
  if (Math.abs((a.y || 0) - (b.y || 0)) > 2.5) return 0; // one is on a bridge deck above the other
  const A = carBox(A0, a); const Bx = carBox(B0, b);
  const pen = boxBox(A, Bx);
  out.pen = pen;
  if (pen <= 0) return 0;
  out.nx = SAT.nx; out.nz = SAT.nz; out.px = SAT.px; out.pz = SAT.pz;
  const third = (c, px, pz) => { const lz = (px - c.x) * Math.sin(c.yaw) - (pz - c.z) * Math.cos(c.yaw); const hl = c.hl || CAR.hl; return lz > hl / 3 ? 0 : lz < -hl / 3 ? 2 : 1; };
  out.ia = third(a, out.px, out.pz); out.ib = third(b, out.px, out.pz);
  return pen;
}

/** The two-body impulse for a contact (equal-ish masses): returns j (≥ 0, along n from b to a)
 *  and fills ct.vn (closing speed ≥ 0). Doesn't change either car. */
export function contactImpulse(a, b, ct, mA = 1, mB = 1, e = CAR.carE) {
  const rax = ct.px - a.x; const raz = ct.pz - a.z;
  const rbx = ct.px - b.x; const rbz = ct.pz - b.z;
  const vax = a.vx - (a.r || 0) * raz; const vaz = a.vz + (a.r || 0) * rax;
  const vbx = b.vx - (b.r || 0) * rbz; const vbz = b.vz + (b.r || 0) * rbx;
  const vn = (vax - vbx) * ct.nx + (vaz - vbz) * ct.nz;
  ct.vn = vn < 0 ? -vn : 0;
  if (vn >= 0) return 0;
  const rxn = rax * ct.nz - raz * ct.nx; const rbn = rbx * ct.nz - rbz * ct.nx;
  const ee = -vn < 1.5 ? 0 : e; // a gentle lean doesn't bounce
  return (-(1 + ee) * vn) / (1 / mA + 1 / mB + (rxn * rxn) / (CAR.inertia * mA) + (rbn * rbn) / (CAR.inertia * mB));
}

/** Apply impulse j along (nx, nz) at world point (px, pz) to car c (mass m). */
export function applyImpulse(c, j, nx, nz, px, pz, m = 1) {
  const rx = px - c.x; const rz = pz - c.z;
  c.vx += (j * nx) / m; c.vz += (j * nz) / m;
  c.r += (rx * (j * nz) - rz * (j * nx)) / (CAR.inertia * m) * 0.8;
  const fwd = nx * Math.sin(c.yaw) - nz * Math.cos(c.yaw); const rgt = nx * Math.cos(c.yaw) + nz * Math.sin(c.yaw);
  const k = Math.min(1, j / (12 * m));
  c.pv -= fwd * 0.8 * k; c.rv -= rgt * 1.0 * k; c.hv += 0.3 * k;
}

/** Contact on car `a` only (b is the other device's car as predicted, or traffic): pushes `a` out
 *  by `share` of the overlap and applies a's half of the two-body impulse. Returns the closing
 *  speed (≥ 0); ct.j holds the impulse. */
export function resolveCar(a, b, ct, mA = 1, mB = 1, share = 0.55) {
  const corr = Math.min(ct.pen * share, 0.35); // never pop a car more than 35 cm in one step
  a.x += ct.nx * corr; a.z += ct.nz * corr;
  const j = contactImpulse(a, b, ct, mA, mB);
  ct.j = j;
  if (j <= 0) return 0;
  applyImpulse(a, j, ct.nx, ct.nz, ct.px, ct.pz, mA);
  return ct.vn;
}

/** Both cars local (practice, split screen): separate and exchange the same impulse.
 *  Returns the closing speed. */
export function resolvePair(a, b, ct, mA = 1, mB = 1) {
  const tot = mA + mB; const corr = Math.min(ct.pen, 0.5);
  a.x += ct.nx * corr * (mB / tot); a.z += ct.nz * corr * (mB / tot);
  b.x -= ct.nx * corr * (mA / tot); b.z -= ct.nz * corr * (mA / tot);
  const j = contactImpulse(a, b, ct, mA, mB);
  ct.j = j;
  if (j <= 0) return 0;
  applyImpulse(a, j, ct.nx, ct.nz, ct.px, ct.pz, mA);
  applyImpulse(b, -j, ct.nx, ct.nz, ct.px, ct.pz, mB);
  return ct.vn;
}

/**
 * PIT check, from the victim's side (v = runner before the impulse, cop = the attacker).
 * A PIT is a push on the victim's rear quarter, from the side, by a car running roughly the same
 * way, at speed. Fills ct.pitTier (0 none, 1 nudge: a small twitch, 2 PIT: a spin-out),
 * ct.pitPush (m/s into the side). Returns the spin direction (±1) for a PIT, else 0.
 */
export function judgePit(v, cop, ct) {
  ct.pitTier = 0; ct.pitPush = 0;
  const vs = Math.hypot(v.vx, v.vz);
  if (vs < DAMAGE.pitMinSpeed) return 0;
  const vfx = Math.sin(v.yaw); const vfz = -Math.cos(v.yaw); const vrx = Math.cos(v.yaw); const vrz = Math.sin(v.yaw);
  const lx = (ct.px - v.x) * vrx + (ct.pz - v.z) * vrz;  // + = right side
  const lz = (ct.px - v.x) * vfx + (ct.pz - v.z) * vfz;  // + = front
  if (lz > DAMAGE.pitRearZ) return 0;                     // not on the rear part of the car
  let dh = cop.yaw - v.yaw; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
  if (Math.abs(dh) > DAMAGE.pitMaxAngle) return 0;        // T-bone or head-on
  const along = cop.vx * vfx + cop.vz * vfz;
  if (along < DAMAGE.pitCopSpeed) return 0;                // the cop must be moving with it, at speed
  // contact normal in the victim's frame: square from behind = a ram, from the side = a PIT
  const nl = Math.abs(ct.nx * vrx + ct.nz * vrz); const nf = Math.abs(ct.nx * vfx + ct.nz * vfz);
  const ang = Math.atan2(nl, nf);
  const side = lx >= 0 ? 1 : -1;
  const push = -((cop.vx - v.vx) * vrx + (cop.vz - v.vz) * vrz) * side; // cop moving into that side
  const w = Math.max(0, Math.min(1, (ang - DAMAGE.pitAngle0) / (DAMAGE.pitAngle1 - DAMAGE.pitAngle0)));
  const eff = push * w;
  ct.pitPush = eff;
  if (eff >= DAMAGE.pitPush) ct.pitTier = 2; else if (eff >= DAMAGE.nudgePush) ct.pitTier = 1;
  // pushing the rear sideways swings the nose the other way: rear pushed left (contact on the
  // right) → yaw increases (clockwise from above)
  return ct.pitTier === 2 ? side : 0;
}

/** Spin and damage scale for a PIT / nudge of strength push (m/s): { kick rad/s, spin s, dmg k }. */
export function pitEffect(push, tier, speed) {
  if (tier === 2) return { kick: Math.min(4.8, 1.6 + push * 0.32 + speed * 0.025), spin: 1.15, cut: 0.75, dmgK: Math.min(1.25, 0.55 + push / 14) };
  if (tier === 1) return { kick: 0.35 + push * 0.12, spin: 0.3, cut: 0, dmgK: 0.25 };
  return { kick: 0, spin: 0, cut: 0, dmgK: 0 };
}
