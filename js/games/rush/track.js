// Rail Rush track generator. Pure and deterministic: chunk i of seed s is the same on every
// device and JS engine (only + - * / sqrt floor ceil are used on generated numbers), and each
// chunk is built independently. Every chunk carves a "safe path" that a runner can always follow,
// and coins trace it.
import { hash, rng } from '../core.js';
import {
  CHUNK, CAR, RAMP_L, ROOF, TRAIN_HW, LOW_H, HIGH_B, HIGH_T, BAR_HW, MT_K, MT_LEAD, GAP_L,
  LANE_W, LANE_TIME, V0, VMAX, BARREL_K, BARREL_LEAD, BARREL_D, BARREL_HW,
} from './tune.js';

export const O_LOW = 1;
export const O_HIGH = 2;
export const O_TRAIN = 3;
export const O_RAMP = 4;
export const O_MTRAIN = 5;
export const O_BLOCK = 6;
export const O_BARREL = 7;   // track v2: a rolling barrel (0.9 m, jump or swerve); static footprint [zm, zm + D/(1+K)] like an oncoming train's

export const I_MAGNET = 1;
export const I_SNEAKERS = 2;
export const I_SHIELD = 3;
export const I_BOX = 4;
export const I_REVIVE = 5;
export const I_NOTE = 6;     // track v2: the love-note envelope (once a run, chunks 4-8)
export const I_DOUBLE = 7;   // track v2: coin doubler (a converted magnet)

// Track v2 content (everything below is gated on ver >= 2; ver 1 output is byte for byte what it
// always was). Each piece draws from its own stream rng(hash(seed, '<stream>', i)).
export const EV_RUSH = 1;      // Coin Rush: a dense field of coins in every clear lane
export const EV_HUNDRED = 2;   // Golden Hundred: every coin in the chunk pays 2x
export const RUSH_LEN = 30;    // m of Coin Rush field
const RUSH_ROWS = 8;           // rows of coins (one per clear lane each): at most 24 coins
export const GOLD_V = 3;       // coin.v of a fool's-gold coin
export const GOLD_N = 5;       // coins in a fool's-gold branch
export const GOLD_LEN = 18;    // m a branch window spans
const GOLD_P = 0.35;           // per-chunk chance of a branch (chunks 3+)
const EVENT_P = 0.08;          // per-chunk chance of an event (chunks 4+), at least EVENT_GAP chunks apart
const EVENT_GAP = 6;
const DBL_P = 0.3;             // share of magnets that are doublers instead
const NOTE_FIRST = 4;          // the love note sits in one of chunks 4..8
const NOTE_SPAN = 5;
// Rolling barrels (track v2, stream 'barrel'): from difficulty 0.3 (~500 m), a barrel - or a pair in
// two lanes - rolls toward the runner. See placeBarrels.
export const BARREL_DIFF = 0.3;
const BARREL_P0 = 0.3;         // per-chunk chance at BARREL_DIFF …
const BARREL_P1 = 0.2;         // … plus this per unit of difficulty beyond it
const BARREL_PAIR = 0.6;       // share of placements that try a pair in two lanes (a single if no window fits two)

/** Expected running speed at distance d, a little on the fast side (m/s). */
export function designSpeed(d) {
  const v = Math.sqrt(V0 * V0 + 0.3 * (d > 0 ? d : 0));
  return v > VMAX ? VMAX : v;
}
/**
 * 0 → 1 difficulty by distance, quantized so tiny float differences can't matter. Gentle for the
 * first ~30 s (0.09 at 200 m, 0.16 at 300 m, 0.23 at 430 m, 0.36 at 600 m), then ramping (0.58 at
 * 1 km, 0.83 at 2 km). The midpoint sat at 850 m; at 1,000 m the 200–600 m hump where most first
 * runs died is softer.
 */
export function difficulty(d) {
  const x = (d > 0 ? d : 0) / 1000;
  return Math.floor((1 - 1 / (1 + 0.3 * x + 1.1 * x * x)) * 64) / 64;
}
/** The safe lane at the start of chunk i. */
export function safeLane(seed, i) {
  return i < 2 ? 0 : (hash(seed, 'safe', i) % 3) - 1;
}
/** Oncoming train: front z when the runner is at zr (the train runs toward -z). */
export function mtrainFront(o, zr) {
  if (zr < o.zm - MT_LEAD) return o.zm + MT_K * MT_LEAD;
  return o.zm - MT_K * (zr - o.zm);
}
/** Rolling barrel: front z when the runner is at zr (the barrel rolls toward -z; it waits at its start until the runner is BARREL_LEAD away). */
export function barrelFront(o, zr) {
  if (zr < o.zm - BARREL_LEAD) return o.zm + BARREL_K * BARREL_LEAD;
  return o.zm - BARREL_K * (zr - o.zm);
}
/** Surface height of a ramp at z. */
export function rampTop(o, z) {
  const k = (z - o.z0) / (o.z1 - o.z0);
  return ROOF * (k < 0 ? 0 : k > 1 ? 1 : k);
}

const ceil4 = (z) => Math.ceil(z / 4) * 4;
/** Warm-up rows in chunk 0 (track metres): jump, then roll. */
export const TUT_JUMP = 52;
export const TUT_ROLL = 84;

