// Getaway traffic: civilian cars on the road lanes, the same on both devices without sending
// anything. Lanes, phases and speeds come from a PRNG seeded by the map id. Before the shared
// round clock reaches EPOCH, a car's position is a pure function of time (free flow). From EPOCH
// on, every lane is a small fixed-step simulation (0.25 s, intelligent-driver car following:
// nobody runs into the car ahead) with **signalled junctions**: where two through roads cross,
// a deterministic signal cycle (green / amber / all-red per road, from the junction id) stops one
// road's cars at the stop line while the other goes, so crossing traffic never meets in the
// box. The simulation uses only + − × ÷ and sqrt on doubles (bit-identical on every JS engine),
// so its state at step k is a pure function of k; it advances with the clock and rewinds from
// snapshots when the clock jumps back (a new round).
//
// Open roads: a car appears (grows over 6 m) just past the junction box at a road's start and
// disappears before the box at its end, then drives a hidden stretch back to the start. While
// growing or shrinking (sc < 0.95) it doesn't collide. Knocked cars leave the lane as wrecks
// (synced by the game) and rejoin once nobody is near (a stopped wreck fades out after a while,
// a rejoining car grows back in).
//
// API: each(x, z, rad, t, fn(id, pose, wreck)) · select(viewers, t, max, rad, out) (nearest first,
// for drawing) · poseOf(id, t, out) · knock / setWreck / stepWrecks · signalState(jid, road, t)
// · setClear(zones) (spawn points kept clear at a round start)
// · junctions · dims(id) · hash(t). pose: { x z y yaw vx vz sc hl hw speed id }.
import { TRAFFIC } from './tune.js';
import { mulberry, hashStr } from './geo.js';

export const EPOCH = 570;        // s of shared round time where the lane simulation starts
export const SIM_DT = 0.25;      // s per simulation step
const GROW = 6;                   // m over which a car grows in / shrinks out at a road end
const HIDE = 24;                  // m of hidden lane between a road's end and its start
const CAR_L = 4.6;
// car following (IDM): headway, standstill gap, max accel, comfortable decel
const IDM_T = 1.25; const IDM_S0 = 2.6; const IDM_A = 1.7; const IDM_B = 2.6; const IDM_2AB = 2 * Math.sqrt(IDM_A * IDM_B);
// signals (in simulation steps of 0.25 s)
const AMBER = 10; const ALLRED = 8;

/** Length / width / height scale of traffic car `id` (the instanced mesh draws with the same). */
export function trafficDims(id, out) {
  const v = (id * 2654435761) >>> 0;
  out.sl = 0.92 + ((v >>> 8) % 100) / 400;
  out.sh = 0.95 + ((v >>> 16) % 20) / 100;
  out.hl = 2.23 * out.sl; out.hw = 0.95;
  out.color = v;
  return out;
}

