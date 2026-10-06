// Rail Rush track generator. Pure and deterministic: chunk i of seed s is the same on every
// device and JS engine (only + - * / sqrt floor ceil are used on generated numbers), and each
// chunk is built independently. Every chunk carves a "safe path" that a runner can always follow,
// and coins trace it.
import { hash, rng } from '../core.js';
import {
  CHUNK, CAR, RAMP_L, ROOF, TRAIN_HW, LOW_H, HIGH_B, HIGH_T, BAR_HW, MT_K, MT_LEAD, GAP_L,
  LANE_W, LANE_TIME, V0, VMAX,
} from './tune.js';

export const O_LOW = 1;
export const O_HIGH = 2;
export const O_TRAIN = 3;
export const O_RAMP = 4;
export const O_MTRAIN = 5;
export const O_BLOCK = 6;

export const I_MAGNET = 1;
export const I_SNEAKERS = 2;
export const I_SHIELD = 3;
export const I_BOX = 4;
export const I_REVIVE = 5;

/** Expected running speed at distance d, a little on the fast side (m/s). */
export function designSpeed(d) {
  const v = Math.sqrt(V0 * V0 + 0.3 * (d > 0 ? d : 0));
  return v > VMAX ? VMAX : v;
}
/** 0 → 1 difficulty by distance, quantized so tiny float differences can't matter. */
export function difficulty(d) {
  const x = (d > 0 ? d : 0) / 700;
  return Math.floor((1 - 1 / (1 + x + x * x * 0.5)) * 64) / 64;
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
/** Surface height of a ramp at z. */
export function rampTop(o, z) {
  const k = (z - o.z0) / (o.z1 - o.z0);
  return ROOF * (k < 0 ? 0 : k > 1 ? 1 : k);
}

const ceil4 = (z) => Math.ceil(z / 4) * 4;

function makeObs(c, t, lane, z0, z1, extra) {
  const o = { id: c.i * 100 + c.obs.length, t, lane, z0, z1, b: 0, h: 0, hw: BAR_HW, walk: false, cars: 0, liv: 0, zm: 0, len: 0, side: 0 };
  if (t === O_LOW) { o.h = LOW_H; }
  else if (t === O_HIGH) { o.b = HIGH_B; o.h = HIGH_T; }
  else if (t === O_TRAIN || t === O_RAMP || t === O_MTRAIN) { o.h = ROOF; o.hw = TRAIN_HW; o.walk = true; }
  if (extra) Object.assign(o, extra);
  c.obs.push(o);
  return o;
}

/** Build chunk i for a seed. */
export function genChunk(seed, i) {
  const z0 = i * CHUNK;
  const z1 = z0 + CHUNK;
  const c = {
    i, z0, z1, diff: difficulty(z0), vd: designSpeed(z0 + CHUNK / 2),
    obs: [], gaps: [], coins: [], items: [], tunnel: null, path: [], scen: hash(seed, 'scen', i),
  };
  const r = rng(hash(seed, 'chunk', i));
  const sIn = safeLane(seed, i);
  const sOut = safeLane(seed, i + 1);
  const sec = (t) => t * c.vd;
  const X = { c, r, s: sIn, z: z0 + sec(0.45), lim: z1 - sec(0.5), diff: c.diff, sec, block: [-1e9, -1e9, -1e9], tunnel: false };
  c.path.push([z0, sIn]);

  if (i === 0) {
    // Warm-up straight: coins only (the tutorial plays here).
    coinLine(c, 0, 26, 74, 1.0, 3);
    c.path.push([z1, sOut]);
    return c;
  }
  if (i >= 3 && c.diff > 0.12 && r() < 0.2) { c.tunnel = [z0 + 3, z1 - 3]; X.tunnel = true; }
  if (i === 1) X.z = z0 + 30; // a little more warm-up

  const pats = [
    [pRow, () => 3],
    [pCorridor, () => 2],
    [pZigzag, (d) => (d > 0.1 ? 2 : 0.6)],
    [pRamp, (d) => (d > 0.05 ? 1.3 : 0.4)],
    [pGap, (d) => (d >= 0.12 ? 0.9 : 0)],
    [pBridge, (d) => (d >= 0.25 ? 0.7 : 0)],
    [pOncoming, (d) => (d >= 0.18 ? 2.2 : 0)],
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
  const zx = Math.max(X.z, z1 - sec(0.45));
  if (X.s !== sOut) {
    coinDiag(c, X.s, sOut, Math.min(X.z, z1 - 6), z1 - 1);
    c.path.push([Math.min(X.z, z1 - 6), sOut]);
  } else if (X.z < z1 - 8) coinLine(c, X.s * LANE_W, X.z, z1 - 2, 1.0, 3);
  void zx;
  c.path.push([z1, sOut]);

  placeItems(c, r, X);
  c.obs.sort((a, b) => a.z0 - b.z0);
  c.coins.sort((a, b) => a.z - b.z);
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
  const W = X.sec(LANE_TIME * d + 0.34);
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
    if (o.z1 < za || o.z0 > zb) continue;
    if (o.lane === l || (o.t === O_MTRAIN && o.lane === l)) return false;
    if (o.t === O_MTRAIN && o.lane === l) return false;
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

/** Stable text fingerprint of a chunk's gameplay layout (for determinism checks). */
export function chunkSig(c) {
  const f = (v) => Math.round(v * 1000);
  const o = c.obs.map((x) => [x.t, x.lane, f(x.z0), f(x.z1), x.cars, x.liv].join(',')).join(';');
  const g = c.gaps.map((x) => [f(x.z0), f(x.z1), x.mask].join(',')).join(';');
  const k = c.coins.map((x) => [f(x.x), f(x.z), f(x.y)].join(',')).join(';');
  const it = c.items.map((x) => [x.k, f(x.x), f(x.z)].join(',')).join(';');
  return `${c.i}|${o}|${g}|${k}|${it}|${c.tunnel ? c.tunnel.map(f).join(',') : ''}`;
}

/** Chunk cache for one seed. */
export function createTrack(seed) {
  const cache = new Map();
  return {
    seed,
    chunk(i) {
      if (i < 0) i = 0;
      let c = cache.get(i);
      if (!c) { c = genChunk(seed, i); cache.set(i, c); }
      return c;
    },
    /** Drop chunks before index i (keeps memory flat on long runs). */
    keepFrom(i) { for (const k of cache.keys()) if (k < i) cache.delete(k); },
    size: () => cache.size,
  };
}

/** Hash of the first n chunks' layouts. */
export function trackHash(seed, n) {
  let h = 0;
  for (let i = 0; i < n; i++) h = hash(h, chunkSig(genChunk(seed, i)));
  return h;
}