function makeObs(c, t, lane, z0, z1, extra) {
  const o = { id: c.i * 100 + c.obs.length, t, lane, z0, z1, b: 0, h: 0, hw: BAR_HW, walk: false, cars: 0, liv: 0, zm: 0, len: 0, side: 0, soft: 0 };
  if (t === O_LOW) { o.h = LOW_H; }
  else if (t === O_HIGH) { o.b = HIGH_B; o.h = HIGH_T; }
  else if (t === O_TRAIN || t === O_RAMP || t === O_MTRAIN) { o.h = ROOF; o.hw = TRAIN_HW; o.walk = true; }
  else if (t === O_BARREL) { o.h = BARREL_D; o.hw = BARREL_HW; }
  if (extra) Object.assign(o, extra);
  c.obs.push(o);
  return o;
}

// ── districts (scenery biomes) ──
// Purely visual: chunks 0-2 are Downtown, then zones of DISTRICT_ZONE chunks (400 m) walk a cycle
// through the six districts (step 1 or 5, i.e. coprime to 6, from a seeded offset), so a district
// never repeats back to back. Computed from its own hash, never from the chunk's r() stream, and
// not part of chunkSig / trackHash: gameplay is untouched.
export const DISTRICTS = [
  { id: 0, name: 'Downtown' },
  { id: 1, name: 'Harbour' },
  { id: 2, name: 'Greenway' },
  { id: 3, name: 'Old Town' },
  { id: 4, name: 'Neon Market' },
  { id: 5, name: 'Freight Yard' },
];
export const DISTRICT_FIRST = 3;  // chunks 0..2 are Downtown
export const DISTRICT_ZONE = 4;   // chunks per district zone
/** Seeded cycle { o: start district 1..5, s: step 1 | 5 } (allocates; cache it for per-frame use). */
export function districtSeq(seed) {
  const h = hash(seed, 'district');
  return { o: 1 + (h % 5), s: Math.floor(h / 8) % 2 ? 5 : 1 };
}
/** District id of chunk i for a cached sequence (pure arithmetic, no allocation). */
export function districtIn(seq, i) {
  if (i < DISTRICT_FIRST) return 0;
  const k = Math.floor((i - DISTRICT_FIRST) / DISTRICT_ZONE);
  const x = seq.o + seq.s * k;
  return x - Math.floor(x / 6) * 6;
}
/** District id of chunk i. */
export function districtOf(seed, i) { return districtIn(districtSeq(seed), i); }
/** District id at track position z (metres). */
export function districtAt(seed, z) { return districtOf(seed, Math.floor((z > 0 ? z : 0) / CHUNK)); }
/** True for the first chunk of a district zone after Downtown (it carries the district gate). */
export function isZoneStart(i) { return i >= DISTRICT_FIRST && (i - DISTRICT_FIRST) % DISTRICT_ZONE === 0; }
/** Fields every chunk carries (set last in genChunk, no r() use): bio, bioNext, zi (index in its zone), zoneStart. */
function tagDistrict(c, seed) {
  const seq = districtSeq(seed);
  c.bio = districtIn(seq, c.i);
  c.bioNext = districtIn(seq, c.i + 1);
  c.zi = c.i < DISTRICT_FIRST ? c.i : (c.i - DISTRICT_FIRST) % DISTRICT_ZONE;
  c.zoneStart = isZoneStart(c.i);
}

/**
 * Build chunk i for a seed. `ver` is the match's track version (default 1: today's output exactly);
 * ver >= 2 adds fool's-gold branches, events, the love note and doublers (see v2Content).
 * `opt.goldP` overrides the branch chance (Daily "Gold rush" doubles it); both devices must agree on it.
 */
