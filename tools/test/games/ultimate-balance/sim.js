'use strict';
// Fast Ultimate Tic-Tac-Toe simulator + bots. Players are 0 (first / 'a') and 1 (second / 'b').
// State: Int32Array. Move encoding: b*9+i.
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const LMASK = LINES.map((L) => (1 << L[0]) | (1 << L[1]) | (1 << L[2]));
const WIN = new Uint8Array(512);      // 3 in a line within the mask
const CAN = new Uint8Array(512);      // some line is disjoint from mask (mask = cells blocked for this player)
const POP = new Uint8Array(512);
const WINCELL = new Uint16Array(512); // empty-or-not cells c with WIN[mask|c] and c not in mask
for (let m = 0; m < 512; m++) {
  WIN[m] = LMASK.some((l) => (m & l) === l) ? 1 : 0;
  CAN[m] = LMASK.some((l) => (m & l) === 0) ? 1 : 0;
  let c = 0; for (let k = 0; k < 9; k++) if (m >> k & 1) c++;
  POP[m] = c;
  let w = 0; for (let k = 0; k < 9; k++) if (!(m >> k & 1) && WIN[m | (1 << k)]) w |= 1 << k;
  WINCELL[m] = w;
}
// indices
const XM = 0, OM = 9, WA = 18, WB = 19, WD = 20, FORCE = 21, TURN = 22, END = 23, PLY = 24, SZ = 26;
const cfg = { komi: false, hotA: 0, hotB: 0 }; // hot: bitmask of small boards that count double at a count ending
 // komi: count-tie -> player 1 (second player) wins

function newState() { const s = new Int32Array(SZ); s[FORCE] = -1; return s; }

function legalMoves(S, out) {
  let n = 0;
  const closed = S[WA] | S[WB] | S[WD];
  const f = S[FORCE];
  const b0 = f >= 0 ? f : 0, b1 = f >= 0 ? f : 8;
  for (let b = b0; b <= b1; b++) {
    if (closed >> b & 1) continue;
    let e = ~(S[XM + b] | S[OM + b]) & 511;
    while (e) { const low = e & -e; out[n++] = b * 9 + (31 - Math.clz32(low)); e ^= low; }
  }
  return n;
}
function isLegal(S, b, i) {
  if (S[END]) return false;
  const f = S[FORCE];
  if (f >= 0 && f !== b) return false;
  if ((S[WA] | S[WB] | S[WD]) >> b & 1) return false;
  return !((S[XM + b] | S[OM + b]) >> i & 1);
}
// apply (assumes legal)
function step(S, b, i) {
  const t = S[TURN];
  const mine = (t ? OM : XM) + b;
  const m = S[mine] | (1 << i);
  S[mine] = m;
  if (WIN[m]) S[WA + t] |= 1 << b;
  else if ((m | S[(t ? XM : OM) + b]) === 511) S[WD] |= 1 << b;
  S[FORCE] = ((S[WA] | S[WB] | S[WD]) >> i & 1) ? -1 : i;
  S[TURN] = t ^ 1;
  S[PLY]++;
  const wa = S[WA], wb = S[WB], wd = S[WD];
  if (WIN[wa]) S[END] = 1;
  else if (WIN[wb]) S[END] = 2;
  else if (!CAN[wb | wd] && !CAN[wa | wd]) {
    const pa = POP[wa] + POP[wa & cfg.hotA], pb = POP[wb] + POP[wb & cfg.hotB];
    S[END] = pa > pb ? 1 : pb > pa ? 2 : (cfg.komi ? 2 : 3);
  }
}

// xorshift rng
function makeRng(seed) {
  let x = (seed ^ 0x9e3779b9) | 0 || 1;
  for (let k = 0; k < 8; k++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; }
  const f = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  return f;
}

