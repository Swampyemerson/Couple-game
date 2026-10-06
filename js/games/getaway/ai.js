// Getaway AI driver: plans on the geo nav grid (A*, roads cheapest, re-planned about once a
// second), follows the path with pure pursuit, slows for the corners ahead, handbrakes hairpins,
// reverses out when stuck. The cop closes in directly with line of sight and aims for the
// runner's rear quarter (PIT); the runner picks far-away road goals away from the cop.

const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

export function createDriver(geo, role, { skill = 1, seed = 1 } = {}) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const D = { path: null, idx: 0, replanT: 0, stuckT: 0, revT: 0, revSteer: 0, goalX: 0, goalZ: 0, goalT: 0, mode: 'path', spikeT: 6 + rnd() * 6 };
  const out = { steer: 0, gas: 0, brake: 0, hand: false, nitro: false };
  const nq = { road: -1 };

  function pickRunnerGoal(car, cop) {
    let best = null; let bestScore = -Infinity; const p = {};
    for (let k = 0; k < 10; k++) {
      geo.randomRoadPoint(rnd, p);
      const dc = cop ? Math.hypot(p.x - cop.x, p.z - cop.z) : 500;
      const dm = Math.hypot(p.x - car.x, p.z - car.z);
      // far from the cop, not too far from me, and not through the cop
      const toGoalX = p.x - car.x; const toGoalZ = p.z - car.z; const toCopX = cop ? cop.x - car.x : 0; const toCopZ = cop ? cop.z - car.z : 0;
      const towardCop = cop ? (toGoalX * toCopX + toGoalZ * toCopZ) / ((Math.hypot(toGoalX, toGoalZ) * Math.hypot(toCopX, toCopZ)) || 1) : 0;
      const score = dc - Math.abs(dm - 450) * 0.5 - towardCop * 300;
      if (score > bestScore) { bestScore = score; best = { x: p.x, z: p.z }; }
    }
    return best;
  }

  function steerTo(car, tx, tz) {
    const desired = Math.atan2(tx - car.x, -(tz - car.z));
    return wrap(desired - car.yaw);
  }

  /** Path look-ahead: target point and the sharpest turn within `span` metres. */
  function follow(car, span) {
    const P = D.path; const n = P.length / 2;
    // advance along the path while the next node is nearer
    while (D.idx < n - 1) {
      const d0 = Math.hypot(P[D.idx * 2] - car.x, P[D.idx * 2 + 1] - car.z);
      const d1 = Math.hypot(P[D.idx * 2 + 2] - car.x, P[D.idx * 2 + 3] - car.z);
      if (d1 <= d0 + 2) D.idx++; else break;
    }
    const look = 7 + car.speed * 0.55;
    let acc = 0; let i = D.idx; let tx = P[i * 2]; let tz = P[i * 2 + 1];
    let px = car.x; let pz = car.z;
    while (i < n) { const d = Math.hypot(P[i * 2] - px, P[i * 2 + 1] - pz); if (acc + d >= look) { const k = (look - acc) / (d || 1); tx = px + (P[i * 2] - px) * k; tz = pz + (P[i * 2 + 1] - pz) * k; break; } acc += d; px = P[i * 2]; pz = P[i * 2 + 1]; tx = px; tz = pz; i++; }
    // sharpest heading change ahead
    let turn = 0; let dist = 0; let h0 = null;
    for (let j = D.idx; j < n - 1 && dist < span; j++) {
      const hx = P[j * 2 + 2] - P[j * 2]; const hz = P[j * 2 + 3] - P[j * 2 + 1];
      const h = Math.atan2(hx, -hz);
      if (h0 === null) h0 = h; else turn = Math.max(turn, Math.abs(wrap(h - h0)));
      dist += Math.hypot(hx, hz);
    }
    return { tx, tz, turn, end: D.idx >= n - 2 };
  }

  function update(dt, car, other, opts = {}) {
    out.hand = false; out.nitro = false;
    if (D.revT > 0) { D.revT -= dt; out.gas = 0; out.brake = 1; out.steer = D.revSteer; return out; }
    const dx = other ? other.x - car.x : 0; const dz = other ? other.z - car.z : 0; const dist = Math.hypot(dx, dz);
    const los = other && dist < 70 && (opts.los ?? geo.lineOfSight(car.x, car.z, car.y, other.x, other.z, other.y));
    D.replanT -= dt; D.goalT -= dt;
    let tx; let tz; let turn = 0; let direct = false;
    if (role === 'cop' && other && los && dist < 60) {
      // direct pursuit: lead the target; when close, aim at its rear quarter for a PIT
      direct = true;
      const lead = Math.min(1.1, dist / 22);
      tx = other.x + other.vx * lead; tz = other.z + other.vz * lead;
      if (dist < 16) {
        const ofx = Math.sin(other.yaw); const ofz = -Math.cos(other.yaw); const orx = Math.cos(other.yaw); const orz = Math.sin(other.yaw);
        const side = ((car.x - other.x) * orx + (car.z - other.z) * orz) >= 0 ? 1 : -1;
        tx = other.x - ofx * 1.4 + orx * side * 0.6 + other.vx * 0.25; tz = other.z - ofz * 1.4 + orz * side * 0.6 + other.vz * 0.25;
      }
    } else {
      if (role === 'cop' && other) {
        if (D.replanT <= 0 || !D.path) { D.path = geo.findPath(car.x, car.z, other.x + other.vx * 1.5, other.z + other.vz * 1.5); D.idx = 0; D.replanT = 0.9 + rnd() * 0.3; }
      } else if (role === 'runner') {
        if (!D.path || D.goalT <= 0 || (D.path && follow(car, 10).end) || (other && dist < 35 && D.replanT <= 0)) {
          const g = pickRunnerGoal(car, other);
          if (g) { D.goalX = g.x; D.goalZ = g.z; D.path = geo.findPath(car.x, car.z, g.x, g.z); D.idx = 0; }
          D.goalT = 9 + rnd() * 5; D.replanT = 2.5;
        }
      }
      if (D.path && D.path.length >= 4) { const f = follow(car, 22 + car.speed * 1.1); tx = f.tx; tz = f.tz; turn = f.turn; }
      else if (other) { tx = role === 'cop' ? other.x : car.x - dx; tz = role === 'cop' ? other.z : car.z - dz; }
      else { tx = car.x + Math.sin(car.yaw) * 20; tz = car.z - Math.cos(car.yaw) * 20; }
    }
    const err = steerTo(car, tx, tz);
    out.steer = Math.max(-1, Math.min(1, err * 2.4));
    const vMax = (role === 'cop' ? 44 : 43) * skill;
    let vT = Math.max(9, vMax - turn * 26);
    if (Math.abs(err) > 0.6) vT = Math.min(vT, 14);
    if (direct && dist < 10) vT = Math.max(vT, (other.speed || 0) + 4);
    out.gas = car.vf < vT ? 1 : 0;
    out.brake = car.vf > vT + 5 ? 1 : 0;
    if (Math.abs(err) > 1.25 && car.speed > 13) out.hand = true;
    if (Math.abs(err) < 0.18 && car.speed > 18 && turn < 0.3 && (role === 'runner' || dist > 50)) out.nitro = car.nitro > 0.25;
    // stuck → reverse out
    if (out.gas > 0 && car.speed < 1.2) { D.stuckT += dt; if (D.stuckT > 1.1) { D.revT = 1.0; D.revSteer = -Math.sign(err || 1); D.stuckT = 0; D.replanT = 0; } }
    else D.stuckT = Math.max(0, D.stuckT - dt);
    // spike strips (the game validates and places them)
    D.spikeT -= dt;
    out.spike = false;
    if (role === 'cop' && other && D.spikeT <= 0 && dist > 110 && dist < 380) { out.spike = true; D.spikeT = 14 + rnd() * 10; }
    return out;
  }
  return { update, out, state: D, reset() { D.path = null; D.idx = 0; D.replanT = 0; D.goalT = 0; D.revT = 0; D.stuckT = 0; } };
}