export function genChunk(seed, i, ver = 1, opt = null) {
  const z0 = i * CHUNK;
  const z1 = z0 + CHUNK;
  const c = {
    i, z0, z1, diff: difficulty(z0), vd: designSpeed(z0 + CHUNK / 2),
    obs: [], gaps: [], coins: [], items: [], tunnel: null, path: [], scen: i === 0 ? hash('rush-start-line') : hash(seed, 'scen', i),
  };
  const r = rng(hash(seed, 'chunk', i));
  const sIn = safeLane(seed, i);
  const sOut = safeLane(seed, i + 1);
  const sec = (t) => t * c.vd;
  const X = { c, r, s: sIn, z: z0 + sec(0.3), lim: z1 - sec(0.35), diff: c.diff, sec, block: [-1e9, -1e9, -1e9], tunnel: false };
  c.path.push([z0, sIn]);

  if (i === 0) {
    // Warm-up straight (the tutorial plays here): coins pull you to the middle, then one row to
    // jump and one to roll under, across every lane. They're soft: a miss is a stumble, not a crash.
    coinLine(c, 0, 20, 40, 1.0, 3);
    for (let l = -1; l <= 1; l++) makeObs(c, O_LOW, l, TUT_JUMP, TUT_JUMP + 0.5, { soft: 1 });
    coinArc(c, 0, TUT_JUMP + 0.25, 9, 1.0, 1.25);
    coinLine(c, 0, TUT_JUMP + 8, TUT_ROLL - 8, 1.0, 3);
    for (let l = -1; l <= 1; l++) makeObs(c, O_HIGH, l, TUT_ROLL, TUT_ROLL + 0.4, { soft: 1 });
    coinLine(c, 0, TUT_ROLL - 5.2, TUT_ROLL + 5.2, 0.55, 2.6);
    coinLine(c, 0, TUT_ROLL + 9, 96, 1.0, 3);
    c.obs.sort((a, b) => a.z0 - b.z0);
    c.coins.sort((a, b) => a.z - b.z);
    c.path.push([z1, sOut]);
    if (ver >= 2) { for (const cn of c.coins) { cn.v = 1; cn.g = 0; } c.event = 0; c.eventZ = 0; }
    tagDistrict(c, seed);
    return c;
  }
  if (i >= 3 && c.diff > 0.12 && r() < 0.2) { c.tunnel = [z0 + 3, z1 - 3]; X.tunnel = true; }
  if (i === 1) X.z = z0 + 30; // a little more warm-up

  const pats = [
    [pRow, () => 3],
    [pCorridor, () => 2],
    [pZigzag, (d) => (d > 0.1 ? 2 : 0.6)],
    [pRamp, (d) => (d > 0.05 ? 1.8 : 0.5)],
    [pGap, (d) => (d >= 0.12 ? 0.9 : 0)],
    [pBridge, (d) => (d >= 0.25 ? 0.7 : 0)],
    [pOncoming, (d) => (d >= 0.18 ? (X.z < z0 + 30 ? 5 : 0.5) : 0)],
    [pSlalom, (d) => (d >= 0.4 ? 1.1 : 0)],
  ];
  for (let tries = 0; tries < 14 && X.z < X.lim - 1; tries++) {
    let tot = 0;
    for (const [, w] of pats) tot += w(X.diff);
    let q = r() * tot;
    let fn = pats[0][0];
    for (const [f, w] of pats) { q -= w(X.diff); if (q <= 0) { fn = f; break; } }
    if (!fn(X)) {
      // Didn't fit: fall back to a single row, else stop.
      if (!pRow(X)) break;
    }
  }
  // Exit: steer the safe path into the next chunk's entry lane through clear space.
  if (X.s !== sOut) {
    coinDiag(c, X.s, sOut, Math.min(X.z, z1 - 6), z1 - 1);
    c.path.push([Math.min(X.z, z1 - 6), sOut]);
  } else if (X.z < z1 - 8) coinLine(c, X.s * LANE_W, X.z, z1 - 2, 1.0, 3);
  c.path.push([z1, sOut]);

  placeItems(c, r, X);
  if (ver >= 2) v2Content(c, seed, opt);
  c.obs.sort((a, b) => a.z0 - b.z0);
  c.coins.sort((a, b) => a.z - b.z);
  tagDistrict(c, seed);
  return c;
}

/** Safe lane at z inside chunk c. */
export function pathLane(c, z) {
  let l = c.path[0][1];
  for (const [pz, pl] of c.path) { if (pz <= z) l = pl; else break; }
  return l;
}

// ── coins ──
function coinLine(c, x, za, zb, y, step = 2.6) {
  for (let z = za; z <= zb + 0.01; z += step) c.coins.push({ x, z, y });
}
function coinArc(c, x, zc, span, base, peak) {
  for (let k = 0; k <= 6; k++) {
    const u = k / 3 - 1;
    c.coins.push({ x, z: zc + u * span * 0.5, y: base + peak * (1 - u * u) });
  }
}
function coinDiag(c, la, lb, za, zb) {
  const n = 5;
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    c.coins.push({ x: (la + (lb - la) * u) * LANE_W, z: za + (zb - za) * u, y: 1.0 });
  }
}

const canPlace = (X, l, z) => z >= X.block[l + 1];
const others = (s) => (s === -1 ? [0, 1] : s === 0 ? [-1, 1] : [-1, 0]);
const lerp = (a, b, k) => a + (b - a) * k;

// ── patterns: each places obstacles around the safe lane X.s from X.z and advances X.z ──

function pRow(X) {
  const { c, r, s } = X;
  const z = X.z;
  if (z + 2 > X.lim) return false;
  const kinds = [0, 0, 0];
  if (r() < 0.32 + 0.45 * X.diff) kinds[s + 1] = r() < 0.5 ? 1 : 2;
  for (const l of others(s)) {
    if (!canPlace(X, l, z)) continue;
    const q = r();
    if (q < 0.42 + 0.3 * X.diff) kinds[l + 1] = r() < 0.5 ? 1 : 2;
    else if (q < 0.6 + 0.2 * X.diff && X.diff > 0.12) kinds[l + 1] = 3;
  }
  if (!kinds[0] && !kinds[1] && !kinds[2]) {
    const o = others(s);
    const l = o[r() < 0.5 ? 0 : 1];
    if (canPlace(X, l, z)) kinds[l + 1] = 1;
  }
  let end = z + 0.5;
  for (let l = -1; l <= 1; l++) {
    const k = kinds[l + 1];
    if (k === 1) makeObs(c, O_LOW, l, z, z + 0.5);
    else if (k === 2) makeObs(c, O_HIGH, l, z, z + 0.4);
    else if (k === 3) {
      let cars = 1 + (r() < 0.45 ? 1 : 0);
      while (cars > 0 && z + cars * CAR > X.lim) cars--;
      if (cars) { makeObs(c, O_TRAIN, l, z, z + cars * CAR, { cars, liv: Math.floor(r() * 4) }); end = Math.max(end, z + cars * CAR); }
      else makeObs(c, O_LOW, l, z, z + 0.5);
    }
  }
  const ks = kinds[s + 1];
  const x = s * LANE_W;
  if (ks === 1) coinArc(c, x, z + 0.25, 9, 1.0, 1.25);
  else if (ks === 2) coinLine(c, x, z - 5.2, z + 5.2, 0.55, 2.6);
  else coinLine(c, x, z - 7.8, z + 5.2, 1.0, 2.6);
  X.z = end + X.sec(lerp(1.05, 0.58, X.diff));
  return true;
}

