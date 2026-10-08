// Getaway AI driver (practice vs AI, and the test bots). Plans on the road graph (roadgraph.js:
// Dijkstra over junctions, re-planned at most twice a second) and drives the route's right-hand
// lane with pure-pursuit steering and a curvature speed profile, reading the traffic ahead
// (follows, overtakes when the oncoming lane is clear, brakes for crossing cars). It never aims
// straight across lawns: it only leaves the route for a short, clear dash at the other car.
//
// Cop: pursues along the roads when close, otherwise intercepts on the runner's predicted route;
// within ~35 m with a clear line it runs a PIT routine (approach → align on a rear quarter → tap
// → peel off) and boxes a stopped runner in (stops off its front quarter instead of shoving).
// Spike strips go on the runner's predicted route 3–4 s ahead. Without line of sight it works
// from the last place it saw the runner, with a radar ping every few seconds (by level).
// Runner: picks escape junctions where it arrives well before the cop (Dijkstra from both),
// preferring ones out of the cop's sight, avoiding dead ends and strips; drops oil with the cop
// on its bumper; nitro on straights.
// Both: a progress watchdog (reverse with opposite lock, three-point turn, penalise the blocked
// road, and as a last resort out of the player's way, a hop back onto the lane behind).
//
// API: createDriver(geo, role, { seed, level }) → { update(dt, car, other, opts), out, state,
// reset(), level }. level: 'easy' | 'normal' | 'hard' (AI_LEVELS). Call update at a fixed rate
// (game.js: 30 Hz inside the physics step). opts: { los, traffic, tT, spikes, spikesLeft,
// oilLeft, hit (a contact with the other car this tick), viewer: {x, z} (the human's car, for the
// last-resort hop) }. out: { steer, gas, brake, hand, nitro, spike: null | {x, z}, oil, warp:
// null | {x, z, yaw} }.
import { routePolyline } from './roadgraph.js';

export const AI_LEVELS = ['easy', 'normal', 'hard'];
export const AI_LEVEL_LABELS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
// hold: how long the cop waits behind a stopped car before creeping round it (s)
const LV = {
  easy: { vK: 0.88, react: 0.25, pit: 0, ping: 6, nitro: 0.5, traffic: 1.25, cool: 2.4, hold: 2.6 },
  normal: { vK: 0.95, react: 0.15, pit: 1, ping: 4, nitro: 0.8, traffic: 1, cool: 1.5, hold: 1.8 },
  hard: { vK: 1.0, react: 0.08, pit: 2, ping: 2, nitro: 1, traffic: 0.85, cool: 0.8, hold: 1.2 },
};
// creep-round offsets across my path (m; + is right): the runner tries the verge side first, the
// cop the oncoming lane
const CREEP_RUNNER = [2.9, -2.9, 4.3, -4.3, 5.8, -5.8];
const CREEP_COP = [-2.9, -4.3, 2.9, 4.3, -5.8, 5.8];

const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const BASE = 2.75; const STEER_LOCK = 0.6; const STEER_SPEED = 18; const GRIP_YAW = 19.5 * 0.97 * 1.18; // tune.js CAR.{runner,cop}.grip × 0.97 × lockGripK (car.js)

