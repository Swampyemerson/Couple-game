// Light Cycles: the pure simulation, shared by the host, the guest and the tests.
// Everything here is deterministic from (cfg, turn log): no Math.random(), no clocks.
//
// cfg = { L: 's'|'p'|'l', ar: arena, sd: seed, bo: 0|1 (boosts), sv: start variant (0 = the classic starts), rm: 'c'|'r' (speed curve) }
// occ cells: 0 free, 1 trail of A, 2 trail of B, 3 an arena block. tok cells: 1 boost token, 2 jump token.

export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const DIR = ['up', 'right', 'down', 'left'];
// s: computer (square, riders face off left/right). p: phone (portrait, bottom/top). l: phone on its side (wide and short, left/right).
// The classic starts sit on the centre line, an even distance apart, so riding straight on meets head-on.
export const LAYOUTS = {
  s: { W: 49, H: 49, a: [6, 24, 1], b: [42, 24, 3] },
  p: { W: 31, H: 45, a: [15, 39, 0], b: [15, 5, 2] },
  l: { W: 41, H: 27, a: [6, 13, 1], b: [34, 13, 3] },
};
export const ARENAS = ['classic', 'pillars', 'cross', 'rings', 'scatter'];
export const BOOST_TICKS = 8;
const TOK_BOOST = 1;
const TOK_JUMP = 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Milliseconds per tick. Classic keeps today's gentle curve; every other arena ramps 78 -> 50 ms over about 20 s. */
export function tickMs(cfg, t) {
  return cfg && cfg.rm === 'r' ? Math.max(50, 78 - 0.09 * t) : Math.max(70, 78 - 0.04 * t);
}

/** Start cells for a round: variant 0 is the classic fixed start, anything else a seeded, point-symmetric stagger. */
export function startsFor(L, sv, seed) {
  const g = LAYOUTS[L];
  if (!sv) return { a: g.a.slice(), b: g.b.slice() };
  const r = mulberry32(((seed | 0) ^ Math.imul(sv | 0, 0x9e3779b1)) >>> 0);
  const ri = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const cx = (g.W - 1) / 2;
  const cy = (g.H - 1) / 2;
  const a = L === 'p' ? [cx + ri(-8, 8), g.H - 1 - ri(4, 9), 0] : [ri(4, 9), cy + ri(-8, 8), 1];
  return { a, b: [g.W - 1 - a[0], g.H - 1 - a[1], (a[2] + 2) & 3] };
}