function pCorridor(X) {
  const { c, r, s } = X;
  let cars = 2 + (r() < X.diff ? 1 : 0) + (r() < X.diff * 0.5 ? 1 : 0);
  const rampy = !X.tunnel && r() < 0.3;
  while (cars > 1 && X.z + cars * CAR + (rampy ? RAMP_L : 0) + 6 > X.lim) cars--;
  const z = X.z;
  if (z + cars * CAR + (rampy ? RAMP_L : 0) + 6 > X.lim) return false;
  const os = others(s).filter((l) => canPlace(X, l, z));
  if (!os.length) return false;
  const both = os.length === 2 && r() < 0.45 + 0.4 * X.diff;
  const ls = both ? os : [os[r() < 0.5 ? 0 : os.length - 1]];
  let end = z;
  let rampDone = false;
  for (const l of ls) {
    let zt = z + Math.floor(r() * 6);
    if (rampy && !rampDone) {
      rampDone = true;
      makeObs(c, O_RAMP, l, zt, zt + RAMP_L);
      for (let k = 1; k <= 3; k++) c.coins.push({ x: l * LANE_W, z: zt + k * 2.5, y: ROOF * (k * 2.5) / RAMP_L + 1.0 });
      zt += RAMP_L;
      coinLine(c, l * LANE_W, zt + 2, zt + cars * CAR - 3, ROOF + 1.0, 2.6);
    }
    const cl = Math.max(1, cars - (r() < 0.3 ? 1 : 0));
    makeObs(c, O_TRAIN, l, zt, zt + cl * CAR, { cars: cl, liv: Math.floor(r() * 4) });
    end = Math.max(end, zt + cl * CAR);
  }
  const x = s * LANE_W;
  if (X.diff > 0.25 && r() < X.diff) {
    const zb = z + 4 + (end - z - 8) * (0.3 + 0.4 * r());
    const low = r() < 0.5;
    makeObs(c, low ? O_LOW : O_HIGH, s, zb, zb + (low ? 0.5 : 0.4));
    coinLine(c, x, z, zb - 6, 1.0, 2.6);
    if (low) coinArc(c, x, zb + 0.25, 9, 1.0, 1.25); else coinLine(c, x, zb - 3, zb + 3, 0.55, 2.6);
    coinLine(c, x, zb + 6, end - 2, 1.0, 2.6);
  } else coinLine(c, x, z, end - 2, 1.0, 2.6);
  X.z = end + X.sec(0.55);
  return true;
}

function pZigzag(X) {
  const { c, r, s } = X;
  let s2;
  if (s === 0) s2 = r() < 0.5 ? -1 : 1;
  else if (X.diff > 0.45 && r() < 0.4) s2 = -s;
  else s2 = 0;
  const d = Math.abs(s2 - s);
  const n1 = 1 + (r() < X.diff ? 1 : 0);
  const n2 = 1 + (r() < X.diff ? 1 : 0);
  const L1 = n1 * CAR;
  const L2 = n2 * CAR;
  const W = X.sec((LANE_TIME > 0.15 ? LANE_TIME : 0.15) * d + 0.34); // generous: as if lane changes took 0.15 s
  const z = X.z;
  const zc = z + L1;
  const zw = zc + W;
  if (zw + L2 > X.lim) return false;
  for (let l = -1; l <= 1; l++) if (!canPlace(X, l, z)) return false;
  const third = [-1, 0, 1].find((l) => l !== s && l !== s2);
  // Segment 1: you can't be in s2 (or the lane between) yet.
  for (const l of others(s)) if (l === s2 || (d === 2 && l === 0) || r() < 0.5) makeObs(c, O_TRAIN, l, z, zc, { cars: n1, liv: Math.floor(r() * 4) });
  // Segment 2: you must have left s.
  for (const l of others(s2)) if (l === s || (l === third && r() < 0.45)) makeObs(c, O_TRAIN, l, zw, zw + L2, { cars: n2, liv: Math.floor(r() * 4) });
  coinLine(c, s * LANE_W, z + 1, zc - 2, 1.0, 2.6);
  coinDiag(c, s, s2, zc, zw);
  coinLine(c, s2 * LANE_W, zw + 2.6, zw + L2 - 2, 1.0, 2.6);
  c.path.push([zc, s2]);
  X.s = s2;
  X.z = zw + L2 + X.sec(0.5);
  return true;
}