const MV = new Int16Array(96);
// playout policy: take an immediate small-board win if one is available, else uniform random move
function playout(S, rnd) {
  while (!S[END]) {
    const t = S[TURN];
    const base = t ? OM : XM, opp = t ? XM : OM;
    const closed = S[WA] | S[WB] | S[WD];
    const f = S[FORCE];
    const b0 = f >= 0 ? f : 0, b1 = f >= 0 ? f : 8;
    let nw = 0, tot = 0;
    for (let b = b0; b <= b1; b++) {
      if (closed >> b & 1) continue;
      const mm = S[base + b], om = S[opp + b];
      const empty = ~(mm | om) & 511;
      const w = WINCELL[mm] & empty;
      if (w) { let x = w; while (x) { const low = x & -x; MV[nw++] = b * 9 + (31 - Math.clz32(low)); x ^= low; } }
      tot += POP[empty];
    }
    let mv;
    if (nw) mv = MV[(rnd() * nw) | 0];
    else {
      let r = (rnd() * tot) | 0;
      for (let b = b0; b <= b1; b++) {
        if (closed >> b & 1) continue;
        const e = ~(S[base + b] | S[opp + b]) & 511;
        const p = POP[e];
        if (r >= p) { r -= p; continue; }
        let x = e; while (r--) x &= x - 1;
        mv = b * 9 + (31 - Math.clz32(x & -x));
        break;
      }
    }
    step(S, (mv / 9) | 0, mv % 9);
  }
  return S[END];
}

// ---------------- MCTS (UCT) ----------------
let CAP = 0, par, mvOf, plOf, vis, win, fc, nc;
function ensure(cap) {
  if (cap <= CAP) return;
  CAP = cap;
  par = new Int32Array(cap); mvOf = new Int16Array(cap); plOf = new Uint8Array(cap);
  vis = new Int32Array(cap); win = new Float32Array(cap); fc = new Int32Array(cap); nc = new Int16Array(cap);
}
const WS = new Int32Array(SZ), PATH = new Int32Array(128), TMV = new Int16Array(96);
const UCT_C = 0.8;
/** returns {move, value (win prob for side to move), visits}. rootMoves: optional allowed moves (Int16Array/array). */
function mcts(root, budget, rnd, rootMoves) {
  ensure(budget * 24 + 2000);
  const cap = CAP;
  let used = 1;
  par[0] = -1; vis[0] = 0; win[0] = 0; fc[0] = -1; nc[0] = 0; plOf[0] = root[TURN] ^ 1;
  for (let it = 0; it < budget; it++) {
    WS.set(root);
    let node = 0, depth = 0, res = 0;
    PATH[0] = 0;
    for (;;) {
      if (fc[node] < 0) {
        if ((node === 0 || vis[node] > 0) && used + 81 < cap) {
          let n;
          if (node === 0 && rootMoves) { n = rootMoves.length; for (let k = 0; k < n; k++) TMV[k] = rootMoves[k]; } else n = legalMoves(WS, TMV);
          fc[node] = used; nc[node] = n;
          const pl = WS[TURN];
          for (let k = 0; k < n; k++) { const c = used + k; par[c] = node; mvOf[c] = TMV[k]; plOf[c] = pl; vis[c] = 0; win[c] = 0; fc[c] = -1; nc[c] = 0; }
          used += n;
        } else { res = playout(WS, rnd); break; }
      }
      // select child
      const f0 = fc[node], n = nc[node];
      let pick = -1;
      const st = (rnd() * n) | 0;
      for (let k = 0; k < n; k++) { const c = f0 + ((st + k) % n); if (vis[c] === 0) { pick = c; break; } }
      if (pick < 0) {
        const lg = UCT_C * Math.sqrt(Math.log(vis[node]));
        let best = -1;
        for (let k = 0; k < n; k++) {
          const c = f0 + k;
          const v = win[c] / vis[c] + lg / Math.sqrt(vis[c]) + rnd() * 1e-6;
          if (v > best) { best = v; pick = c; }
        }
      }
      const m = mvOf[pick];
      step(WS, (m / 9) | 0, m % 9);
      node = pick; PATH[++depth] = node;
      if (WS[END]) { res = WS[END]; break; }
      if (vis[node] === 0) { res = playout(WS, rnd); break; }
    }
    for (let d = depth; d >= 0; d--) {
      const nd = PATH[d];
      vis[nd]++;
      win[nd] += res === 3 ? 0.5 : (res - 1 === plOf[nd] ? 1 : 0);
    }
  }
  // most visited child
  const f0 = fc[0], n = nc[0];
  let best = -1, bv = -1, ties = 0;
  for (let k = 0; k < n; k++) {
    const c = f0 + k;
    if (vis[c] > bv) { bv = vis[c]; best = c; ties = 1; } else if (vis[c] === bv && rnd() * (++ties) < 1) best = c;
  }
  return { move: mvOf[best], value: vis[best] ? win[best] / vis[best] : 0.5, visits: bv };
}