// ── arenas: blocks, always point-symmetric about the centre so neither rider is favoured ──
function blocks(L, ar, seed) {
  const { W, H } = LAYOUTS[L];
  const occ = new Uint8Array(W * H);
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const set = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    occ[y * W + x] = 3;
    occ[(H - 1 - y) * W + (W - 1 - x)] = 3;
  };
  const rect = (x, y, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j); };
  const horiz = L !== 'p'; // the riders approach along x
  if (ar === 'pillars') {
    const sz = Math.min(W, H) >= 45 ? 5 : 3;
    const ox = Math.round(W * 0.22);
    const oy = Math.round(H * 0.22);
    const h = (sz - 1) / 2;
    rect(cx - ox - h, cy - oy - h, sz, sz); // with its mirror: two opposite corners
    rect(cx - ox - h, cy + oy - h, sz, sz); // with its mirror: the other two
  } else if (ar === 'cross') {
    const la = Math.floor((horiz ? W : H) * 0.2); // the arm along the approach
    const lb = Math.floor((horiz ? H : W) * 0.38); // the arm across it
    const gb = Math.round(lb * 0.6);
    const ga = Math.round(la * 0.6);
    for (let k = 2; k <= lb; k++) if (Math.abs(k - gb) > 1) { if (horiz) set(cx, cy + k); else set(cx + k, cy); }
    for (let k = 2; k <= la; k++) if (Math.abs(k - ga) > 0) { if (horiz) set(cx + k, cy); else set(cx, cy + k); }
  } else if (ar === 'rings') {
    ring(set, W, H, cx, cy, Math.floor(W * 0.17), Math.floor(H * 0.17), +1);
    ring(set, W, H, cx, cy, Math.floor(W * 0.32), Math.floor(H * 0.32), -1);
  } else if (ar === 'scatter') {
    const r = mulberry32((seed ^ 0x5ca77e3) >>> 0);
    const n = Math.round((W * H) / 62);
    for (let i = 0; i < n; i++) {
      const x = 1 + Math.floor(r() * (W - 2));
      const y = 1 + Math.floor(r() * (H - 2));
      const k = r();
      const w = k < 0.2 ? 2 : 1;
      const h = k > 0.8 ? 2 : 1;
      rect(x, y, w, h);
    }
  }
  return occ;
}
function ring(set, W, H, cx, cy, rx, ry, sgn) {
  const gy = Math.round(ry * 0.45) * sgn; // gaps: one on a side column and one on a top row; each is mirrored to the far side
  const gx = Math.round(rx * 0.45) * -sgn;
  const cells = [];
  for (let x = cx - rx; x <= cx + rx; x++) for (const y of [cy - ry, cy + ry]) cells.push([x, y]);
  for (let y = cy - ry + 1; y < cy + ry; y++) for (const x of [cx - rx, cx + rx]) cells.push([x, y]);
  const near = (a, b) => Math.abs(a - b) <= 1;
  for (const [x, y] of cells) {
    const sideGap = (x === cx - rx && near(y, cy + gy)) || (x === cx + rx && near(y, cy - gy));
    const rowGap = (y === cy - ry && near(x, cx + gx)) || (y === cy + ry && near(x, cx - gx));
    if (!sideGap && !rowGap) set(x, y);
  }
}
/** The arena's blocks alone (picker previews and tests). */
export function arenaBlocks(L, ar, seed) { return { W: LAYOUTS[L].W, H: LAYOUTS[L].H, occ: blocks(L, ar, seed) }; }

function clearStarts(occ, W, H, st) {
  for (const p of ['a', 'b']) {
    const [x, y, d] = st[p];
    const lx = DX[(d + 1) & 3];
    const ly = DY[(d + 1) & 3];
    for (let f = -3; f <= 8; f++) {
      for (let l = -2; l <= 2; l++) {
        const X = x + DX[d] * f + lx * l;
        const Y = y + DY[d] * f + ly * l;
        if (X >= 0 && Y >= 0 && X < W && Y < H) occ[Y * W + X] = 0;
      }
    }
  }
}

function placeTokens(sim, seed) {
  const { W, H } = sim;
  const r = mulberry32((seed ^ 0xb005d) >>> 0);
  const big = W >= 45 && H >= 45;
  const kinds = [];
  for (let i = 0; i < (big ? 3 : 2); i++) kinds.push(TOK_BOOST);
  for (let i = 0; i < (big ? 2 : 1); i++) kinds.push(TOK_JUMP);
  const far = (x, y) => ['a', 'b'].every((p) => Math.max(Math.abs(sim[p].x - x), Math.abs(sim[p].y - y)) >= 6);
  for (const k of kinds) {
    for (let tries = 0; tries < 80; tries++) {
      const x = 1 + Math.floor(r() * (W - 2));
      const y = 1 + Math.floor(r() * (H - 2));
      const mx = W - 1 - x;
      const my = H - 1 - y;
      const i = y * W + x;
      const j = my * W + mx;
      if (i === j || sim.occ[i] || sim.occ[j] || sim.tok[i] || sim.tok[j] || !far(x, y) || !far(mx, my)) continue;
      sim.tok[i] = k; sim.tok[j] = k;
      sim.tl.push({ x, y, k }, { x: mx, y: my, k });
      break;
    }
  }
}