export function createTraffic(geo, mapId, density) {
  const gap = TRAFFIC.gap[density] || 0;
  const lanes = [];
  const rnd = mulberry(hashStr('traffic:' + mapId));
  let total = 0;
  const G = gap > 0 && geo.roadGraph ? geo.roadGraph() : null;
  // ── junction signals: only where two or more through roads cross ──
  const sig = []; // per junction: null or { cyc, off, ph: Map(road → [g0, g1, a1]) }
  if (G) {
    for (const J of G.junctions) {
      const thru = [];
      for (const a of J.arms) if (!a.end && !thru.includes(a.road)) thru.push(a.road);
      if (thru.length < 2) { sig.push(null); continue; }
      thru.sort((p, q) => (geo.roads[q].rank - geo.roads[p].rank) || (p - q));
      let t = 0; const ph = new Map();
      for (const ri of thru) {
        const g = Math.round((5 + 1.5 * geo.roads[ri].rank) / SIM_DT); // short cycles: it's a chase
        ph.set(ri, [t, t + g, t + g + AMBER]);
        t += g + AMBER + ALLRED;
      }
      const h = hashStr('sig:' + mapId + ':' + J.id);
      sig.push({ cyc: t, off: h % t, ph, x: J.x, z: J.z, r: J.r });
    }
  }
  /** 0 green, 1 amber, 2 red for road ri at junction ji at simulation step k. */
  function sigAt(ji, ri, k) {
    const S = sig[ji]; if (!S) return 0;
    const p = S.ph.get(ri); if (!p) return 0;
    let m = (k + S.off) % S.cyc; if (m < 0) m += S.cyc;
    return m >= p[0] && m < p[1] ? 0 : m >= p[1] && m < p[2] ? 1 : 2;
  }
  // junction boxes along each road: [lane-independent arc s of the centre, box radius, junction]
  const boxesOn = new Map();
  if (G) {
    const ta = { x: 0, z: 0, tx: 0, tz: 0, s: 0 }; const tb = { x: 0, z: 0, tx: 0, tz: 0, s: 0 };
    for (const J of G.junctions) {
      for (const a of J.arms) {
        // how far along this road the other roads' asphalt reaches (crossing at a shallow angle
        // takes longer to clear than a square one)
        const ra = geo.roads[a.road]; geo.sampleRoad(ra, a.s, ta);
        let clr = ra.hw + 1.5;
        for (const b of J.arms) {
          if (b.road === a.road) continue;
          const rb = geo.roads[b.road]; geo.sampleRoad(rb, b.s, tb);
          const sin = Math.abs(ta.tx * tb.tz - ta.tz * tb.tx);
          const off = Math.hypot(ta.x - J.x, ta.z - J.z);
          clr = Math.max(clr, Math.min(40, (rb.hw + 1.6) / Math.max(0.3, sin) + off));
        }
        let l = boxesOn.get(a.road); if (!l) { l = []; boxesOn.set(a.road, l); }
        l.push({ s: a.s, r: clr, ji: J.id, end: a.end });
      }
    }
  }
  if (gap > 0) {
    for (const r of geo.roads) {
      if (!r.traffic || r.len < 40) continue;
      const lw = (r.hw - (r.park || 0)) / r.lanes; // (lanes clear of any kerbside parking strip)
      const dirs = r.oneway ? [1] : [1, -1];
      const boxes = boxesOn.get(r.idx) || [];
      for (const dir of dirs) {
        // lane distance runs with the direction of travel; the visible part starts after any
        // junction box at the start and ends before any box at the end (no car ever pops in or
        // out inside a junction)
        const bx = boxes.map((b) => ({ sl: dir > 0 ? b.s : r.len - b.s, r: b.r, ji: b.ji, end: b.end })).sort((p, q) => p.sl - q.sl);
        let sA = 0; let sB = r.len;
        if (!r.closed) {
          for (const b of bx) if (b.sl - b.r < sA + 6) sA = Math.max(sA, b.sl + b.r + 0.5);
          for (let q = bx.length - 1; q >= 0; q--) { const b = bx[q]; if (b.sl + b.r > sB - 6) sB = Math.min(sB, b.sl - b.r - 0.5); }
        }
        if (!r.closed && sB - sA < 20) continue;
        const span = r.closed ? r.len : sB - sA + 2 * GROW;
        for (let k = 0; k < r.lanes; k++) {
          const base = TRAFFIC.speed[r.kind] || 11;
          const speed = base * (0.88 + rnd() * 0.24) * (k > 0 ? 1.08 : 1);
          const P = r.closed ? r.len : span + HIDE;
          const n = Math.max(r.closed ? 1 : 0, Math.floor(P / (gap * (0.8 + rnd() * 0.4))));
          if (!n) { rnd(); continue; }
          const L = { r, dir, k, off: dir * (k + 0.5) * lw, speed, n, P, sp: P / n, phase: rnd() * P, first: total, sA, span, stops: [],
            x0: Math.min(...r.x) - 30, x1: Math.max(...r.x) + 30, z0: Math.min(...r.z) - 30, z1: Math.max(...r.z) + 30 };
          // stop lines (the car's front stops there) for every junction box the lane drives through
          for (const b of bx) {
            if (b.end && !r.closed) continue;
            let u = r.closed ? b.sl - b.r : b.sl - b.r - (sA - GROW);
            if (r.closed) { if (u < 0) u += r.len; } else if (u < GROW || u > span - GROW) continue;
            if (!L.stops.some((q) => Math.abs(q.u - u) < 3)) L.stops.push({ u, ji: b.ji, ri: r.idx, box: 2 * b.r });
          }
          L.stops.sort((p, q) => p.u - q.u);
          lanes.push(L);
          total += n;
        }
      }
    }
  }
  const N = total;
  const COARSE = 25; // m between coarse samples of each lane (each() rejects a car by its table cell before posing it)
  // ── simulation state (all lanes in two flat arrays) ──
  const pos = new Float64Array(N); const vel = new Float64Array(N);
  const pos0 = new Float64Array(N); const vel0 = new Float64Array(N); // the previous step (interpolation)
  const npos = new Float64Array(N); const nvel = new Float64Array(N);
  let simK = -1; // the step pos/vel hold; −1 = not started
  const snaps = []; // { k, pos, vel }
  const freeU = (L, j, t) => { let u = (L.phase + j * L.sp + L.speed * t) % L.P; if (u < 0) u += L.P; return u; };
  function resetSim() {
    for (const L of lanes) for (let j = 0; j < L.n; j++) { const i = L.first + j; pos[i] = freeU(L, j, EPOCH); vel[i] = L.speed * 0.95; }
    pos0.set(pos); vel0.set(vel); simK = 0;
  }
  function stepSim() {
    const k = simK + 1;
    for (const L of lanes) {
      const P = L.P; const n = L.n; const v0 = L.speed; const f0 = L.first; const stops = L.stops; const ri = L.r.idx;
      for (let j = 0; j < n; j++) {
        const i = f0 + j; const u = pos[i]; const v = vel[i];
        let acc;
        { const ld = f0 + ((j + 1) % n);
          let g = n === 1 ? P : pos[ld] - u; if (g <= 0) g += P;
          const net = Math.max(0.1, g - CAR_L);
          const dv = v - (n === 1 ? v : vel[ld]);
          const ss = IDM_S0 + Math.max(0, v * IDM_T + (v * dv) / IDM_2AB);
          const q = v / v0; const q2 = q * q;
          const sr = ss / net;
          acc = IDM_A * (1 - q2 * q2 - sr * sr);
        }
        // the next stop line, if the light isn't green
        if (stops.length && (L.r.closed || u < L.span)) {
          // the first stop line ahead of the car's centre − half a length (binary search)
          let lo = 0; let hi = stops.length; const ul = u - CAR_L * 0.5;
          while (lo < hi) { const m = (lo + hi) >> 1; if (stops[m].u > ul) hi = m; else lo = m + 1; }
          let st = null; let du = Infinity;
          if (lo < stops.length) { st = stops[lo]; du = st.u - u; } else if (L.r.closed) { st = stops[0]; du = st.u + P - u; }
          if (st && du < 90) {
            let lt = sigAt(st.ji, ri, k);
            // don't block the box: wait at the line while the car ahead is stuck just past it
            if (lt === 0 && n > 1) { const ld = f0 + ((j + 1) % n); let lu = pos[ld] - st.u; if (lu < -CAR_L) lu += P; if (lu < st.box + CAR_L && vel[ld] < 4) lt = 2; }
            if (lt !== 0) {
              const dist = du - CAR_L * 0.5;
              const need = (v * v) / (2 * Math.max(0.3, dist));
              // amber: stop if it's comfortable; red: stop unless it's already too late
              if (dist > -0.5 && (lt === 2 ? need < 7 : need < 3.2)) {
                const ss = 1.0 + v * IDM_T + (v * v) / IDM_2AB;
                const sr = ss / Math.max(0.2, dist);
                const q = v / v0; const q2 = q * q;
                const a2 = IDM_A * (1 - q2 * q2 - sr * sr);
                if (a2 < acc) acc = a2;
              }
            }
          }
        }
        if (acc < -9) acc = -9;
        let nv = v + acc * SIM_DT; let du2;
        if (nv < 0) { du2 = acc < 0 ? (v * v) / (-2 * acc) : 0; nv = 0; } else du2 = v * SIM_DT + 0.5 * acc * SIM_DT * SIM_DT;
        if (du2 < 0) du2 = 0;
        npos[i] = u + du2; nvel[i] = nv;
      }
      // never closer than a car length to the car ahead (the ring order never changes)
      if (n > 1) {
        for (let j = 0; j < n; j++) {
          const i = f0 + j; const ld = f0 + ((j + 1) % n);
          let g = (npos[ld] - npos[i]) % P; if (g < 0) g += P;
          if (g < CAR_L + 0.4) { npos[i] -= CAR_L + 0.4 - g; if (nvel[i] > nvel[ld]) nvel[i] = nvel[ld]; }
        }
      }
      for (let j = 0; j < n; j++) { const i = f0 + j; let u = npos[i]; if (u >= P) u -= P; else if (u < 0) u += P; npos[i] = u; }
    }
    pos0.set(pos); vel0.set(vel); pos.set(npos); vel.set(nvel);
    simK = k;
    if (k % 24 === 0) {
      snaps.push({ k, pos: pos.slice(), vel: vel.slice(), pos0: pos0.slice(), vel0: vel0.slice() });
      if (snaps.length > 60) snaps.splice(2, 1); // keep the first two (round start) and the latest
    }
  }
  const MAX_K = Math.round(3600 / SIM_DT);
  /** Bring the simulation to the step just after time t (if t is in the simulated range). */
  function ensure(t) {
    if (!(t >= EPOCH) || t > EPOCH + 3600 || !N) return false;
    const K = Math.min(MAX_K, Math.floor((t - EPOCH) / SIM_DT) + 1);
    if (simK < 0) resetSim();
    if (K < simK - 1) { // rewind: the newest snapshot at or before K (a step back is just interpolation)
      let best = null; for (const s of snaps) if (s.k <= K && (!best || s.k > best.k)) best = s;
      if (best) { pos.set(best.pos); vel.set(best.vel); pos0.set(best.pos0); vel0.set(best.vel0); simK = best.k; } else resetSim();
    }
    let guard = 0;
    while (simK < K && guard++ < 20000) stepSim();
    return true;
  }

  /** Advance the simulation towards time t for about ms milliseconds (loaders and idle frames
   *  call this so the first chase frame doesn't simulate half a minute at once). True when there. */
  function warm(t, ms = 4) {
    if (!N || !(t >= EPOCH)) return true;
    const K = Math.min(MAX_K, Math.floor((t - EPOCH) / SIM_DT) + 1);
    if (simK < 0) resetSim();
    if (simK >= K) return true;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    while (simK < K && now() - t0 < ms) stepSim();
    return simK >= K;
  }

  const knocked = new Map(); // car id → wreck state
  const tmp = { x: 0, z: 0, tx: 0, tz: 0, s: 0 };
  const dimT = { sl: 1, sh: 1, hl: 2.3, hw: 0.95, color: 0 };
  // per lane: a coarse table of where lane coordinate u lies (NaN on the hidden stretch), the
  // reject margin, and the point where its cars grow in (held while a player sits on it)
  { const o = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, sc: 0, speed: 0 };
    for (const L of lanes) {
      const n = Math.ceil(L.P / COARSE) + 1; L.cx = new Float64Array(n); L.cz = new Float64Array(n);
      for (let k = 0; k < n; k++) { const u = Math.min(L.P - 1e-6, k * COARSE); place(L, u, 0, o, 0); if (L.r.closed || u < L.span) { L.cx[k] = o.x; L.cz[k] = o.z; } else { L.cx[k] = NaN; L.cz[k] = NaN; } }
      L.cm = COARSE + L.r.hw + 4;
      place(L, L.r.closed ? 0 : GROW * 0.5, 0, o, 0); L.gx = o.x; L.gz = o.z; L.held = 0;
    } }

  /** World pose of lane L's car at lane coordinate u (speed v) into out. */
  function place(L, u, v, out, side) {
    const r = L.r;
    let sc = 1; let s;
    if (r.closed) s = u;
    else {
      if (u >= L.span) { out.sc = 0; return out; }
      s = L.sA - GROW + u;
      if (u < GROW) sc = u / GROW; else if (u > L.span - GROW) sc = (L.span - u) / GROW;
    }
    if (L.dir < 0) s = r.len - s;
    // past an open road's end: carry on along the end tangent (no frozen cars at the ends)
    let ex = 0;
    if (!r.closed) { if (s < 0) { ex = s; s = 0; } else if (s > r.len) { ex = s - r.len; s = r.len; } }
    geo.sampleRoad(r, s, tmp);
    const px = tmp.x + tmp.tx * ex; const pz = tmp.z + tmp.tz * ex;
    const tx = tmp.tx * L.dir; const tz = tmp.tz * L.dir;
    // right of the road tangent = (−tz, tx); off is measured that way
    const off = L.off + (side || 0) * L.dir;
    out.x = px - tmp.tz * off; out.z = pz + tmp.tx * off;
    out.yaw = Math.atan2(tx, -tz);
    out.vx = tx * v; out.vz = tz * v; out.speed = v;
    out.y = r.bridge ? geo.deckY(r, Math.max(0, Math.min(r.len, tmp.s))) : geo.ground(out.x, out.z);
    out.sc = sc;
    return out;
  }
  // Local yielding: a car whose lane is blocked by a player car or a wreck slows and waits
  // behind it (lag = metres behind its schedule), then catches up at +5 m/s once clear. This is
  // per device (the players' cars aren't part of the shared schedule) and only ever near them.
  const lag = new Map(); // id → { m, v (effective speed) }
  /** Scheduled pose of car j on lane L at time t. */
  const UV = { u: 0, v: 0, sched: 0, side: 0 };
  /** Lane coordinate and speed of car j on lane L at time t (with its local yielding lag) into UV. */
  function uOf(L, j, t, sim, pure) {
    const id = L.first + j;
    let u; let v;
    if (!sim) { u = freeU(L, j, t); v = L.speed; } else {
      const f = Math.max(0, Math.min(1, (t - EPOCH) / SIM_DT - (simK - 1)));
      const a = pos0[id]; let b = pos[id]; if (b < a - L.P * 0.5) b += L.P;
      u = a + (b - a) * f; if (u >= L.P) u -= L.P;
      v = vel0[id] + (vel[id] - vel0[id]) * f;
    }
    UV.sched = v; UV.side = 0;
    const lg = lag.size && !pure ? lag.get(id) : null;
    if (lg) { u -= lg.m; if (u < 0) u += L.P; v = lg.v; UV.side = lg.side; }
    UV.u = u; UV.v = v;
    return UV;
  }
  function poseOn(L, j, t, out, sim, pure) {
    const id = L.first + j;
    trafficDims(id, dimT); out.hl = dimT.hl; out.hw = dimT.hw; out.id = id;
    const q = uOf(L, j, t, sim, pure);
    out.sched = q.sched;
    return place(L, q.u, q.v, out, q.side);
  }
  /** Once per frame: cars with a player car or wreck right ahead in their lane hold back, and
   *  cars near a siren pull over to the right and slow down until it has gone by.
   *  obstacles: [{x, z, yaw, siren}] (the players' cars); wrecks are added here. */
  function yieldTo(dt, t, obstacles) {
    if (!N || dt <= 0) return;
    const obs = yObs; obs.length = 0;
    // (a siren only clears the way while the cop is on the move: cars stopping for a cop that is
    // itself waiting or boxed in would close the box round it)
    for (const o of obstacles) obs.push(o.x, o.z, o.siren && !(o.speed < 4) ? 1 : 0, o.yaw || 0);
    for (const k of knocked.values()) obs.push(k.x, k.z, 0, 0);
    const touched = yTouched; touched.clear();
    // a lane whose grow-in point has a player car on it holds its next cars on the hidden
    // stretch (they used to materialise inside a car waiting just past a junction and shove it)
    for (const L of lanes) {
      if (L.r.closed) continue;
      let near = false;
      for (let q = 0; q < obstacles.length && !near; q++) { const o = obstacles[q]; const dx = o.x - L.gx; const dz = o.z - L.gz; if (dx * dx + dz * dz < HOLD_R * HOLD_R) near = true; }
      if (!near) { L.held = 0; continue; }
      L.held += dt;
      const sim = ensure(t);
      for (let j = 0; j < L.n; j++) {
        const id = L.first + j; if (knocked.has(id)) continue;
        const q = uOf(L, j, t, sim, false);
        if (q.u < GROW + 1.5 || q.u > L.P - 2) { // about to grow in (or growing): hold it there
          let lg = lag.get(id); if (!lg) { lg = { m: 0, v: 0, side: 0 }; lag.set(id, lg); }
          lg.m += q.sched * dt; lg.v = 0; touched.add(id);
        }
      }
    }
    for (let q = 0; q < obs.length; q += 4) {
      const ox = obs[q]; const oz = obs[q + 1];
      each(ox, oz, obs[q + 2] ? 60 : 45, t, (id, p, wreck) => {
        if (wreck || touched.has(id)) return;
        const fx = Math.sin(p.yaw); const fz = -Math.cos(p.yaw);
        let need = Infinity; let pull = 0; let sirenNear = Infinity;
        for (let r = 0; r < obs.length; r += 4) {
          const dx = obs[r] - p.x; const dz = obs[r + 1] - p.z;
          const lz = dx * fx + dz * fz; const lx = dx * -fz + dz * fx;
          if (lz > 0.5 && lz < 32 && Math.abs(lx) < 2.3) need = Math.min(need, lz);
          // a siren within 55 m behind (or coming the other way, ahead): make room
          if (obs[r + 2] && Math.abs(lx) < 9 && lz < 40 && lz > -55) { pull = 1; sirenNear = Math.min(sirenNear, Math.hypot(dx, dz)); }
        }
        if (need === Infinity && !pull) return;
        touched.add(id);
        let lg = lag.get(id); if (!lg) { lg = { m: 0, v: p.sched, side: 0 }; lag.set(id, lg); }
        // held up for a while by something that isn't moving: squeeze past it on the right
        lg.held = need < 12 && lg.v < 0.6 ? (lg.held || 0) + dt : Math.max(0, (lg.held || 0) - dt);
        const sideT = pull ? 2.7 : lg.held > 3 ? 3.4 : 0;
        if (lg.held > 3 && Math.abs(lg.side - 3.4) > 0.5) need = Math.max(need, 9);
        lg.side += Math.max(-1.6 * dt, Math.min(1.6 * dt, sideT - lg.side));
        // brake to stop ~6.5 m (centre to centre) behind an obstacle; crawl while pulled over
        const room = need - 6.5;
        let vAllow = need === Infinity ? Infinity : Math.sqrt(Math.max(0, 2 * 5 * Math.max(0, room)));
        if (pull) vAllow = Math.min(vAllow, sirenNear < 22 ? 0 : p.sched * 0.3); // the siren right behind: stop and let it by
        const vEff = Math.max(0, Math.min(p.sched, vAllow, lg.v + 3 * dt));
        lg.m = Math.max(0, lg.m + (p.sched - vEff) * dt); lg.v = vEff;
      });
    }
    // the rest ease back into the lane and catch up with their schedule
    for (const [id, lg] of lag) {
      if (touched.has(id)) continue;
      const sp = Math.min(5, lg.m / Math.max(dt, 1e-3));
      lg.m -= sp * dt; lg.v = Math.min(lg.v + 4 * dt, 25);
      lg.side -= Math.min(lg.side, 1.0 * dt); lg.held = 0;
      if (lg.m <= 0.01 && lg.side <= 0.01) lag.delete(id); else if (lg.m < 0) lg.m = 0;
    }
  }
  const yObs = []; const yTouched = new Set(); const HOLD_R = 14;

  const P1 = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, sc: 1, hl: 2.3, hw: 0.95, speed: 0, id: 0, sched: 0 };
  /** Visit every car within `rad` of (x, z) at time t: fn(id, pose, wreck) — pose is reused. */
  function each(x, z, rad, t, fn, pure) {
    const sim = ensure(t);
    for (const L of lanes) {
      if (x < L.x0 - rad || x > L.x1 + rad || z < L.z0 - rad || z > L.z1 + rad) continue;
      for (let j = 0; j < L.n; j++) {
        const id = L.first + j;
        const k = knocked.get(id);
        if (k) {
          if (Math.abs(k.x - x) > rad || Math.abs(k.z - z) > rad) continue;
          trafficDims(id, dimT);
          P1.x = k.x; P1.z = k.z; P1.y = k.y; P1.yaw = k.yaw; P1.vx = k.vx; P1.vz = k.vz; P1.sc = k.fade < 1 ? Math.max(0.03, k.fade) : 1; P1.hl = dimT.hl; P1.hw = dimT.hw; P1.speed = Math.hypot(k.vx, k.vz); P1.id = id;
          fn(id, P1, true);
          continue;
        }
        // cheap reject by the lane's coarse table (a long arterial no longer poses all its cars)
        const q = uOf(L, j, t, sim, pure);
        const ci = (q.u / COARSE) | 0; const cx = L.cx[ci];
        if (cx !== cx || Math.abs(cx - x) > rad + L.cm || Math.abs(L.cz[ci] - z) > rad + L.cm) continue;
        trafficDims(id, dimT); P1.hl = dimT.hl; P1.hw = dimT.hw; P1.id = id; P1.sched = q.sched;
        place(L, q.u, q.v, P1, q.side);
        if (regrow.size && !pure) { const g = regrow.get(id); if (g !== undefined) P1.sc *= g; }
        if (clrZ.length && !pure) P1.sc *= clearK(P1.x, P1.z, t);
        if (P1.sc <= 0.02 || Math.abs(P1.x - x) > rad || Math.abs(P1.z - z) > rad) continue;
        fn(id, P1, false);
      }
    }
  }
  const laneOf = (id) => { let lo = 0; let hi = lanes.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lanes[m].first <= id) lo = m; else hi = m - 1; } return lanes[lo]; };
  /** Pose of car id at time t (a wreck where it lies). Returns out, or null for a bad id. */
  function poseOf(id, t, out) {
    if (id < 0 || id >= N) return null;
    const k = knocked.get(id);
    if (k) { trafficDims(id, dimT); out.x = k.x; out.z = k.z; out.y = k.y; out.yaw = k.yaw; out.vx = k.vx; out.vz = k.vz; out.sc = 1; out.hl = dimT.hl; out.hw = dimT.hw; out.speed = Math.hypot(k.vx, k.vz); out.id = id; out.wreck = true; return out; }
    const L = laneOf(id); out.wreck = false;
    poseOn(L, id - L.first, t, out, ensure(t));
    if (regrow.size) { const g = regrow.get(id); if (g !== undefined) out.sc *= g; }
    if (clrZ.length) out.sc *= clearK(out.x, out.z, t);
    return out;
  }
  /** The `max` cars nearest any viewer within rad, nearest first (for drawing). out: array of
   *  pose objects (grown as needed). Returns the count. */
  const selD = []; const selPool = [];
  function select(viewers, t, max, rad, out) {
    selD.length = 0;
    let n = 0;
    const vx0 = viewers[0]; const vx1 = viewers[1] || viewers[0];
    const cx = (vx0.x + vx1.x) / 2; const cz = (vx0.z + vx1.z) / 2; const R = rad + Math.hypot(vx0.x - vx1.x, vx0.z - vx1.z) / 2;
    each(cx, cz, R, t, (id, p) => {
      let d = Infinity;
      for (const v of viewers) { const q = (p.x - v.x) * (p.x - v.x) + (p.z - v.z) * (p.z - v.z); if (q < d) d = q; }
      if (d > rad * rad) return;
      let o = selPool[n]; if (!o) { o = {}; selPool[n] = o; }
      o.x = p.x; o.z = p.z; o.y = p.y; o.yaw = p.yaw; o.vx = p.vx; o.vz = p.vz; o.sc = p.sc; o.hl = p.hl; o.hw = p.hw; o.id = id; o.d = d; o.speed = p.speed;
      selD.push(o); n++;
    });
    selD.sort((a, b) => a.d - b.d);
    const m = Math.min(max, selD.length);
    out.length = m;
    for (let i = 0; i < m; i++) out[i] = selD[i];
    return m;
  }

  function knock(id, pose, ivx, ivz, ir) {
    let k = knocked.get(id);
    if (!k) { k = { x: pose.x, z: pose.z, y: pose.y, yaw: pose.yaw, vx: pose.vx, vz: pose.vz, r: 0, t: 0, fade: 1 }; knocked.set(id, k); }
    k.vx += ivx; k.vz += ivz; k.r += ir; k.t = 0; k.fade = 1;
    return k;
  }
  /** A wreck state from the other device (it hit the car): adopt it. */
  function setWreck(id, s) {
    if (!(id >= 0 && id < N) || !s) return;
    let k = knocked.get(id);
    if (!k) { k = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0, t: 0, fade: 1 }; knocked.set(id, k); }
    k.fade = 1; k.x = +s.x || 0; k.z = +s.z || 0; k.yaw = +s.yaw || 0; k.vx = +s.vx || 0; k.vz = +s.vz || 0; k.r = +s.r || 0; k.t = 0;
    k.y = geo.ground(k.x, k.z);
  }
  /** Wrecks slide to a stop against the world; after TRAFFIC.knockT s and out of every viewer's
   *  sight they rejoin. */
  function stepWrecks(dt, viewers) {
    for (const [id, k] of knocked) {
      k.t += dt;
      const sp = Math.hypot(k.vx, k.vz);
      if (sp > 0.01) { const d = Math.min(sp, 7 * dt); k.vx -= (k.vx / sp) * d; k.vz -= (k.vz / sp) * d; }
      k.x += k.vx * dt; k.z += k.vz * dt; k.yaw += k.r * dt; k.r *= Math.max(0, 1 - 2.2 * dt);
      // a wreck stops at walls and buildings (not through them)
      if (sp > 0.05) {
        geo.eachSolid(k.x, k.z, 3, (o) => {
          if (o.broken || o.breakable) return;
          const ax = k.x - o.x; const az = k.z - o.z;
          const lx = ax * o.c - az * o.s; const lz = ax * o.s + az * o.c;
          const ex = o.hw + 1.1 - Math.abs(lx); const ez = o.hd + 1.1 - Math.abs(lz);
          if (ex <= 0 || ez <= 0) return;
          let nlx = 0; let nlz = 0; let pen;
          if (ex < ez) { nlx = Math.sign(lx) || 1; pen = ex; } else { nlz = Math.sign(lz) || 1; pen = ez; }
          const nx = nlx * o.c + nlz * o.s; const nz = -nlx * o.s + nlz * o.c;
          k.x += nx * pen; k.z += nz * pen;
          const vn = k.vx * nx + k.vz * nz; if (vn < 0) { k.vx -= 1.2 * vn * nx; k.vz -= 1.2 * vn * nz; k.vx *= 0.6; k.vz *= 0.6; k.r *= 0.5; }
        });
      }
      k.y = geo.ground(k.x, k.z);
      if (k.fade < 1) { k.fade -= dt / 0.8; if (k.fade <= 0) { knocked.delete(id); regrow.set(id, 0); } continue; }
      if (k.t > TRAFFIC.knockT) {
        // out of sight: rejoin; a stopped wreck nobody is next to fades away (it would otherwise
        // block a junction for as long as a player stays in the area)
        let dmin = Infinity;
        for (const v of viewers) dmin = Math.min(dmin, Math.hypot(v.x - k.x, v.z - k.z));
        if (dmin > 160) { knocked.delete(id); regrow.set(id, 0); } else if (sp < 0.3 && (dmin > 30 || (k.t > TRAFFIC.knockT * 2.5 && dmin > 9))) k.fade = 0.999;
      }
    }
    // a rejoined car grows back in over a second (it never pops into view)
    for (const [id, g] of regrow) { const g2 = g + dt; if (g2 >= 1) regrow.delete(id); else regrow.set(id, g2); }
  }
  const regrow = new Map(); // id → s since it rejoined its lane

  // Spawn clearing: at a round start no civilian car sits on (or drives into) the players' spawn
  // points. Inside a zone a car shrinks away (like at a road end: sc < 0.95 never collides);
  // after t1 the zone shrinks to nothing over CLR_T s and the cars grow back as its edge passes.
  // Zones are a pure function of the round (spawn points, shared traffic time), so both devices
  // agree; the shared lane schedule itself (hash) is untouched.
  const CLR_T = 3;
  let clrZ = [];
  function clearK(x, z, t) {
    let k = 1;
    for (const c of clrZ) {
      if (t > c.t1 + CLR_T || t < c.t0) continue;
      const re = t <= c.t1 ? c.r : c.r * (1 - (t - c.t1) / CLR_T);
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < re + GROW) k = Math.min(k, Math.max(0, (d - re) / GROW));
    }
    return k;
  }
  /** zones: [{ x, z, r, t0, t1 }] (traffic time), or [] to clear. */
  function setClear(zones) { clrZ = (zones || []).filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.z) && c.r > 0).map((c) => ({ x: c.x, z: c.z, r: c.r, t0: c.t0 ?? -Infinity, t1: c.t1 })); }

  /** Signal state for road ri at junction ji at time t: 'g' | 'y' | 'r' (or null: no signal). */
  function signalState(ji, ri, t) {
    if (!sig[ji] || !sig[ji].ph.has(ri)) return null;
    const k = Math.floor((t - EPOCH) / SIM_DT);
    const s = sigAt(ji, ri, k);
    return s === 0 ? 'g' : s === 1 ? 'y' : 'r';
  }

  /** Order-independent hash of every scheduled position at time t (determinism test). */
  function hash(t) {
    let h = 0;
    const sim = ensure(t);
    for (const L of lanes) for (let j = 0; j < L.n; j++) {
      poseOn(L, j, t, P1, sim, true); // the shared schedule (local yielding left out)
      if (!(P1.sc > 0)) continue; // on the hidden stretch (place() leaves x, z stale there)
      h = (h + Math.round(P1.x * 100) * 31 + Math.round(P1.z * 100) * 17 + (L.first + j)) | 0;
    }
    return h >>> 0;
  }

  return {
    total, lanes, knocked, each, warm, density, mapId, select, poseOf, knock, setWreck, stepWrecks, yieldTo, hash, poseOn: (L, j, t, out) => poseOn(L, j, t, out, ensure(t)),
    signalState, signals: sig, junctions: G ? G.junctions : [], setClear, clearK,
    get simStep() { return simK; },
    clearWrecks() { knocked.clear(); lag.clear(); regrow.clear(); },
  };
}