function pRamp(X) {
  const { c, r, s } = X;
  if (X.tunnel || !canPlace(X, s, X.z)) return false;
  let cars = 3 + (r() < 0.5 ? 1 : 0) + (r() < X.diff * 0.5 ? 1 : 0);
  while (cars > 2 && X.z + RAMP_L + cars * CAR + X.sec(0.7) > X.lim) cars--;
  const z = X.z;
  const zt = z + RAMP_L;
  const zEnd = zt + cars * CAR;
  if (zEnd + X.sec(0.7) > X.lim) return false;
  makeObs(c, O_RAMP, s, z, zt);
  makeObs(c, O_TRAIN, s, zt, zEnd, { cars, liv: Math.floor(r() * 4) });
  let end = zEnd;
  for (const l of others(s)) {
    if (!canPlace(X, l, z)) continue;
    const q = r();
    if (q < 0.5) {
      const zs = zt + Math.floor(r() * 8) - 2;
      let cl = cars - 1 - (r() < 0.5 ? 1 : 0);
      if (cl < 1) cl = 1;
      makeObs(c, O_TRAIN, l, zs, zs + cl * CAR, { cars: cl, liv: Math.floor(r() * 4) });
      end = Math.max(end, zs + cl * CAR);
    } else if (q < 0.78) {
      const zb = z + 2 + Math.floor(r() * 10);
      makeObs(c, r() < 0.5 ? O_LOW : O_HIGH, l, zb, zb + 0.5);
    }
  }
  const x = s * LANE_W;
  for (let k = 1; k <= 3; k++) c.coins.push({ x, z: z + k * 2.5, y: ROOF * (k * 2.5) / RAMP_L + 1.0 });
  coinLine(c, x, zt + 2, zEnd - 2, ROOF + 1.0, 2.6);
  X.z = end + X.sec(0.7);
  return true;
}

function pGap(X) {
  const { c, s } = X;
  if (X.tunnel || X.diff < 0.12) return false;
  const zg = ceil4(X.z + X.sec(0.3));
  if (zg + GAP_L + 2 > X.lim) return false;
  c.gaps.push({ z0: zg, z1: zg + GAP_L, mask: 7 });
  coinArc(c, s * LANE_W, zg + GAP_L / 2, 10, 1.0, 1.3);
  X.z = zg + GAP_L + X.sec(0.65);
  return true;
}

function pBridge(X) {
  const { c, r, s } = X;
  if (X.tunnel || X.diff < 0.25) return false;
  const len = 4 * (5 + Math.floor(r() * 4));
  const zb = ceil4(X.z + X.sec(0.45));
  if (zb + len > X.lim) return false;
  let mask = 0;
  for (const l of others(s)) mask |= 1 << (l + 1);
  c.gaps.push({ z0: zb, z1: zb + len, mask });
  const x = s * LANE_W;
  if (X.diff > 0.5 && r() < 0.6) {
    const zo = zb + len * 0.5;
    const low = r() < 0.5;
    makeObs(c, low ? O_LOW : O_HIGH, s, zo, zo + 0.5);
    coinLine(c, x, zb, zo - 6, 1.0, 2.6);
    if (low) coinArc(c, x, zo + 0.25, 9, 1.0, 1.25); else coinLine(c, x, zo - 3, zo + 3, 0.55, 2.6);
  } else coinLine(c, x, zb, zb + len, 1.0, 2.6);
  X.z = zb + len + X.sec(0.5);
  return true;
}

function pOncoming(X) {
  const { c, r, s } = X;
  if (X.diff < 0.18) return false;
  const cars = 2;
  const L = cars * CAR;
  const Lr = L / (1 + MT_K);
  const os = others(s);
  const m = s !== 0 && r() < 0.6 ? 0 : os[r() < 0.5 ? 0 : 1];
  const zm = X.z + X.sec(0.25);
  const reserve = zm + MT_K * MT_LEAD + L + 1;
  if (reserve > X.lim) return false;
  if (!canPlace(X, m, X.z)) return false;
  makeObs(c, O_MTRAIN, m, zm, zm + Lr, { zm, len: L, cars, liv: 4 });
  X.block[m + 1] = reserve;
  const third = [-1, 0, 1].find((l) => l !== s && l !== m);
  if (r() < 0.4 + 0.3 * X.diff) makeObs(c, r() < 0.5 ? O_LOW : O_HIGH, third, zm + Lr * 0.5, zm + Lr * 0.5 + 0.5);
  coinLine(c, s * LANE_W, X.z, zm + Lr, 1.0, 2.6);
  X.z = zm + Lr + X.sec(0.5);
  return true;
}