export function newSim(cfg) {
  const g = LAYOUTS[cfg.L];
  const { W, H } = g;
  const st = startsFor(cfg.L, cfg.sv | 0, cfg.sd | 0);
  const sim = {
    cfg, L: cfg.L, W, H, t: 0, st,
    occ: blocks(cfg.L, cfg.ar, cfg.sd | 0), tok: new Uint8Array(W * H), at: new Uint16Array(W * H),
    tl: [], pk: new Map(), ev: [], done: false, out: null,
  };
  clearStarts(sim.occ, W, H, st);
  for (const p of ['a', 'b']) {
    const [x, y, d] = st[p];
    sim[p] = { x, y, d, d0: d, alive: true, path: [x, y], pi: [0], crash: null, ck: '', boost: 0, jump: 0, sh: 0, srun: 0, sdir: -1, sflag: false };
    sim.occ[y * W + x] = p === 'a' ? 1 : 2;
  }
  if (cfg.bo) placeTokens(sim, cfg.sd | 0);
  return sim;
}
export const okTurn = (cur, d) => d !== cur && d !== ((cur + 2) & 3);
const other = (p) => (p === 'a' ? 'b' : 'a');

/** How the cell (x, y) looks to rider p's side feelers: 0 free, 1 outer wall, 2 opponent / block, 3 own trail. */
function feel(sim, p, x, y) {
  if (x < 0 || y < 0 || x >= sim.W || y >= sim.H) return 1;
  const v = sim.occ[y * sim.W + x];
  if (!v) return 0;
  return v === 3 || v === (p === 'a' ? 2 : 1) ? 2 : 3;
}

/** Advance one tick. turns = { a?: dir, b?: dir } (already validated). Boosted riders move two cells. */
export function step(sim, turns) {
  if (sim.done) return;
  const t = ++sim.t;
  const { W, H, occ } = sim;
  const nb = {};
  for (const p of ['a', 'b']) {
    const c = sim[p];
    if (turns && turns[p] != null) c.d = turns[p];
    nb[p] = c.boost > 0 ? 2 : 1;
    if (c.boost > 0) c.boost--;
  }
  let died = false;
  for (let sub = 0; sub < 2 && !died; sub++) {
    const movers = ['a', 'b'].filter((p) => sim[p].alive && (sub === 0 || nb[p] === 2));
    if (!movers.length) break;
    const nx = {};
    for (const p of movers) {
      const c = sim[p];
      const x = c.x + DX[c.d];
      const y = c.y + DY[c.d];
      const n = { x, y, hit: false, ck: '', pass: false };
      if (x < 0 || y < 0 || x >= W || y >= H) { n.hit = true; n.ck = 'wall'; } else {
        const v = occ[y * W + x];
        const o = sim[other(p)];
        if (o.x === x && o.y === y) { n.hit = true; n.ck = 'head'; } else if (v === 3) { n.hit = true; n.ck = 'block'; } else if (v) {
          if (c.jump > 0) n.pass = true;
          else { n.hit = true; n.ck = v === (p === 'a' ? 1 : 2) ? 'self' : (t - sim.at[y * W + x] <= 4 ? 'squeeze' : 'trail'); }
        }
      }
      nx[p] = n;
    }
    if (movers.length === 2) {
      const a = nx.a;
      const b = nx.b;
      const swap = a.x === sim.b.x && a.y === sim.b.y && b.x === sim.a.x && b.y === sim.a.y;
      if ((a.x === b.x && a.y === b.y) || swap) { a.hit = true; b.hit = true; a.ck = 'head'; b.ck = 'head'; a.pass = false; b.pass = false; }
    }
    for (const p of movers) {
      const c = sim[p];
      const n = nx[p];
      if (n.hit) { c.alive = false; c.crash = [n.x, n.y]; c.ck = n.ck; died = true; continue; }
      const i = n.y * W + n.x;
      c.x = n.x; c.y = n.y;
      c.path.push(n.x, n.y);
      if (n.pass) { c.jump = 0; sim.ev.push({ t, k: 'hop', p, x: n.x, y: n.y }); } else { occ[i] = p === 'a' ? 1 : 2; sim.at[i] = t; }
      if (sim.tok[i]) {
        const k = sim.tok[i];
        sim.tok[i] = 0;
        sim.pk.set(i, t);
        if (k === TOK_BOOST) c.boost = BOOST_TICKS; else c.jump = 1;
        sim.ev.push({ t, k: 'pick', p, x: n.x, y: n.y, tk: k });
      }
    }
    // near misses: riding alongside an opponent's trail or a block, or squeezed between two walls
    for (const p of movers) {
      const c = sim[p];
      if (!c.alive) continue;
      const l = (c.d + 3) & 3;
      const r = (c.d + 1) & 3;
      const sl = feel(sim, p, c.x + DX[l], c.y + DY[l]);
      const sr = feel(sim, p, c.x + DX[r], c.y + DY[r]);
      const tight = sl === 2 || sr === 2;
      const squeeze = tight && sl > 0 && sr > 0;
      if (tight) {
        if (c.sdir === c.d) c.srun++; else { c.srun = 1; c.sdir = c.d; c.sflag = false; }
      } else { c.srun = 0; c.sdir = -1; c.sflag = false; }
      if (tight && !c.sflag && (c.srun >= 3 || squeeze)) {
        c.sflag = true; c.sh++;
        sim.ev.push({ t, k: 'shave', p, x: c.x, y: c.y });
      }
    }
  }
  for (const p of ['a', 'b']) sim[p].pi.push(sim[p].path.length / 2 - 1);
  if (!sim.a.alive || !sim.b.alive) {
    sim.done = true;
    sim.out = sim.a.alive ? 'a' : sim.b.alive ? 'b' : 'd';
  }
}