export function createDriver(geo, role, { seed = 1, level = 'normal', skill } = {}) {
  const lv = LV[level] || LV.normal;
  let sd = seed >>> 0 || 1;
  const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
  const G = geo.roadGraph();
  const roads = geo.roads;
  const out = { steer: 0, gas: 0, brake: 0, hand: false, nitro: false, spike: null, oil: false, warp: null };
  const D = {
    t: 0, mode: 'route', pit: 'approach', pitT: 0, pitSide: 1, coolT: 0,
    replanT: 0, goalT: 0, fails: 0, route: null, ri: 0, laneShift: 0, laneT: 0, target: null,
    stuckLvl: 0, stuckAt: -99, revT: 0, revSteer: 0, turnT: 0, turnSteer: 0, lastSteer: 0, hopT: 0,
    revSteer0: 0, revTry: 0, revRun: 0, revX: 0, revZ: 0, recX: null, recZ: 0, quick: false, blockT: 0, held: false,
    spikeT: 8 + rnd() * 6, oilT: 0, known: null, pingT: 0, farT: 0, closeT: 0, aheadT: 0,
    trafT: 0, tLead: Infinity, tLeadV: 0, tFree: Infinity, laneK: 0, laneTarget: 0, sideNudge: 0, vWant: 0,
    stats: { replans: 0, stucks: 0, hops: 0, maxMs: 0 },
  };
  const penal = new Map(); // edge → expiry time (s)
  const penalty = (e) => { const u = penal.get(e); return u && u > D.t ? 60 : 0; };
  const dMe = G.newDist(); const pMe = G.newPrev(); const dOt = G.newDist(); const pOt = G.newPrev();
  const loc = {}; const loc2 = {}; const res = {}; const srcs = [];
  const hist = []; // other car history for the reaction delay
  const obsNow = {};
  const knownS = { t: 0, x: 0, z: 0, y: 0, level: -1, vx: 0, vz: 0, yaw: 0, speed: 0, at: 0 }; const knownX = { ...knownS };
  const setKnown = (o) => { const k = knownS; k.t = o.t; k.x = o.x; k.z = o.z; k.y = o.y; k.level = o.level; k.vx = o.vx; k.vz = o.vz; k.yaw = o.yaw; k.speed = o.speed; k.at = D.t; return k; };
  const pl = {}; // route polyline buffers (reused)

  // ── helpers ──
  const notBridge = (o) => !o.bridge; const locKeep = {};
  /** locate() for a car: on a deck it's that deck; on the ground, ground roads first. */
  function locateCar(c, out, maxD = 120) {
    const lvl = c.level == null ? -1 : c.level;
    if (lvl >= 0) return G.locate(c.x, c.z, c.yaw, out, 40, (o) => o.idx === lvl);
    // (40 m first: a 120 m search is 121 grid cells and was the chase's top JS self function)
    G.locate(c.x, c.z, c.yaw, out, Math.min(40, maxD), notBridge);
    if (out.road < 0 && maxD > 40) G.locate(c.x, c.z, c.yaw, out, maxD, notBridge);
    if (out.road < 0 || out.d > 25) { const d0 = out.road < 0 ? Infinity : out.d; const r0 = out.road; Object.assign(locKeep, out); G.locate(c.x, c.z, c.yaw, out, maxD); if (out.road < 0 || out.d >= d0) { Object.assign(out, locKeep); out.road = r0; } }
    return out;
  }
  function observe(other) {
    if (!other) return null;
    hist.push({ t: D.t, x: other.x, z: other.z, y: other.y || 0, level: other.level == null ? -1 : other.level, vx: other.vx || 0, vz: other.vz || 0, yaw: other.yaw || 0, speed: other.speed != null ? other.speed : Math.hypot(other.vx || 0, other.vz || 0) });
    while (hist.length > 2 && hist[1].t <= D.t - lv.react) hist.shift();
    // what it saw a reaction time ago, dead-reckoned to now (people anticipate)
    const h = hist[0]; const a = D.t - h.t; const o = obsNow;
    o.t = D.t; o.x = h.x + h.vx * a; o.z = h.z + h.vz * a; o.y = h.y; o.level = h.level; o.vx = h.vx; o.vz = h.vz; o.yaw = h.yaw; o.speed = h.speed;
    return o;
  }
  /** Plan a route from the car to graph point tl (a locate() result). Returns true on success. */
  function routeTo(car, tl, laneK = 0.5) {
    if (tl.road < 0) return false;
    locateCar(car, loc);
    if (loc.road < 0) return false;
    const spans = [];
    if (loc.road === tl.road && loc.a === tl.a && loc.b === tl.b && (tl.s - loc.s) * loc.dir > 0 && !roads[loc.road].closed) {
      spans.push({ road: loc.road, s0: loc.s, s1: tl.s });
    } else {
      G.sourcesFor(loc, car.speed || 0, srcs);
      G.dijkstra(srcs, dMe, pMe, penal.size ? penalty : null);
      G.costTo(tl, dMe, res);
      if (!Number.isFinite(res.cost)) return false;
      const sp = G.spansTo(res.via, pMe, []);
      const first = sp.start === loc.a ? loc.sa : loc.sb;
      if (Math.abs(first - loc.s) > 0.5) spans.push({ road: loc.road, s0: loc.s, s1: first });
      for (const q of sp.spans) spans.push(q);
      if (Math.abs(res.viaS - tl.s) > 0.5) spans.push({ road: tl.road, s0: res.viaS, s1: tl.s });
    }
    D.route = routePolyline(geo, spans, laneK, 4, 1400, D.route || pl);
    D.ri = 0;
    D.stats.replans++;
    return D.route.n >= 2;
  }
  /** Where a car on loc (heading loc.dir at speed v) will be over the next T seconds, along its
   *  road and the straightest continuation at each junction: [{x, z, t, road, s}]. */
  const ptPool = [];
  function predictRoute(lc, v, T, outPts) {
    outPts.length = 0;
    if (lc.road < 0) return outPts;
    let road = lc.road; let s = lc.s; let dir = lc.dir; let t = 0; const spd = Math.max(8, v);
    const tmp = {}; let guard = 0;
    while (t < T && guard++ < 40) {
      const r = roads[road];
      // distance to the next node (or the end) in the travel direction
      const l = G.roadNodes[road]; let next = -1; let ns = dir > 0 ? Infinity : -Infinity;
      for (const n of l) { const q = G.nodes.s[n]; if (dir > 0 ? q > s + 0.5 && q < ns : q < s - 0.5 && q > ns) { ns = q; next = n; } }
      if (next < 0) {
        if (r.closed) { ns = dir > 0 ? s + 50 : s - 50; } else break;
      }
      const L = Math.abs(ns - s); const step = 15;
      for (let d = step; d <= L && t < T; d += step) {
        let ss = s + dir * d; if (r.closed) { ss %= r.len; if (ss < 0) ss += r.len; }
        geo.sampleRoad(r, ss, tmp); t += step / spd;
        { let o = ptPool[outPts.length]; if (!o) { o = { x: 0, z: 0, t: 0, road: 0, s: 0 }; ptPool[outPts.length] = o; } o.x = tmp.x; o.z = tmp.z; o.t = t; o.road = road; o.s = ss; outPts.push(o); } // (pooled: no objects per 30 Hz tick)
      }
      if (next < 0) { s = ((ns % r.len) + r.len) % r.len; continue; }
      t += (L % step) / spd;
      // the straightest way on from the node (not back the way it came)
      geo.sampleRoad(r, G.nodes.s[next], tmp); const hx = tmp.tx * dir; const hz = tmp.tz * dir;
      let best = null; let bd = -2;
      const consider = (n2, viaLink) => {
        for (let k = G.adjStart[n2]; k < G.adjStart[n2 + 1]; k++) {
          const e = G.adj[k]; const rr = G.edges.road[e]; if (rr < 0) continue;
          if (!viaLink && rr === road && Math.sign(G.edges.s1[e] - G.edges.s0[e]) !== dir) continue;
          const d2 = G.edges.s1[e] >= G.edges.s0[e] ? 1 : -1;
          geo.sampleRoad(roads[rr], G.edges.s0[e], tmp);
          const dot = tmp.tx * d2 * hx + tmp.tz * d2 * hz;
          if (viaLink && rr === road) continue;
          if (dot > bd) { bd = dot; best = { road: rr, s: G.edges.s0[e], dir: d2 }; }
        }
      };
      consider(next, false);
      for (let k = G.adjStart[next]; k < G.adjStart[next + 1]; k++) { const e = G.adj[k]; if (G.edges.road[e] < 0) consider(G.edges.to[e], true); }
      if (!best || bd < -0.2) break;
      road = best.road; s = best.s; dir = best.dir;
    }
    return outPts;
  }

  // ── following ──
  const tgt = { x: 0, z: 0 };
  const tmpS = { x: 0, z: 0, tx: 0, tz: 0, s: 0 };
  /** Advance the projection along the route, find the look-ahead point and the speed limit
   *  from the curvature ahead. Returns false when there is no route. */
  function follow(car, vMax, look) {
    const R = D.route; if (!R || R.n < 2) return false;
    // projection: the nearest polyline vertex in a window ahead
    let best = D.ri; let bd = Infinity;
    for (let i = D.ri; i < Math.min(R.n, D.ri + 40); i++) { const d = (R.x[i] - car.x) ** 2 + (R.z[i] - car.z) ** 2; if (d < bd) { bd = d; best = i; } }
    D.ri = best; D.offRoute = Math.sqrt(bd);
    const s0 = R.s[best];
    // the sharpest turn within the look-ahead shortens it (no corner cutting through lots)
    let L = look;
    for (let i = best + 1; i < R.n - 1 && R.s[i] - s0 < L; i++) {
      const ax = R.x[i] - R.x[i - 1]; const az = R.z[i] - R.z[i - 1]; const bx = R.x[i + 1] - R.x[i]; const bz = R.z[i + 1] - R.z[i];
      const c = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
      if (c < 0.75) { L = Math.max(5, Math.min(L, R.s[i] - s0 + 3)); break; }
    }
    const sT = s0 + L;
    let i = best; while (i < R.n - 1 && R.s[i + 1] < sT) i++;
    if (i >= R.n - 1) { tgt.x = R.x[R.n - 1]; tgt.z = R.z[R.n - 1]; } else { const k = (sT - R.s[i]) / ((R.s[i + 1] - R.s[i]) || 1); tgt.x = R.x[i] + (R.x[i + 1] - R.x[i]) * k; tgt.z = R.z[i] + (R.z[i + 1] - R.z[i]) * k; }
    // speed: v ≤ sqrt(aLat / κ) at each point ahead, reachable with braking b
    const aLat = 12.5 * (car.grip || 1); const b = 10.5;
    const horizon = (car.speed * car.speed) / (2 * b) + 25;
    let vT = vMax;
    // curvature from the heading change over ±7 m of path (the line pure pursuit actually drives)
    let jb = best; let jf = best;
    for (let j = best; j < R.n - 1 && R.s[j] - s0 < horizon; j++) {
      while (jb < j && R.s[j] - R.s[jb + 1] >= 7) jb++;
      while (jf < R.n - 1 && R.s[jf] - R.s[j] < 7) jf++;
      if (jb === j || jf === j) continue;
      const ax = R.x[j] - R.x[jb]; const az = R.z[j] - R.z[jb]; const bx = R.x[jf] - R.x[j]; const bz = R.z[jf] - R.z[j];
      const la = Math.hypot(ax, az); const lb = Math.hypot(bx, bz); if (la < 1 || lb < 1) continue;
      const turn = Math.atan2(Math.abs(ax * bz - az * bx), ax * bx + az * bz);
      const kap = turn / ((la + lb) * 0.5);
      if (kap < 1e-4) continue;
      const vC = Math.sqrt(aLat / kap);
      const d = Math.max(0, R.s[j] - s0 - 4);
      const allow = Math.sqrt(vC * vC + 2 * b * d);
      if (allow < vT) vT = allow;
    }
    // the end of the route: arrive, don't overshoot
    const toEnd = R.len - s0;
    D.routeLeft = toEnd;
    D.vCurve = vT;
    return true;
  }
  /** Pure pursuit: steering input (−1..1) towards (tx, tz) for the car's speed. */
  function pursue(car, tx, tz) {
    const dx = tx - car.x; const dz = tz - car.z; const Ld = Math.max(3, Math.hypot(dx, dz));
    const alpha = wrap(Math.atan2(dx, -dz) - car.yaw);
    const kap = (2 * Math.sin(alpha)) / Ld;
    const delta = Math.atan(kap * BASE);
    // the car's lock is grip-limited at speed (car.js: full lock = lockGripK × the grip-limited yaw
    // rate), far below the kinematic lock past ~50 km/h. Mapping the curvature onto the kinematic
    // lock under-steered 2.6× at 90 km/h: the AI wallowed ±2 m off its line out of every corner and
    // clipped Pearl St's parked cars. 1.4 × the grip lock keeps a little of pure pursuit's
    // under-steer (exact grip mapping tracks the chord tighter and cut more kerbs on Dockside).
    // Bench (39 AI-vs-AI rounds × 90 s per map): Boulder route error 1.11 → 0.74 m, ≥ 43 km/h wall
    // hits 24 → 8, parked-car hits 33 → 4; Santee 20 → 8; Dockside 3 → 1.
    const va = Math.max(Math.abs(car.vf || car.speed || 0), 4);
    const lock = Math.min(STEER_LOCK / (1 + va / STEER_SPEED), 1.4 * Math.atan((GRIP_YAW * BASE) / (va * va)));
    let st = delta / lock;
    if (Math.abs(alpha) > 1.2) st = Math.sign(alpha) * 1.2; // behind us: full lock
    st -= (car.r || 0) * 0.04; // a touch of yaw damping
    return { st: clamp(st, -1, 1), alpha };
  }

  /** Like segBlocked(…, any) but flimsy breakables (mailboxes, hydrants, signs, shrubs) don't
   *  count: driving through those is fine in a chase. */
  function vergeBlocked(x0, z0, x1, z1) {
    const L = Math.hypot(x1 - x0, z1 - z0) || 1; let best = 1;
    const n = Math.ceil(L / 3);
    for (let i = 0; i <= n && best >= 1; i++) {
      const px = x0 + ((x1 - x0) * i) / n; const pz = z0 + ((z1 - z0) * i) / n;
      geo.eachSolid(px, pz, 2, (o) => {
        if (o.broken || o.flimsy || o.soft || o.h < 0.3) return;
        const ax = px - o.x; const az = pz - o.z;
        const lx = ax * o.c - az * o.s; const lz = ax * o.s + az * o.c;
        const r = o.cr > 0 ? o.cr + 1.1 : 0;
        if (r ? Math.hypot(ax, az) < r : (Math.abs(lx) < o.hw + 1.1 && Math.abs(lz) < o.hd + 1.1)) best = Math.min(best, i / n);
      });
    }
    return best;
  }
  // ── traffic awareness (every 0.1 s) ──
  // Cars ahead go into a list with their sideways offset from my path at the moment I'd reach
  // them; then a few corridors are scored (my lane, the oncoming lane, either verge) by how far
  // they stay clear, and the car steers for the best one (with some stickiness).
  const obs = []; let obsN = 0;
  const lanes = [0, 0, 0, 0];
  // (readTraffic's visitor is made once; its frame goes through RT)
  const RT = { car: null, fx: 0, fz: 0, rx: 0, rz: 0, v: 0 };
  function seeCar(id, p) {
    const car = RT.car; const fx = RT.fx; const fz = RT.fz; const rx = RT.rx; const rz = RT.rz;
    if (p.sc < 0.05 || Math.abs((p.y || 0) - (car.y || 0)) > 2.5) return; // growing ones count too
    const dx = p.x - car.x; const dz = p.z - car.z;
    const lz = dx * fx + dz * fz; const lx = dx * rx + dz * rz;
    if (lz < -2 || lz > 70) return;
    const hdot = Math.sin(p.yaw) * fx - Math.cos(p.yaw) * fz;
    const along = p.vx * fx + p.vz * fz; // its speed along my heading
    const tau = Math.max(0, lz - 3) / Math.max(3, RT.v - Math.max(0, along));
    const flx = lx + (p.vx * rx + p.vz * rz) * Math.min(tau, 3);
    let o = obs[obsN]; if (!o) { o = {}; obs[obsN] = o; } obsN++;
    o.lz = lz; o.lx = lx; o.flx = flx; o.along = along; o.hdot = hdot; o.spd = p.speed;
    // the siren makes cars ahead slow down and pull over to the right: count on it
    if (role === 'cop' && hdot > 0.6 && p.speed < 5 && lx > 0.6 && lz > 3) o.flx = Math.max(flx, 2.6);
  }
  function readTraffic(car, opts) {
    D.trafT -= opts.dt; if (D.trafT > 0) return; D.trafT = 0.1;
    obsN = 0;
    const tr = opts.traffic;
    // slow and turning (pulling out of a junction, round a corner): look where I'm turning to, not
    // along my nose, or a car waiting at the line straight ahead (for a red light, or giving way
    // to me) holds me up for ever while I'm not even going that way
    let hy = car.yaw;
    if (car.speed < 8 && D.tx != null && Math.hypot(D.tx - car.x, D.tz - car.z) > 3) {
      const da = wrap(Math.atan2(D.tx - car.x, -(D.tz - car.z)) - car.yaw);
      if (Math.abs(da) > 0.5) hy = car.yaw + clamp(da, -1.2, 1.2) * 0.7;
    }
    const fx = Math.sin(hy); const fz = -Math.cos(hy); const rx = Math.cos(hy); const rz = Math.sin(hy);
    const v = Math.max(5, car.speed);
    if (tr && tr.total) {
      RT.car = car; RT.fx = fx; RT.fz = fz; RT.rx = rx; RT.rz = rz; RT.v = v;
      tr.each(car.x + fx * 30, car.z + fz * 30, 42, opts.tT, seeCar);
      RT.car = null;
    }
    // corridors relative to my path: 0 my lane, 1 the oncoming lane, 2 right verge, 3 left verge
    geo.nearestRoad(car.x, car.z, loc2, 30);
    const r = loc2.road >= 0 ? roads[loc2.road] : null;
    const hw = r ? r.hw - (r.park || 0) : 4; const off = r ? (r.lanes > 1 ? (0.5 * hw) / r.lanes : hw * 0.5) : 2; // (hw less any parking strip)
    lanes[0] = 0; lanes[1] = -2 * off; lanes[2] = hw - off + 1.7; lanes[3] = -(hw + off) - 1.7;
    const me = D.laneShift; // where I am across my path (the corridors are measured from the path)
    lanes[4] = D.dodgeOff || 0;
    /** Free distance along a corridor centred at c (my frame); sweep: also the band from me to c. */
    const freeAt = (c, sweep) => {
      // the sweep is the strip I cross on the way (not my own lane: what's there is what I'm passing)
      const lo = c < 0 ? c - 2.35 : 1.4; const hi = c < 0 ? -1.4 : c + 2.35;
      let free = 70; let lv0 = 99; let bs = 99;
      for (let i = 0; i < obsN; i++) {
        const o = obs[i];
        const inLane = Math.abs(o.flx - c) < 2.25 || (o.lz < 25 && Math.abs(o.lx - c) < 2.25);
        const inSweep = sweep && o.lz < 9 && o.lx > lo && o.lx < hi; // the stretch where I move across
        if (!inLane && !inSweep) continue;
        const eff = Math.max(0, o.hdot < -0.5 ? o.lz * v / (v + Math.max(0, -o.along)) : o.lz); // oncoming closes fast
        if (eff < free) { free = eff; lv0 = o.hdot > 0.5 ? Math.max(0, o.along) : 0; bs = o.spd; }
      }
      return [free, lv0, bs];
    };
    // where I am right now: this is what the speed limit is about
    const here = freeAt(0, false);
    let cur = D.laneK || 0; let keepT = D.laneHold || 0;
    keepT -= 0.1;
    const own = freeAt(lanes[0] - me, cur !== 0);
    // (the cop runs with the siren on: traffic pulls over for it, so it passes more readily)
    // a runner with the cop close behind can't sit in a queue: it takes smaller gaps. So also with
    // the cop in sight within 120 m, or anywhere inside the heat distance (the heat isn't going to
    // drop while it waits there): queuing at a light with the cop closing from 80 m read as a
    // passive runner (3–7 s at under 1.5 m/s in practice play-tests)
    const cn = D.copNear || 0;
    const urgent = role === 'runner' && (cn < 70 || (D.copLos ? cn < 120 : cn < (D.heatR || 0)));
    const need = role === 'cop' ? Math.max(28, v * 1.7) : urgent ? Math.max(24, v * 1.5) : Math.max(38, v * 2.2);
    // nose to nose with a car that isn't moving (it's waiting for me, at a red light, or stuck):
    // creep round it, with room to swing out (closer than 6 m, squeezing past just wedges the car
    // against the other's corner: the watchdog backs it out first). The runner soon; the cop too,
    // more patiently by level: its siren only clears the way while it's moving, so a queue it's
    // stopped behind stays put (an Easy cop sat 5–12 s behind a red-light queue in practice).
    // (a timer that decays instead of resetting: one 0.1 s read with the blocker just outside my
    // lane used to restart the wait)
    const blocked = car.speed < 4 && here[0] < 14 && here[0] >= 6 && here[2] < 1;
    D.blockT = blocked ? (D.blockT || 0) + 0.1 : Math.max(0, (D.blockT || 0) - 0.3);
    D.held = D.blockT > (role === 'runner' ? (urgent ? 0.3 : 1.0) : lv.hold);
    if (cur === 4) {
      const f = freeAt(lanes[4] - me, false);
      if (keepT <= 0 && (own[0] >= 14 || f[0] < 3)) { cur = 0; keepT = 0.6; }
    } else if (D.held) {
      // (the cop pulls out to the left first: the oncoming lane, through the light, siren on)
      for (const c of role === 'cop' ? CREEP_COP : CREEP_RUNNER) {
        const f = freeAt(c, true); if (f[0] < 10) continue;
        const ox = car.x + rx * c; const oz = car.z + rz * c;
        if (vergeBlocked(car.x + fx * 2, car.z + fz * 2, ox + fx * 5, oz + fz * 5) < 1 || vergeBlocked(ox + fx * 5, oz + fz * 5, ox + fx * 14, oz + fz * 14) < 1) continue;
        const sf = geo.surfaceAt(ox + fx * 8, oz + fz * 8); if (sf === 'water') continue;
        cur = 4; keepT = 2.2; D.dodgeOff = me + c; lanes[4] = D.dodgeOff; D.blockT = 0; break;
      }
    }
    D.vergeT = cur === 2 || cur === 3 ? (D.vergeT || 0) + 0.1 : 0;
    if (cur === 4) { /* creeping round: handled above */ } else if (cur !== 0) {
      // back to my own lane as soon as it's clear (and the move across is clear) — or as soon as it
      // flows again: the verge is for getting past a queue that is standing still, not for riding
      // the grass beside a line of cars doing my speed (that held the runner off the road for
      // 10+ s at a time). A verge is given up after a few seconds for any decent slot.
      const verge = cur !== 1;
      const slot = own[0] >= 8 + v * 0.55;
      const flowing = slot && own[1] >= v - 2.5;
      // (a lane that has cleared right out beats the hold on a verge: the queue I dodged moved off)
      const wide = verge && own[0] >= Math.max(50, v * 2.4);
      if ((keepT <= 0 || wide) && (own[0] >= Math.max(30, v * 1.6) || (verge && flowing) || (D.vergeT > 3.5 && slot))) { cur = 0; keepT = 1.2; }
      else {
        const f = freeAt(lanes[cur] - me, false);
        // the overtake is closing up: abort; a blocked verge: back to the road unless that's worse
        if (f[0] < 12 && (own[0] > f[0] + 6 || (verge && own[0] >= f[0] - 1))) { cur = 0; keepT = 1.2; }
      }
    } else if (here[0] < 45 && here[1] < Math.max(v, D.vWant || 0) - 4 && keepT <= 0 && Math.abs(D.alpha || 0) < 0.5) { // (not mid-turn: the corridors are along my nose)
      // something slow ahead: overtake on the oncoming side if it's clear for long enough
      const opp = r && r.oneway ? [0, 0] : freeAt(lanes[1] - me, true);
      if (opp[0] >= need) { cur = 1; keepT = 1.5; }
      else if (v < 12 && here[0] < (urgent ? 22 : 14)) { // crawling in a queue: try a verge
        for (const q of [2, 3]) {
          const c = lanes[q] - me; const f = freeAt(c, true);
          if (f[0] < 18) continue;
          const ox = car.x + rx * c; const oz = car.z + rz * c;
          if (vergeBlocked(car.x, car.z, ox + fx * 4, oz + fz * 4) < 1 || vergeBlocked(ox + fx * 4, oz + fz * 4, ox + fx * 26, oz + fz * 26) < 1) continue;
          const sf = geo.surfaceAt(ox + fx * 12, oz + fz * 12); if (sf === 'water' || sf === 'sand') continue;
          cur = q; keepT = 2; break;
        }
      }
    }
    // a car right beside me: lean away from it
    let side = 0;
    for (let i = 0; i < obsN; i++) { const o = obs[i]; if (o.lz < 4 && o.lz > -3 && Math.abs(o.lx) < 2.6) side += (o.lx > 0 ? -1 : 1) * (2.6 - Math.abs(o.lx)); }
    D.sideNudge = clamp(side, -1.2, 1.2);
    D.laneK = cur; D.laneHold = keepT; D.laneTarget = lanes[cur] + D.sideNudge;
    D.tFree = here[0]; D.tLeadV = here[1]; D.tLead = own[0];
    D.creep = cur === 4;
    if (cur === 4) { const f = freeAt(lanes[4] - me, false); D.tFree = Math.max(f[0], Math.min(here[0] + 6, 12)); D.tLeadV = f[1]; }
  }

  // ── decisions ──
  const pts = [];
  function copPlan(car, k, dist) {
    // intercept: the earliest point on the runner's predicted route I can reach in time
    locateCar(k, loc2);
    if (loc2.road < 0) return false;
    locateCar(car, loc);
    if (loc.road < 0) return false;
    G.sourcesFor(loc, car.speed, srcs);
    G.dijkstra(srcs, dMe, pMe, penal.size ? penalty : null);
    let goal = null;
    if (dist > 90 && k.speed > 4) { // (a car that's stopped isn't going anywhere: go to it)
      predictRoute(loc2, k.speed, 14, pts);
      const lt = {};
      for (const p of pts) {
        G.locate(p.x, p.z, null, lt, 30, (o) => o.idx === p.road);
        if (lt.road < 0) continue;
        G.costTo(lt, dMe, res);
        if (res.cost <= p.t * 1.1 + 1) { goal = { ...lt }; break; }
      }
    }
    if (!goal) { // pursue: where it will be in a moment
      const lead = clamp(dist / 30, 0.3, 1.6);
      locateCar({ x: k.x + k.vx * lead, z: k.z + k.vz * lead, yaw: k.yaw, level: k.level }, loc2);
      if (loc2.road < 0) return false;
      goal = loc2;
    }
    return routeTo(car, goal);
  }
  function runnerPlan(car, cop) {
    locateCar(car, loc); if (loc.road < 0) return false;
    G.sourcesFor(loc, car.speed, srcs);
    // with the cop close, turning back means driving at it: keep going forward
    if (cop && Math.hypot(cop.x - car.x, cop.z - car.z) < 90 && srcs.length === 4) srcs.length = 2;
    G.dijkstra(srcs, dMe, pMe, penal.size ? penalty : null, 40);
    if (cop) {
      locateCar(cop, loc2, 150);
      if (loc2.road >= 0) { G.sourcesFor(loc2, cop.speed || 0, srcs); G.dijkstra(srcs, dOt, pOt, null, 80); } else dOt.fill(60);
    } else dOt.fill(60);
    // candidate escape nodes 6–28 s away
    const N = G.nodes.n; const cand = [];
    for (let n = 0; n < N; n++) {
      const m = dMe[n]; if (!(m > 6 && m < 28)) continue;
      const c = dOt[n];
      let sc = Math.min(30, (Number.isFinite(c) ? c : 60) - m) * 1.0 + m * 0.35;
      if (G.nodes.degree[n] <= 1) sc -= 30; // dead end
      if (roads[G.nodes.road[n]].bridge) sc -= 3;
      sc += rnd() * 4;
      cand.push([sc, n]);
    }
    if (!cand.length) return false;
    cand.sort((a, b) => b[0] - a[0]);
    // out of the cop's sight is worth a lot (checked for the best dozen)
    let bestN = cand[0][1]; let bestS = -Infinity;
    for (let q = 0; q < Math.min(12, cand.length); q++) {
      const n = cand[q][1]; let sc = cand[q][0];
      if (cop && geo.segBlocked(cop.x, cop.z, G.nodes.x[n], G.nodes.z[n], 2.2) < 1) sc += 12;
      if (sc > bestS) { bestS = sc; bestN = n; }
    }
    G.locate(G.nodes.x[bestN], G.nodes.z[bestN], null, loc2, 10, (o) => o.idx === G.nodes.road[bestN]);
    if (loc2.road < 0) return false;
    D.goal = { x: G.nodes.x[bestN], z: G.nodes.z[bestN] };
    return routeTo(car, loc2);
  }
  /** Strips on (or across) my route within `ahead` m: returns the distance or Infinity. */
  function stripAhead(spikes, ahead) {
    const R = D.route; if (!R || !spikes || !spikes.length) return Infinity;
    const s0 = R.s[D.ri] || 0;
    for (const s of spikes) {
      if (s.gone) continue;
      for (let i = D.ri; i < R.n && R.s[i] - s0 < ahead; i += 2) if (Math.abs(R.x[i] - s.x) < s.len / 2 + 2 && Math.abs(R.z[i] - s.z) < s.len / 2 + 2 && Math.hypot(R.x[i] - s.x, R.z[i] - s.z) < s.len / 2 + 1.5) return R.s[i] - s0;
    }
    return Infinity;
  }

  // ── the PIT routine (cop, close, clear line) ──
  function pitDrive(car, k, dist, opts) {
    const fx = Math.sin(k.yaw); const fz = -Math.cos(k.yaw); const rx = Math.cos(k.yaw); const rz = Math.sin(k.yaw);
    const dx = car.x - k.x; const dz = car.z - k.z;
    const lx = dx * rx + dz * rz; const lz = dx * fx + dz * fz;
    const hd = Math.abs(wrap(car.yaw - k.yaw));
    D.pitT += opts.dt; if (D.coolT > 0) D.coolT -= opts.dt;
    let tx; let tz; let vT;
    const lead = 0.35;
    const kx = k.x + k.vx * lead; const kz = k.z + k.vz * lead;
    if (k.speed < 5 && dist < 16) { // BOX: pull up close and wait (no shoving it around)
      D.pit = 'box';
      const ux = dx / (dist || 1); const uz = dz / (dist || 1);
      tx = k.x + ux * 5.5; tz = k.z + uz * 5.5;
      const dT = dist - 5.5;
      vT = dT < 1 ? 0 : Math.min(8, 1 + dT * 0.7);
      return { tx: k.x, tz: k.z, vT, brakeHard: dT < 1 };
    }
    if (D.pit === 'box') D.pit = 'approach';
    if (opts.hit && D.pit === 'tap' && D.pitT > 0.08) { D.pit = 'peel'; D.pitT = 0; D.coolT = lv.cool; }
    switch (D.pit) {
      case 'peel':
        tx = kx - fx * 10 + rx * D.pitSide * 3; tz = kz - fz * 10 + rz * D.pitSide * 3; vT = Math.max(0, k.speed - 3);
        if (D.pitT > 1.0) { D.pit = 'approach'; D.pitT = 0; }
        break;
      case 'tap': // swing the nose into its rear quarter
        tx = kx - fx * 2.6 - rx * D.pitSide * (lv.pit > 1 ? 2.0 : 1.5); tz = kz - fz * 2.6 - rz * D.pitSide * (lv.pit > 1 ? 2.0 : 1.5); vT = k.speed + 2;
        if (D.pitT > 0.7) { D.pit = 'peel'; D.pitT = 0; D.coolT = lv.cool; }
        break;
      case 'align': { // alongside: my nose by its back wheel
        tx = kx - fx * 1.0 + rx * D.pitSide * 2.75; tz = kz - fz * 1.0 + rz * D.pitSide * 2.75;
        vT = k.speed + clamp(-(lz + 3.9) * 0.9, -4, 4);
        if (Math.abs(lx) < 1.7 && lz < -3.4) vT = Math.min(vT, k.speed - 0.5); // still dead behind: don't rear-end it
        const ok = Math.abs(lx - D.pitSide * 2.75) < 0.6 && lz > -4.8 && lz < -3.0 && hd < 0.3 && k.speed > 9;
        if (ok && D.coolT <= 0 && lv.pit > 0) { D.pit = 'tap'; D.pitT = 0; }
        if (D.pitT > 7) { D.pit = 'approach'; D.pitT = 0; } // took too long: reset
        break;
      }
      default: { // approach: come up behind it, offset to one side, closing gently
        if (D.pitT < 0.05 || Math.abs(lx) > 6) {
          let side = lx >= 0 ? 1 : -1;
          if (geo.segBlocked(k.x, k.z, k.x + rx * side * 4, k.z + rz * side * 4, 0.5, true) < 1) side = -side;
          D.pitSide = side;
        }
        tx = kx - fx * 7 + rx * D.pitSide * 2.3; tz = kz - fz * 7 + rz * D.pitSide * 2.3;
        vT = k.speed + clamp((dist - 8) * 0.45, 1, 9);
        // too close behind (a stopped runner with me in line in front of it isn't 'behind': that
        // held the cop at a standstill 16–38 m ahead of a parked runner, waiting for good)
        if (Math.abs(lx) < 1.8 && lz > -7 && (lz < 0 || k.speed > 3)) vT = Math.min(vT, k.speed - 1);
        if (lz < -1 && lz > -10 && Math.abs(lx - D.pitSide * 2.3) < 1.3 && lv.pit > 0 && D.coolT <= 0) { D.pit = 'align'; D.pitT = 0; }
        if (lv.pit === 0) { tx = kx - fx * 5 + rx * 1.5; tz = kz - fz * 5 + rz * 1.5; vT = k.speed + clamp((dist - 7) * 0.4, -2, 6); } // easy: sits on its tail
      }
    }
    return { tx, tz, vT, brakeHard: false };
  }

  // ── the watchdog ──
  const trail = [];
  function watchdog(car, wantMove, opts) {
    if (!trail.length || D.t - trail[trail.length - 1].t >= 0.25) { trail.push({ t: D.t, x: car.x, z: car.z }); if (trail.length > 15) trail.shift(); }
    if (D.revT > 0 || D.turnT > 0) return;
    // a recovery that got nowhere (wedged between a fence and a house): the next level comes quickly
    if (D.recX != null) { D.quick = Math.hypot(car.x - D.recX, car.z - D.recZ) < 1; D.recX = null; }
    const old = trail[0];
    const span = D.t - old.t;
    const moved = Math.hypot(car.x - old.x, car.z - old.z);
    if (opts.hit) D.hitT = D.t;
    D.pinT = wantMove && car.speed < 1.5 ? (D.pinT || 0) + opts.dt : 0;
    // nose in a wall, or shoved against something by the other car: back out quickly
    const pinned = D.pinT > (role === 'runner' ? 0.7 : 1.1) && (car.wnT > 0 || D.t - (D.hitT || -9) < 0.6);
    // (a runner stuck for long is a sitting duck: it gives up sooner)
    const patience = D.quick ? 0.8 : role === 'runner' ? (D.tFree < 9 ? 2.4 : 1.8) : D.tFree < 9 ? 2.9 : 2.4;
    if (!(wantMove && span >= patience - 0.01 && moved < 4) && !pinned) { if (moved >= 4) D.quick = false; if (D.t - D.stuckAt > 10) D.stuckLvl = 0; return; }
    trail.length = 0; D.pinT = 0;
    D.stats.stucks++;
    D.stuckLvl = D.t - D.stuckAt < 9 ? D.stuckLvl + 1 : 1;
    D.stuckAt = D.t; D.recX = car.x; D.recZ = car.z;
    const opp = -Math.sign(D.lastSteer || 1);
    if (D.stuckLvl === 1) backUp(car, 1.2, opp);
    else if (D.stuckLvl === 2) { backUp(car, 2.0, opp); D.turnT = 1.4; D.turnSteer = -opp; }
    else {
      // block the road I'm on (this direction) for a while and plan around it
      G.locate(car.x, car.z, car.yaw, loc, 60);
      if (loc.road >= 0) for (let q = G.adjStart[loc.a]; q < G.adjStart[loc.a + 1]; q++) { const e = G.adj[q]; if (G.edges.to[e] === loc.b) penal.set(e, D.t + 20); }
      if (loc.road >= 0) for (let q = G.adjStart[loc.b]; q < G.adjStart[loc.b + 1]; q++) { const e = G.adj[q]; if (G.edges.to[e] === loc.a) penal.set(e, D.t + 20); }
      backUp(car, 1.6, opp); D.replanT = 0;
      // last resort (practice only): hop back onto the lane behind, out of the player's way
      if (D.stuckLvl >= 4 && opts.viewer && Math.hypot(opts.viewer.x - car.x, opts.viewer.z - car.z) > 70 && loc.road >= 0) {
        const r = roads[loc.road]; const tmp = {};
        geo.sampleRoad(r, clamp(loc.s - loc.dir * 12, 0, r.len), tmp);
        const tx0 = tmp.tx * loc.dir; const tz0 = tmp.tz * loc.dir; const off = (r.hw - (r.park || 0)) * 0.5;
        out.warp = { x: tmp.x - tz0 * off, z: tmp.z + tx0 * off, yaw: Math.atan2(tx0, -tz0) };
        D.stats.hops++; D.revT = 0; D.stuckLvl = 0;
      }
    }
    D.replanT = Math.min(D.replanT, 0.3);
  }
  /** Reverse for t s on this lock; recover() changes the lock when it isn't going anywhere. */
  function backUp(car, t, steer) { D.revT = t; D.revSteer = steer; D.revSteer0 = steer; D.revTry = 0; D.revRun = 0; D.revX = car.x; D.revZ = car.z; }
  /** Every 0.5 s of a reverse (or of the forward turn after it): moved under 0.3 m means the tail
   *  (or nose) is against something on this lock: straighten the wheel, then the other lock. A
   *  full-lock reverse with a fence behind one corner sat still for the whole manoeuvre, every level. */
  function recover(car, dt, fwd) {
    // (only once it's going the new way: braking out of the old direction first isn't stuck)
    const vf = car.vf != null ? car.vf : 0;
    if (fwd ? vf < -0.3 : vf > 0.3) { D.revRun = 0; D.revX = car.x; D.revZ = car.z; return; }
    D.revRun += dt;
    if (D.revRun < 0.5) return;
    if (Math.hypot(car.x - D.revX, car.z - D.revZ) < 0.3 && D.revTry < 2) {
      D.revTry++;
      if (fwd) D.turnSteer = D.revTry === 1 ? 0 : -D.turnSteer;
      else { D.revSteer = D.revTry === 1 ? 0 : -D.revSteer0; D.revT = Math.max(D.revT, 0.9); }
    }
    D.revRun = 0; D.revX = car.x; D.revZ = car.z;
  }

  // ── main ──
  function update(dt, car, other, opts = {}) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    D.t += dt; opts.dt = dt;
    out.hand = false; out.nitro = false; out.spike = null; out.oil = false; out.warp = null;
    const obs = observe(other);
    // knowledge: what the cop knows about the runner (it always hears the siren the other way)
    const los = !!opts.los;
    // (the radar ping is a readable rule, not a cheat: once the runner's escape meter is half full
    // the fix only extrapolates until the cop sees it again, and beyond the heat distance pings
    // come 1.75× slower, so a well-hidden runner can actually lose the heat)
    if (role === 'cop' && obs) {
      D.pingT -= dt;
      const escaping = (opts.esc || 0) >= 0.5;
      if (los || (D.pingT <= 0 && !escaping) || !D.known) { D.known = setKnown(obs); if (!los) D.pingT = lv.ping * (Math.hypot(obs.x - car.x, obs.z - car.z) > (opts.heat || 180) ? 1.75 : 1); }
    } else if (obs) D.known = setKnown(obs);
    let k = D.known;
    if (k && role === 'cop' && !los) { // extrapolate a stale fix a little
      const age = Math.min(4, D.t - k.at);
      const kx = knownX; kx.x = k.x + k.vx * age * 0.6; kx.z = k.z + k.vz * age * 0.6; kx.y = k.y; kx.level = k.level; kx.vx = k.vx; kx.vz = k.vz; kx.yaw = k.yaw; kx.speed = k.speed; kx.at = k.at;
      k = kx;
    }
    const dist = k ? Math.hypot(k.x - car.x, k.z - car.z) : 999;
    D.copNear = role === 'runner' ? dist : 999; D.copLos = los; D.heatR = opts.heat || 0;
    // recovering
    if (D.revT > 0) {
      D.revT -= dt; recover(car, dt, false); out.gas = 0; out.brake = 1; out.steer = D.revSteer;
      if (D.revT <= 0) { D.replanT = 0; D.revTry = 0; D.revRun = 0; D.revX = car.x; D.revZ = car.z; }
      finish(t0); return out;
    }
    if (D.turnT > 0) { D.turnT -= dt; recover(car, dt, true); out.gas = 0.7; out.brake = 0; out.steer = D.turnSteer; finish(t0); return out; }
    // catch-up / ease-off
    let vK = lv.vK * (skill || 1);
    if (role === 'cop') {
      D.farT = dist > 250 ? D.farT + dt : 0; D.closeT = dist < 25 ? D.closeT + dt : 0;
      if (D.farT > 6) vK *= 1.05;
      if (D.closeT > 8) vK *= 0.94;
    } else {
      D.aheadT = dist > 300 ? D.aheadT + dt : 0;
      if (D.aheadT > 4) vK *= 0.92;
    }
    const vMax = (role === 'cop' ? 46 : 45) * vK;
    const tq = typeof performance !== 'undefined' ? performance.now() : 0;
    readTraffic(car, opts);
    D.stats.trafMs = Math.max(D.stats.trafMs || 0, (typeof performance !== 'undefined' ? performance.now() : 0) - tq);
    // ── what to drive at ──
    D.replanT -= dt; D.goalT -= dt;
    let tx = 0; let tz = 0; let vT = vMax; let direct = false; let brakeHard = false;
    let clear = false;
    if (role === 'cop' && k && los && dist < 38) {
      // a clear, drivable line at it: no solids taller than a kerb, and road or lot underfoot
      // (unless the runner itself has left the road: then the last stretch may cross the verge)
      clear = geo.segBlocked(car.x, car.z, k.x, k.z, 0.3, true) >= 1;
      const kOff = geo.surfaceAt(k.x, k.z); const offOk = kOff !== 'road' && kOff !== 'lot' && kOff !== 'water';
      if (clear) for (let q = 1; q <= 3 && clear; q++) { const s = geo.surfaceAt(car.x + (k.x - car.x) * q / 4, car.z + (k.z - car.z) * q / 4); if (s === 'water' || (!offOk && s !== 'road' && s !== 'lot')) clear = false; }
    }
    if (clear) {
      D.mode = 'pit';
      const p = pitDrive(car, k, dist, opts);
      tx = p.tx; tz = p.tz; vT = Math.min(vMax, p.vT); brakeHard = p.brakeHard; direct = true;
    } else {
      if (D.mode === 'pit') { D.mode = 'route'; D.pit = 'approach'; D.replanT = 0; }
      // re-plan (≤ 2 Hz; sooner when the route ran out or we left it)
      const lost = D.route && (D.offRoute > 14 || D.routeLeft < 12);
      if (D.replanT <= 0 || !D.route || (lost && D.replanT < 0.6)) {
        let ok = false;
        if (role === 'cop') ok = k ? copPlan(car, k, dist) : false;
        else {
          const sp = stripAhead(opts.spikes, 160);
          if (sp < 160 && D.route) { G.locate(car.x, car.z, car.yaw, loc, 60); if (loc.road >= 0) for (let q = G.adjStart[loc.b]; q < G.adjStart[loc.b + 1]; q++) penal.set(G.adj[q], D.t + 25); D.goalT = 0; }
          if (!D.route || D.goalT <= 0 || D.routeLeft < 30 || (k && dist < 40 && D.replanT <= 0) || lost) { ok = runnerPlan(car, k); D.goalT = 7 + rnd() * 5; } else ok = true;
        }
        D.fails = ok ? 0 : D.fails + 1;
        D.replanT = ok ? (role === 'cop' ? (dist < 150 ? 0.5 : 0.9) : 0.8) : Math.min(3, 0.5 * (1 + D.fails));
      }
      const look = clamp(5 + car.speed * 0.42, 6, 26);
      if (follow(car, vMax, look)) {
        tx = tgt.x; tz = tgt.z; vT = Math.min(vMax, D.vCurve);
        // lane shift (overtaking) applied across the path direction
        if (D.laneShift) { const hx = tx - car.x; const hz = tz - car.z; const hl = Math.hypot(hx, hz) || 1; tx += (-hz / hl) * D.laneShift; tz += (hx / hl) * D.laneShift; }
        if (D.offRoute > 6) vT = Math.min(vT, 9 + 30 / D.offRoute); // getting back to the road: gently
        if (D.routeLeft < 30 && role === 'cop') vT = Math.min(vT, Math.max(k ? k.speed + 6 : 10, D.routeLeft * 0.8));
        // the runner ahead within 32 m (on my line, or across a corner I'm cutting): close at
        // +3..+14 m/s, tapering to +3 by 10 m, so the cop arrives on the quarter for a PIT instead
        // of a 100 km/h side-swipe (the bench had 13 rams to 3 PITs in 6 min of Hard chases)
        if (role === 'cop' && k && dist < 32 && lv.pit > 0) { const fx = Math.sin(car.yaw); const fz = -Math.cos(car.yaw); const lz = (k.x - car.x) * fx + (k.z - car.z) * fz; if (lz > 2) vT = Math.min(vT, k.speed + 3 + Math.max(0, dist - 10) * 0.5); }
      } else {
        // no route (yet): on a road, keep driving along it the way I'm facing, in my lane (a
        // runner that sat at a road point waiting for a plan was a sitting duck); off the road,
        // get back to the nearest road point (never a straight line at the runner)
        locateCar(car, loc, 60);
        if (loc.road >= 0 && loc.d < roads[loc.road].hw + 4) {
          const r = roads[loc.road];
          geo.sampleRoad(r, clamp(loc.s + loc.dir * look, 0, r.len), tmpS);
          const tx0 = tmpS.tx * loc.dir; const tz0 = tmpS.tz * loc.dir; const off = r.oneway ? 0 : (r.hw - (r.park || 0)) * 0.5;
          tx = tmpS.x - tz0 * off; tz = tmpS.z + tx0 * off; vT = Math.min(vMax, 15);
        } else {
          geo.nearestRoad(car.x, car.z, loc, 150);
          if (loc.road >= 0) { tx = loc.px; tz = loc.pz; vT = 10; } else { tx = car.x + Math.sin(car.yaw) * 20; tz = car.z - Math.cos(car.yaw) * 20; vT = 8; }
        }
      }
    }
    D.vWant = vT;
    // stuck in a jam: find another way round (the road ahead is penalised for a while)
    D.jamT = car.speed < 3 && D.tFree < 12 && D.vCurve > 6 ? (D.jamT || 0) + dt : 0;
    if (D.jamT > 1.6 && !direct) {
      D.jamT = -4;
      locateCar(car, loc, 60);
      if (loc.road >= 0) { const to = loc.dir > 0 ? loc.b : loc.a; const from = loc.dir > 0 ? loc.a : loc.b; for (let q = G.adjStart[from]; q < G.adjStart[from + 1]; q++) { const e = G.adj[q]; if (G.edges.to[e] === to) penal.set(e, D.t + 15); } }
      D.replanT = 0;
    }
    // traffic: follow, or slip into the clearest corridor (oncoming lane, either verge)
    if (!direct || dist > 12) {
      const tk = lv.traffic;
      const want = D.laneTarget || 0;
      D.laneShift += clamp(want - D.laneShift, -5 * dt, 5 * dt);
      if (D.creep) vT = Math.min(vT, 6);
      if (D.tFree < 70) { // never drive into what's in front of me right now
        const gapOk = D.tFree - (D.creep ? 3 : 7.5 * tk) - car.speed * 0.2;
        const vFollow = Math.sqrt(Math.max(0, Math.min(D.tLeadV, 40) ** 2 + 2 * 9 * Math.max(0, gapOk)));
        vT = Math.min(vT, vFollow);
        if (gapOk < 0 && car.speed > 3) brakeHard = true;
      }
    } else D.laneShift += clamp(-D.laneShift, -5 * dt, 5 * dt);
    if (direct && D.laneShift) { const hx = tx - car.x; const hz = tz - car.z; const hl = Math.hypot(hx, hz) || 1; tx += (-hz / hl) * D.laneShift; tz += (hx / hl) * D.laneShift; }
    D.vT = vT; D.tx = tx; D.tz = tz;
    // steer
    const p = pursue(car, tx, tz);
    out.steer = p.st; D.alpha = p.alpha;
    if (Math.abs(out.steer) > 0.05) D.lastSteer = out.steer;
    if (Math.abs(p.alpha) > 0.9 && car.speed > 6) vT = Math.min(vT, 10);
    // the way on is behind me and I'm slow: a three-point turn (back up on the opposite lock)
    // rather than a full-lock loop across the kerb and the oncoming lane
    if (D.kT > 0) {
      D.kT -= dt;
      if (Math.abs(p.alpha) < 1.1 || car.vf < -6) D.kT = 0;
      else { out.gas = 0; out.brake = 1; out.steer = D.kSteer; finish(t0); return out; }
    } else if (!direct && Math.abs(p.alpha) > 1.9 && car.speed < 7 && D.t - (D.kAt || -9) > 4 && (role === 'cop' || dist > 50)) {
      const bx = car.x - Math.sin(car.yaw) * 8; const bz = car.z + Math.cos(car.yaw) * 8;
      if (vergeBlocked(car.x, car.z, bx, bz) >= 1 && geo.surfaceAt(bx, bz) !== 'water') { D.kT = 1.8; D.kSteer = -Math.sign(p.alpha); D.kAt = D.t; out.gas = 0; out.brake = 1; out.steer = D.kSteer; finish(t0); return out; }
    }
    // throttle / brake
    const ev = vT - car.vf;
    if (brakeHard && car.vf > 0.5) { out.gas = 0; out.brake = 1; }
    else if (ev > 0.5) { out.gas = clamp(ev / 4, 0.3, 1); out.brake = 0; }
    else if (ev < -2.5) { out.gas = 0; out.brake = clamp(-ev / 8, 0.2, 1); }
    else { out.gas = ev > -0.5 ? 0.25 : 0; out.brake = 0; }
    // waiting: hold still on the handbrake (the brake pedal at a standstill is reverse: the AI used
    // to back away from the car it was queued behind at ~1 m/s, and a boxing cop off the runner)
    if (vT < 0.5 && car.speed < 1) { out.gas = 0; out.brake = 0; out.hand = true; }
    // a hairpin at speed: a dab of handbrake
    if (Math.abs(p.alpha) > 0.7 && car.speed > 15 && Math.abs(out.steer) > 0.8 && car.vf > vT + 3) out.hand = true;
    // nitro on a long clear straight
    if (Math.abs(out.steer) < 0.18 && car.speed > 18 && D.vCurve > 40 && D.tFree > 80 && car.nitro > 0.25) {
      if (role === 'runner' ? dist < 160 : dist > 60 && D.closeT <= 8) out.nitro = rnd() < lv.nitro + 0.2;
    }
    // runner: oil when the cop is on my bumper
    D.oilT -= dt;
    if (role === 'runner' && k && opts.oilLeft > 0 && D.oilT <= 0 && dist < 26 && dist > 6) {
      const fx = Math.sin(car.yaw); const fz = -Math.cos(car.yaw);
      if ((k.x - car.x) * fx + (k.z - car.z) * fz < -4 && Math.abs(wrap(k.yaw - car.yaw)) < 0.6) { out.oil = true; D.oilT = 10; }
    }
    // cop: spike strips on the runner's predicted route
    D.spikeT -= dt;
    if (role === 'cop' && k && D.spikeT <= 0 && (opts.spikesLeft || 0) > 0 && dist > 110 && dist < 380 && k.speed > 8) {
      const keep = opts.spikesLeft === 1 && dist < 250;
      if (!keep) {
        locateCar(k, loc2, 60);
        predictRoute(loc2, k.speed, 5, pts);
        const want = clamp(k.speed * 3.4, 60, 150);
        for (const q of pts) {
          const ahead = q.t * Math.max(8, k.speed);
          if (ahead < Math.max(want, k.speed * 1.2 + 20)) continue;
          if (q.t > 5) break;
          if (Math.hypot(q.x - car.x, q.z - car.z) > 395 || roads[q.road].bridge) continue;
          out.spike = { x: q.x, z: q.z }; D.spikeT = 10 + rnd() * 8; break;
        }
        if (!out.spike) D.spikeT = 1.5;
      } else D.spikeT = 3;
    }
    // stuck = wanting to go but not getting anywhere (also when boxed in by traffic, more patiently)
    // (held behind a stopped car with no way round it: that's stuck too, whatever the gap)
    watchdog(car, D.vWant > 4 && !brakeHard && (out.gas > 0.2 || D.tFree < 9 || D.blockT > lv.hold + 1.2), opts);
    finish(t0);
    return out;
  }
  function finish(t0) { if (t0) { const ms = performance.now() - t0; if (ms > D.stats.maxMs) D.stats.maxMs = ms; } }

  return {
    update, out, state: D, level,
    reset() { D.kT = 0; D.route = null; D.replanT = 0; D.goalT = 0; D.revT = 0; D.turnT = 0; D.stuckLvl = 0; D.mode = 'route'; D.pit = 'approach'; trail.length = 0; hist.length = 0; penal.clear(); D.known = null; },
  };
}