function pSlalom(X) {
  const { c, r, s } = X;
  if (X.diff < 0.4) return false;
  const n = 2 + (r() < X.diff ? 1 : 0) + (r() < X.diff - 0.5 ? 1 : 0);
  const step = X.sec(0.64 + (1 - X.diff) * 0.25);
  const len = step * (n - 1) + 1;
  const z = X.z;
  if (z + len + 4 > X.lim) return false;
  let k = r() < 0.5 ? 1 : 2;
  const x = s * LANE_W;
  for (let j = 0; j < n; j++) {
    const zj = z + j * step;
    makeObs(c, k === 1 ? O_LOW : O_HIGH, s, zj, zj + (k === 1 ? 0.5 : 0.4));
    if (k === 1) coinArc(c, x, zj + 0.25, 8, 1.0, 1.2); else coinLine(c, x, zj - 2.6, zj + 2.6, 0.55, 2.6);
    k = 3 - k;
  }
  let end = z + len;
  if (X.diff > 0.6) {
    const cars = Math.ceil((len + 6) / CAR);
    if (z - 3 + cars * CAR <= X.lim) {
      for (const l of others(s)) {
        if (!canPlace(X, l, z)) continue;
        makeObs(c, O_TRAIN, l, z - 3, z - 3 + cars * CAR, { cars, liv: Math.floor(r() * 4) });
        end = Math.max(end, z - 3 + cars * CAR);
      }
    }
  } else {
    for (const l of others(s)) if (canPlace(X, l, z) && r() < 0.5) makeObs(c, r() < 0.5 ? O_LOW : O_HIGH, l, z + step * 0.5, z + step * 0.5 + 0.5);
  }
  X.z = end + X.sec(0.6);
  return true;
}

// ── items ──
function laneClear(c, l, za, zb) {
  for (const o of c.obs) {
    if (o.lane !== l) continue;
    const e = o.t === O_MTRAIN ? o.zm + MT_K * MT_LEAD + o.len : o.t === O_BARREL ? o.zm + BARREL_K * BARREL_LEAD + o.len : o.z1;
    if (e >= za && o.z0 <= zb) return false;
  }
  for (const g of c.gaps) if (g.z1 >= za && g.z0 <= zb && (g.mask & (1 << (l + 1)))) return false;
  return true;
}
function placeItems(c, r, X) {
  // Power-up on the safe path.
  if (c.i >= 1 && r() < 0.34) {
    const q = r();
    const k = q < 0.38 ? I_MAGNET : q < 0.68 ? I_SNEAKERS : I_SHIELD;
    for (let t = 0; t < 6; t++) {
      const z = c.z0 + 8 + Math.floor(r() * (CHUNK - 16));
      const l = pathLane(c, z);
      if (laneClear(c, l, z - 6, z + 6)) { c.items.push({ k, x: l * LANE_W, z, y: 1.15 }); break; }
    }
  }
  // A row of weapon boxes across all lanes (used in Race).
  if (c.i >= 1 && r() < 0.8) {
    for (let t = 0; t < 8; t++) {
      const z = c.z0 + 6 + Math.floor(r() * (CHUNK - 12));
      if (laneClear(c, -1, z - 7, z + 7) && laneClear(c, 0, z - 7, z + 7) && laneClear(c, 1, z - 7, z + 7) && !c.items.some((it) => Math.abs(it.z - z) < 8)) {
        for (let l = -1; l <= 1; l++) c.items.push({ k: I_BOX, x: l * LANE_W, z, y: 1.15 });
        break;
      }
    }
  }
  c.items.sort((a, b) => a.z - b.z);
  void X;
}

// ── track v2 content ──
/** True if any gap (any lane, bridges included) touches [za, zb]. */
function anyGap(c, za, zb) {
  for (const g of c.gaps) if (g.z1 >= za && g.z0 <= zb) return true;
  return false;
}
/** True if a coin already sits in lane l within [za, zb]. */
function coinIn(c, l, za, zb) {
  const x = l * LANE_W;
  for (const cn of c.coins) if (cn.z >= za && cn.z <= zb && cn.x > x - 1.3 && cn.x < x + 1.3) return true;
  return false;
}
/** The event raw roll for chunk i (its own stream). */
function eventRaw(seed, i) { return i >= 4 && rng(hash(seed, 'event', i))() < EVENT_P; }
/**
 * Event of chunk i (0 none, EV_RUSH, EV_HUNDRED): a pure function of (seed, i) with no event raw
 * roll in the EVENT_GAP-1 chunks before it, so events are at least EVENT_GAP chunks apart.
 * (A Coin Rush that finds no clear window simply doesn't happen; it still spaces its neighbours.)
 */
export function eventOf(seed, i) {
  if (!eventRaw(seed, i)) return 0;
  for (let j = i - EVENT_GAP + 1; j < i; j++) if (j >= 4 && eventRaw(seed, j)) return 0;
  const g = rng(hash(seed, 'event', i));
  g();
  return g() < 0.6 ? EV_RUSH : EV_HUNDRED;
}
/** The chunk (4..8) that carries the love note. */
export function noteChunk(seed) { return NOTE_FIRST + (hash(seed, 'note') % NOTE_SPAN); }