// ── the turn log: "<tick base36><0-3 for A | 4-7 for B>" ──
export const enc = (e) => e.t.toString(36) + (e.p === 'a' ? e.d : e.d + 4);
export function decode(s) {
  if (!s) return [];
  return s.split(',').filter(Boolean).map((x) => { const k = +x.slice(-1); return { t: parseInt(x.slice(0, -1), 36), p: k < 4 ? 'a' : 'b', d: k & 3 }; });
}
/** Rebuild a round from its config plus its turn log, up to tick T. */
export function rebuild(cfg, entries, T) {
  const sim = newSim(cfg);
  let i = 0;
  while (sim.t < T && !sim.done) {
    const t = sim.t + 1;
    const turns = {};
    while (i < entries.length && entries[i].t <= t) { if (entries[i].t === t) turns[entries[i].p] = entries[i].d; i++; }
    step(sim, turns);
  }
  return sim;
}
const hashOf = (arr) => { let h = 7; for (const v of arr) h = (Math.imul(h, 31) + v) | 0; return h; };
export function summary(sim) {
  const one = (c) => ({ x: c.x, y: c.y, d: c.d, alive: c.alive, len: c.path.length / 2, hash: hashOf(c.path), crash: c.crash, ck: c.ck, sh: c.sh, boost: c.boost, jump: c.jump });
  return { L: sim.L, t: sim.t, done: sim.done, out: sim.out, obs: hashOf(sim.occ), toks: sim.tl.length, evs: sim.ev.length, a: one(sim.a), b: one(sim.b) };
}
/** True if the arena's blocks are point-symmetric about the centre (used by tests). */
export function isSymmetric(occ, W, H) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((occ[y * W + x] === 3) !== (occ[(H - 1 - y) * W + (W - 1 - x)] === 3)) return false;
  return true;
}

/** Where rider p was at the fractional tick T: the index of the last whole path point plus the exact (x, y) and heading. */
export function pathAt(sim, p, T) {
  const c = sim[p];
  const P = c.path;
  const last = P.length / 2 - 1;
  if (T >= sim.t) return { i: last, x: P[2 * last], y: P[2 * last + 1], d: c.d };
  if (T < 0) T = 0;
  const k = Math.floor(T);
  const q = c.pi[k] + (T - k) * (c.pi[k + 1] - c.pi[k]);
  const i = Math.floor(q);
  const g = q - i;
  const x0 = P[2 * i];
  const y0 = P[2 * i + 1];
  const dirOf = (xa, ya, xb, yb) => (xb > xa ? 1 : xb < xa ? 3 : yb > ya ? 2 : 0);
  if (g > 0 && 2 * i + 3 < P.length) {
    return { i, x: x0 + (P[2 * i + 2] - x0) * g, y: y0 + (P[2 * i + 3] - y0) * g, d: dirOf(x0, y0, P[2 * i + 2], P[2 * i + 3]) };
  }
  const d = i > 0 ? dirOf(P[2 * i - 2], P[2 * i - 1], x0, y0) : c.d0;
  return { i, x: x0, y: y0, d };
}