// ---------------- heuristic bot (2-ply) ----------------
function evalH(S, p) { // from player p's view, static
  const q = p ^ 1;
  if (S[END]) return S[END] === 3 ? 0 : (S[END] - 1 === p ? 1e4 : -1e4);
  const wm = S[WA + p], wo = S[WA + q], wd = S[WD];
  let v = 14 * (POP[wm] - POP[wo]);
  // big lines
  for (let l = 0; l < 8; l++) {
    const L = LMASK[l];
    if (!(L & (wo | wd))) { const k = POP[L & wm]; v += k === 2 ? 9 : k === 1 ? 1.5 : 0; }
    if (!(L & (wm | wd))) { const k = POP[L & wo]; v -= k === 2 ? 9 : k === 1 ? 1.5 : 0; }
  }
  // small boards
  const closed = wm | wo | wd;
  for (let b = 0; b < 9; b++) {
    if (closed >> b & 1) continue;
    const mm = S[(p ? OM : XM) + b], oo = S[(p ? XM : OM) + b];
    const wgt = b === 4 ? 1.4 : 1;
    let s = 0;
    for (let l = 0; l < 8; l++) {
      const L = LMASK[l];
      if (!(L & oo)) { const k = POP[L & mm]; if (k === 2) s += 2; else if (k === 1) s += 0.3; }
      if (!(L & mm)) { const k = POP[L & oo]; if (k === 2) s -= 2; else if (k === 1) s -= 0.3; }
    }
    if (mm & 16) s += 0.4; if (oo & 16) s -= 0.4;
    v += s * wgt;
  }
  // tempo / free-move: side to move with a free choice is better off
  if (S[FORCE] < 0) v += (S[TURN] === p ? 4 : -4);
  return v;
}
const HS1 = new Int32Array(SZ), HS2 = new Int32Array(SZ), HM1 = new Int16Array(96), HM2 = new Int16Array(96);
function heurMove(root, rnd, rootMoves) {
  const p = root[TURN];
  let n1;
  if (rootMoves) { n1 = rootMoves.length; for (let k = 0; k < n1; k++) HM1[k] = rootMoves[k]; } else n1 = legalMoves(root, HM1);
  let best = -1e9, bm = HM1[0];
  for (let k = 0; k < n1; k++) {
    HS1.set(root); step(HS1, (HM1[k] / 9) | 0, HM1[k] % 9);
    let sc;
    if (HS1[END]) sc = evalH(HS1, p);
    else {
      const n2 = legalMoves(HS1, HM2); sc = 1e9;
      for (let j = 0; j < n2; j++) {
        HS2.set(HS1); step(HS2, (HM2[j] / 9) | 0, HM2[j] % 9);
        const e = evalH(HS2, p);
        if (e < sc) sc = e;
      }
    }
    sc += rnd() * 0.6;
    if (sc > best) { best = sc; bm = HM1[k]; }
  }
  return { move: bm, value: 0.5, visits: 0 };
}

module.exports = { LINES, WIN, CAN, POP, XM, OM, WA, WB, WD, FORCE, TURN, END, PLY, SZ, cfg, newState, legalMoves, isLegal, step, makeRng, playout, mcts, heurMove, evalH };