function v2Content(c, seed, opt) {
  const i = c.i;
  placeBarrels(c, seed); // first: later placements (coins, notes, gold) see the barrels through laneClear
  for (const cn of c.coins) { cn.v = 1; cn.g = 0; }
  c.event = 0; c.eventZ = 0;
  const ev = c.tunnel ? 0 : eventOf(seed, i);
  if (ev === EV_RUSH) placeRush(c, seed);
  if (ev && !c.event) { c.event = EV_HUNDRED; c.eventZ = c.z0; } // (no clear window for a Coin Rush: a Golden Hundred instead)
  if (i >= 3 && c.event !== EV_HUNDRED) placeGold(c, seed, opt && opt.goldP > 0 ? opt.goldP : GOLD_P);
  if (i === noteChunk(seed)) placeNote(c, seed);
  const dg = rng(hash(seed, 'dbl', i));
  for (const it of c.items) if (it.k === I_MAGNET && dg() < DBL_P) it.k = I_DOUBLE;
  if (c.event === EV_HUNDRED) for (const cn of c.coins) cn.v *= 2;
  c.items.sort((a, b) => a.z - b.z);
}

/**
 * Coin Rush: RUSH_ROWS rows of coins over a stretch (RUSH_LEN m, shrinking to 24 / 18 m if the chunk
 * is busy) in every lane that is clear over it, never across a gap. The track is busy enough that
 * all three lanes are almost never clear for 24 m, so in practice it is a two-lane carpet beside
 * (and around) the path coins.
 */
function placeRush(c, seed) {
  const g = rng(hash(seed, 'event', c.i));
  g(); g();
  const k0 = g();
  for (const len of [RUSH_LEN, 24, 18]) {
    const n = Math.floor((CHUNK - 14 - len) / 2) + 1; // candidate starts, 2 m apart
    const k1 = Math.floor(k0 * n);
    for (let t = 0; t < n; t++) {
      const zs = c.z0 + 6 + 2 * ((k1 + t) % n);
      const za = zs - 1.5;
      const zb = zs + len + 1.5;
      if (anyGap(c, zs - 4, zs + len + 4)) continue;
      const lanes = [];
      for (let l = -1; l <= 1; l++) if (laneClear(c, l, za, zb)) lanes.push(l);
      if (lanes.length < 2) continue;
      const step = len / RUSH_ROWS;
      for (const l of lanes) {
        for (let k = 0; k < RUSH_ROWS; k++) {
          const z = zs + k * step;
          if (!coinIn(c, l, z - 1.4, z + 1.4)) c.coins.push({ x: l * LANE_W, z, y: 1.0, v: 1, g: 0 });
        }
      }
      c.event = EV_RUSH; c.eventZ = zs;
      return;
    }
  }
}

/**
 * Rolling barrels: a barrel (or a pair in two lanes, forcing a jump or the third lane) rolls toward
 * the runner. Its footprint is the static interval [zm, zm + D/(1+K)] like an oncoming train's, so it is
 * the same on every device; it is 0.9 m tall (a normal jump clears it, a lane change dodges it) and
 * can sit in the safe-path lane, where it is just a jumpable obstacle. Placed in a separate pass into
 * a window that is clear in its lane (obstacles, gaps and items; the lane stays clear for the whole
 * roll-in, BARREL_K x BARREL_LEAD m past the footprint, so it never rolls through anything) with the
 * path lane constant around it (no lane change within 1.2 s before or 0.8 s after) and inside the
 * chunk, so neighbouring chunks never interact with it.
 */
function placeBarrels(c, seed) {
  if (c.i < 3 || c.diff < BARREL_DIFF) return;
  const g = rng(hash(seed, 'barrel', c.i));
  if (!(g() < BARREL_P0 + BARREL_P1 * (c.diff - BARREL_DIFF))) return;
  const pair = g() < BARREL_PAIR;
  const lane0 = Math.floor(g() * 3); // single: the lane tried first; pair: the lane left out first
  const k0 = g();
  const sec = (t) => t * c.vd;
  const Lr = BARREL_D / (1 + BARREL_K);
  const roll = BARREL_K * BARREL_LEAD + BARREL_D; // how far past the footprint the barrel waits before it rolls
  const zmin = c.z0 + sec(1.2);
  const zmax = Math.min(c.z1 - sec(0.8) - Lr, c.z1 - sec(0.3) - roll - 0.5);
  const n = Math.floor((zmax - zmin) / 2) + 1;
  if (n < 1) return;
  const start = Math.floor(k0 * n);
  const fits = (l, zb) => {
    if (!laneClear(c, l, zb - sec(0.9), zb + roll + 0.5)) return false;
    const x = l * LANE_W;
    for (const it of c.items) if (it.z > zb - 4 && it.z < zb + Lr + 4 && Math.abs(it.x - x) < 1.4) return false;
    return true;
  };
  for (let two = pair ? 1 : 0; two >= 0; two--) { // a pair if a window has two clear lanes, else a single
    for (let t = 0; t < n; t++) {
      const zb = zmin + 2 * ((start + t) % n);
      let moved = false;
      for (const [pz] of c.path) if (pz > zb - sec(1.2) && pz < zb + Lr + sec(0.8)) moved = true;
      if (moved) continue;
      let ls = null;
      for (let a = 0; a < 3 && !ls; a++) {
        const l = ((lane0 + a) % 3) - 1;
        if (!two) { if (fits(l, zb)) ls = [l]; continue; }
        const ol = others(l); // (the lane left out is l)
        if (fits(ol[0], zb) && fits(ol[1], zb)) ls = ol;
      }
      if (!ls) continue;
      const pl = pathLane(c, zb);
      for (const l of ls) {
        makeObs(c, O_BARREL, l, zb, zb + Lr, { zm: zb, len: BARREL_D, cars: 0 });
        if (l === pl) { // coins arc over it
          const x = l * LANE_W;
          c.coins = c.coins.filter((cn) => !(cn.x > x - 1.3 && cn.x < x + 1.3 && cn.z > zb - 4.8 && cn.z < zb + Lr + 4.8));
          coinArc(c, x, zb + Lr / 2, 9, 1.0, 1.25);
        }
      }
      return;
    }
  }
}

