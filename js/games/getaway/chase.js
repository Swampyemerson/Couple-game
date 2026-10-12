// Getaway chase extras, all pure (no DOM, no game state), so the unit tests can run them in Node:
// the Wanted level (a pure function of the round clock, so both phones agree), the cop's boost
// recharge, the cop's Hot Pursuit chain, the cop's quick-drop spots and the bumper kiss.
import { CAR } from './tune.js';
import { carContact } from './car.js';

// ── Wanted level ──
/** Seconds on the run at which the chase turns ★★ and ★★★ (a 2:30 round: 60 s and 100 s; shorter
 *  rounds escalate at 40% / 67% of their length, so a Quick chase still gets there). */
export const WANTED = { t2: 60, t3: 100, f2: 0.4, f3: 2 / 3 };
/** The cop's Wanted level 1..3 after t seconds on the run (roundTime: the round's length in s;
 *  thr: [t2, t3] to override the thresholds, tests). */
export function wantedLevel(t, roundTime = 150, thr = null) {
  const t2 = thr ? thr[0] : Math.min(WANTED.t2, roundTime * WANTED.f2);
  const t3 = thr ? thr[1] : Math.min(WANTED.t3, roundTime * WANTED.f3);
  return t >= t3 ? 3 : t >= t2 ? 2 : 1;
}
/** The stars shown for a level: none at level 1. */
export const wantedStars = (lvl) => (lvl >= 2 ? '★'.repeat(lvl) : '');
/** The cop's boost recharge (tank per second) from the Wanted level and a rules multiplier k (a
 *  round twist like BIG TANK feeds k): 20 s for a full tank, 14 s from ★★. */
export const COP_REGEN = { base: 1 / 20, wanted: 1 / 14 };
export function copRegen(level, k = 1) { return (level >= 2 ? COP_REGEN.wanted : COP_REGEN.base) * (k > 0 ? k : 1); }

// ── the cop's Hot Pursuit chain ──
/** close/far: metres; lose: s without line of sight that ends it; every: s per point while close;
 *  refill: tank per tier reached; spike/pit: points for those hits. */
export const CHAIN = { close: 30, far: 80, lose: 3, every: 2.5, refill: 0.25, spike: 3, pit: 2 };
const TIER_AT = [3, 6, 10];
export const CHAIN_TIERS = ['', 'CLOSING', 'HOT PURSUIT', 'RELENTLESS'];
export const chainTier = (n) => (n >= TIER_AT[2] ? 3 : n >= TIER_AT[1] ? 2 : n >= TIER_AT[0] ? 1 : 0);
export const chainNew = () => ({ n: 0, near: 0, lost: 0, tier: 0, best: 0, up: 0, ended: 0 });
export const chainReset = (c) => { c.n = 0; c.near = 0; c.lost = 0; c.tier = 0; c.best = 0; c.up = 0; c.ended = 0; return c; };
/** The chain's label: '×4 HOT PURSUIT'. */
export const chainText = (c) => (c.n > 0 ? `×${c.n}${c.tier ? ' ' + CHAIN_TIERS[c.tier] : ''}` : '');
/** Add pts to the chain. Returns the number of tiers it climbed (each one refills the boost). */
export function chainAdd(c, pts) {
  c.n += pts; if (c.n > c.best) c.best = c.n;
  const t = chainTier(c.n); const up = t > c.tier ? t - c.tier : 0; c.tier = t; return up;
}
/**
 * One step of the chain (the cop's own device). d: metres to the runner, los: the cop sees it. Within
 * 30 m with line of sight it earns a point every 2.5 s; more than 80 m away, or no line of sight
 * for over 3 s, ends it. Returns a bitmask: 1 a point earned, 2 a tier climbed (c.up = how many), 4 the chain ended.
 */
export function chainStep(c, dt, d, los) {
  let ev = 0; c.up = 0;
  if (d > CHAIN.far) { if (c.n > 0) { ev |= 4; c.ended = c.n; } c.n = 0; c.near = 0; c.lost = 0; c.tier = 0; return ev; }
  if (!los) { c.lost += dt; if (c.lost > CHAIN.lose) { if (c.n > 0) { ev |= 4; c.ended = c.n; } c.n = 0; c.near = 0; c.tier = 0; c.lost = CHAIN.lose; return ev; } c.near = 0; return ev; }
  c.lost = 0;
  if (d <= CHAIN.close) {
    c.near += dt;
    if (c.near >= CHAIN.every) { c.near -= CHAIN.every; c.up = chainAdd(c, 1); ev |= 1; if (c.up) ev |= 2; }
  } else c.near = 0;
  return ev;
}

// ── the cop's quick drop ──
/** Strip distances to try, nearest to the ideal first: 62 m, then 90, 40, and (when the runner is
 *  close ahead and those are inside its no-drop circle) 120 and 160. */
export const QUICK_DIST = [62, 90, 40, 120, 160];
/**
 * Candidate spots `dists` metres ahead of car c (x, z, yaw): along the road it is on, in its
 * direction of travel, or (past the end of that road, or off road) straight ahead along its heading;
 * placeSpike snaps either to the nearest road. geo: createGeo's nearestRoad / sampleRoad / roads.
 */
export function aheadPoints(geo, c, dists = QUICK_DIST, snap = 40) {
  const fx = Math.sin(c.yaw); const fz = -Math.cos(c.yaw);
  // the road the cruiser is on: the nearest one that runs the way it points (at a junction the crossing road can be nearer)
  const q = { road: -1 }; const skip = []; let on = null; let dir = 0; let s0 = 0;
  for (let k = 0; k < 3 && !on; k++) {
    geo.nearestRoad(c.x, c.z, q, snap, (r) => !r.bridge && skip.indexOf(r.idx) < 0);
    if (q.road < 0) break;
    const dot = fx * q.tx + fz * q.tz;
    if (Math.abs(dot) >= 0.5) { on = geo.roads[q.road]; dir = dot >= 0 ? 1 : -1; s0 = q.s; } else skip.push(q.road);
  }
  const tmp = {}; const out = [];
  for (const d of dists) {
    let x = c.x + fx * d; let z = c.z + fz * d; let road = false;
    if (on) { const s = s0 + dir * d; if (on.closed || (s > 6 && s < on.len - 6)) { geo.sampleRoad(on, s, tmp); x = tmp.x; z = tmp.z; road = true; } }
    out.push({ x, z, d, road });
  }
  return out;
}

// ── the bumper kiss ──
export const KISS = { speed: 3, grow: 0.3 };
const kA = { x: 0, z: 0, y: 0, yaw: 0, hl: 0, hw: 0 }; const kB = { x: 0, z: 0, y: 0, yaw: 0, hl: 0, hw: 0 }; const kCt = { pen: 0, nx: 0, nz: 0, px: 0, pz: 0, ia: 0, ib: 0 };
/** Two cars touching gently: their bodies (a hand's width bigger each) overlap and they close at under 3 m/s. */
export function isKiss(a, b, relSpeed) {
  if (!(relSpeed < KISS.speed)) return false;
  kA.x = a.x; kA.z = a.z; kA.y = a.y || 0; kA.yaw = a.yaw; kA.hl = CAR.hl + KISS.grow; kA.hw = CAR.hw + KISS.grow;
  kB.x = b.x; kB.z = b.z; kB.y = b.y || 0; kB.yaw = b.yaw; kB.hl = kA.hl; kB.hw = kA.hw;
  return carContact(kA, kB, kCt) > 0;
}
