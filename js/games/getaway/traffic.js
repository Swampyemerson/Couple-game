// Getaway traffic: civilian cars driving the road lanes. Every car's position is a pure function
// of the shared round clock (lane, phase, speed come from a seeded PRNG keyed by the map), so both
// devices see the same traffic without sending anything. Cars on a lane share a speed, so they
// never run into each other. Open roads: a car enters at one end and leaves at the other (it
// grows / shrinks over the last few metres). Knocking one is local: it leaves the schedule and
// slides to a stop as a wreck, then returns to the schedule once nobody is looking.
import { TRAFFIC } from './tune.js';
import { mulberry, hashStr } from './geo.js';

export function createTraffic(geo, mapId, density) {
  const gap = TRAFFIC.gap[density] || 0;
  const lanes = [];
  const rnd = mulberry(hashStr('traffic:' + mapId));
  let total = 0;
  if (gap > 0) {
    for (const r of geo.roads) {
      if (!r.traffic || r.len < 40) continue;
      const lw = r.hw / r.lanes;
      const dirs = r.oneway ? [1] : [1, -1];
      for (const dir of dirs) {
        for (let k = 0; k < r.lanes; k++) {
          const base = TRAFFIC.speed[r.kind] || 11;
          const speed = base * (0.88 + rnd() * 0.24) * (k > 0 ? 1.08 : 1);
          const P = r.closed ? r.len : r.len + 24;
          const n = Math.max(r.closed ? 1 : 0, Math.floor(P / (gap * (0.8 + rnd() * 0.4))));
          if (!n) { rnd(); continue; }
          lanes.push({ r, dir, off: dir * (k + 0.5) * lw, speed, n, P, sp: P / n, phase: rnd() * P, first: total, x0: Math.min(...r.x) - 30, x1: Math.max(...r.x) + 30, z0: Math.min(...r.z) - 30, z1: Math.max(...r.z) + 30 });
          total += n;
        }
      }
    }
  }
  const knocked = new Map(); // car id → wreck state
  const tmp = { x: 0, z: 0, tx: 0, tz: 0, s: 0 };

  /** Scheduled pose of car `j` on lane L at time t (s). out: x z y yaw vx vz sc. */
  function poseOn(L, j, t, out) {
    const r = L.r;
    let u = (L.phase + j * L.sp + L.speed * t) % L.P; if (u < 0) u += L.P;
    let s; let sc = 1;
    if (r.closed) s = u;
    else { s = u - 12; if (s < 6) sc = Math.max(0, (s + 6) / 12); else if (s > r.len - 6) sc = Math.max(0, (r.len + 6 - s) / 12); }
    if (L.dir < 0) s = r.len - s;
    geo.sampleRoad(r, s, tmp);
    const tx = tmp.tx * L.dir; const tz = tmp.tz * L.dir;
    // right of the road tangent = (−tz, tx); off is measured that way
    out.x = tmp.x - tmp.tz * L.off; out.z = tmp.z + tmp.tx * L.off;
    out.yaw = Math.atan2(tx, -tz);
    out.vx = tx * L.speed; out.vz = tz * L.speed;
    out.y = r.bridge ? geo.deckY(r, tmp.s) : geo.ground(out.x, out.z);
    out.sc = sc;
    return out;
  }

  const P1 = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, sc: 1 };
  /** Visit every car within `rad` of (x, z) at time t: fn(id, pose) — pose is reused. */
  function each(x, z, rad, t, fn) {
    for (const L of lanes) {
      if (x < L.x0 - rad || x > L.x1 + rad || z < L.z0 - rad || z > L.z1 + rad) continue;
      for (let j = 0; j < L.n; j++) {
        const id = L.first + j;
        const k = knocked.get(id);
        if (k) {
          if (Math.abs(k.x - x) > rad || Math.abs(k.z - z) > rad) continue;
          P1.x = k.x; P1.z = k.z; P1.y = k.y; P1.yaw = k.yaw; P1.vx = k.vx; P1.vz = k.vz; P1.sc = 1;
          fn(id, P1, true);
          continue;
        }
        poseOn(L, j, t, P1);
        if (P1.sc <= 0.02 || Math.abs(P1.x - x) > rad || Math.abs(P1.z - z) > rad) continue;
        fn(id, P1, false);
      }
    }
  }

  function knock(id, pose, ivx, ivz, ir) {
    let k = knocked.get(id);
    if (!k) { k = { x: pose.x, z: pose.z, y: pose.y, yaw: pose.yaw, vx: pose.vx, vz: pose.vz, r: 0, t: 0 }; knocked.set(id, k); }
    k.vx += ivx; k.vz += ivz; k.r += ir; k.t = 0;
    return k;
  }
  /** Wrecks slide to a stop; after TRAFFIC.knockT s and out of every viewer's sight they rejoin. */
  function stepWrecks(dt, viewers) {
    for (const [id, k] of knocked) {
      k.t += dt;
      const sp = Math.hypot(k.vx, k.vz);
      if (sp > 0.01) { const d = Math.min(sp, 7 * dt); k.vx -= (k.vx / sp) * d; k.vz -= (k.vz / sp) * d; }
      k.x += k.vx * dt; k.z += k.vz * dt; k.yaw += k.r * dt; k.r *= Math.max(0, 1 - 2.2 * dt);
      k.y = geo.ground(k.x, k.z);
      if (k.t > TRAFFIC.knockT) {
        let far = true;
        for (const v of viewers) if (Math.hypot(v.x - k.x, v.z - k.z) < 160) far = false;
        if (far) knocked.delete(id);
      }
    }
  }

  /** Order-independent hash of every scheduled position at time t (determinism test). */
  function hash(t) {
    let h = 0;
    for (const L of lanes) for (let j = 0; j < L.n; j++) {
      poseOn(L, j, t, P1);
      h = (h + Math.round(P1.x * 100) * 31 + Math.round(P1.z * 100) * 17 + (L.first + j)) | 0;
    }
    return h >>> 0;
  }

  return {
    total, lanes, knocked, each, knock, stepWrecks, hash, poseOn,
    clearWrecks() { knocked.clear(); },
  };
}