/** Fool's gold: GOLD_N coins worth GOLD_V each along a non-path lane, in a window clear of everything. */
function placeGold(c, seed, p) {
  const g = rng(hash(seed, 'gold', c.i));
  if (!(g() < p)) return;
  const rl = g() < 0.5 ? 0 : 1;
  const n = Math.floor((CHUNK - 16 - GOLD_LEN) / 2) + 1; // candidate starts, 2 m apart
  const k0 = Math.floor(g() * n);
  for (let t = 0; t < n; t++) {
    const zs = c.z0 + 8 + 2 * ((k0 + t) % n);
    const za = zs - 2;
    const zb = zs + GOLD_LEN + 2;
    if (anyGap(c, zs - 4, zb + 4)) continue;
    // a non-path lane that stays non-path (and clear) over the whole window and the lane changes around it
    const os = others(pathLane(c, zs));
    for (let k = 0; k < 2; k++) {
      const l = os[(k + rl) % 2];
      if (pathLane(c, za - 4) === l || pathLane(c, zb + 4) === l) continue;
      let off = true;
      for (const [pz, pl] of c.path) if (pz >= za - 4 && pz <= zb + 4 && pl === l) off = false;
      if (!off || !laneClear(c, l, za, zb) || coinIn(c, l, za, zb)) continue;
      if (c.items.some((it) => it.z > za && it.z < zb && Math.abs(it.x - l * LANE_W) < 1.4)) continue;
      for (let j = 0; j < GOLD_N; j++) c.coins.push({ x: l * LANE_W, z: zs + (j * GOLD_LEN) / (GOLD_N - 1), y: 1.0, v: GOLD_V, g: j === 2 ? 1 : 0 });
      return;
    }
  }
}

/** The love note: on the safe path in a clear stretch (no gap nearby), 4 m from other items; margins relax if the chunk is busy. */
function placeNote(c, seed) {
  const g = rng(hash(seed, 'notez', c.i));
  const n = 20;
  const k0 = Math.floor(g() * n);
  for (const m of [7, 4.5, 3]) {
    for (let t = 0; t < n; t++) {
      const z = c.z0 + 8 + 4 * ((k0 + t) % n);
      const l = pathLane(c, z);
      if (pathLane(c, z - m) !== l || pathLane(c, z + m) !== l) continue;
      if (!laneClear(c, l, z - m, z + m) || anyGap(c, z - m - 2, z + m + 2)) continue;
      if (c.items.some((it) => Math.abs(it.z - z) < 4)) continue;
      c.items.push({ k: I_NOTE, x: l * LANE_W, z, y: 1.15 });
      return;
    }
  }
}

/** Stable text fingerprint of a chunk's gameplay layout (for determinism checks). */
export function chunkSig(c, ver = 1) {
  const f = (v) => Math.round(v * 1000);
  const o = c.obs.map((x) => [x.t, x.lane, f(x.z0), f(x.z1), x.cars, x.liv].join(',')).join(';');
  const g = c.gaps.map((x) => [f(x.z0), f(x.z1), x.mask].join(',')).join(';');
  const v2 = ver >= 2;
  const k = c.coins.map((x) => (v2 ? [f(x.x), f(x.z), f(x.y), x.v, x.g] : [f(x.x), f(x.z), f(x.y)]).join(',')).join(';');
  const it = c.items.map((x) => [x.k, f(x.x), f(x.z)].join(',')).join(';');
  return `${c.i}|${o}|${g}|${k}|${it}|${c.tunnel ? c.tunnel.map(f).join(',') : ''}${v2 ? `|${c.event},${f(c.eventZ)}` : ''}`;
}

/** Chunk cache for one seed (ver = the match's track version, opt = genChunk's options). */
export function createTrack(seed, ver = 1, opt = null) {
  const cache = new Map();
  return {
    seed, ver,
    chunk(i) {
      if (i < 0) i = 0;
      let c = cache.get(i);
      if (!c) { c = genChunk(seed, i, ver, opt); cache.set(i, c); }
      return c;
    },
    /** Drop chunks before index i (keeps memory flat on long runs). */
    keepFrom(i) { for (const k of cache.keys()) if (k < i) cache.delete(k); },
    size: () => cache.size,
  };
}

/** Hash of the first n chunks' layouts (ver 1 = today's hash exactly). */
export function trackHash(seed, n, ver = 1) {
  let h = 0;
  for (let i = 0; i < n; i++) h = hash(h, chunkSig(genChunk(seed, i, ver), ver));
  return h;
}
