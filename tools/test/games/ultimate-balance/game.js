'use strict';
// Plays one full game for a variant between two equal bots. Returns {winner: 0|1|-1, plies, info}.
const sim = require('./sim.js');
const { newState, legalMoves, step, mcts, heurMove, TURN, END, FORCE, PLY } = sim;

// variant flags
const VARIANTS = {
  base:        {},
  pie:         { pie: true },
  pie_nocb:    { pie: true, nocb: true },
  nocb:        { nocb: true },                 // first move not in centre board
  nocc:        { nocc: true },                 // first move not on a centre square
  nocbcc:      { nocb: true, nocc: true },
  seed2:       { seed2: true },                // two random marks placed by the seed, then P1 moves
  seedb:       { seedb: true },                // seed picks P1's first board
  komi:        { komi: true },
  komi_nocb:   { komi: true, nocb: true },
  komi_nocbcc: { komi: true, nocb: true, nocc: true },
  free2:       { free2: true },                // P2's first move may go anywhere
  free2_komi:  { free2: true, komi: true },
  free2_nocb:  { free2: true, nocb: true },
  hot:         { hot: true },                  // 2 seeded small boards count double at a count ending
  hot_komi:    { hot: true, komi: true },
  hot1_komi:        { hot: 1, komi: true },                        // one hot board
  hot2nf_komi:      { hot: 2, nofirst: true, komi: true },         // two hot boards, opener may not start in one
  hot2p2_komi:      { hot: 2, p2only: true, komi: true },          // two hot boards, double only for the second player
  hot1p2_komi:      { hot: 1, p2only: true, komi: true },
  hotopp_komi:      { hot: 2, opp: true, komi: true },             // hot pair = opposite boards through the centre
  hotoppp2_komi:    { hot: 2, opp: true, p2only: true, komi: true },
};

// D4 symmetry classes of the 81 squares (global 9x9 coords)
function classesOf(moves) {
  const rc = (m) => { const b = (m / 9) | 0, i = m % 9; return [Math.floor(b / 3) * 3 + Math.floor(i / 3), (b % 3) * 3 + (i % 3)]; };
  const mk = (r, c) => { const b = Math.floor(r / 3) * 3 + Math.floor(c / 3), i = (r % 3) * 3 + (c % 3); return b * 9 + i; };
  const tr = [(r, c) => [r, c], (r, c) => [c, 8 - r], (r, c) => [8 - r, 8 - c], (r, c) => [8 - c, r], (r, c) => [r, 8 - c], (r, c) => [8 - r, c], (r, c) => [c, r], (r, c) => [8 - c, 8 - r]];
  const seen = new Map(), classes = [];
  for (const m of moves) {
    if (seen.has(m)) continue;
    const cls = []; const [r, c] = rc(m);
    for (const f of tr) { const [r2, c2] = f(r, c); const m2 = mk(r2, c2); if (!seen.has(m2)) { seen.set(m2, classes.length); cls.push(m2); } }
    classes.push(cls);
  }
  return classes;
}
const ALL = Array.from({ length: 81 }, (_, k) => k);
const allowedOpen = (v) => ALL.filter((m) => !(v.nocb && ((m / 9) | 0) === 4) && !(v.nocc && m % 9 === 4));
const tn = (n) => (n === 4 ? 'centre' : n % 2 === 0 ? 'corner' : 'edge');
const openName = (m) => `${tn((m / 9) | 0)}-board(${(m / 9) | 0}) ${tn(m % 9)}-square(${m % 9})`;

function choose(bot, S, rnd, budget, rootMoves) {
  if (bot === 'heur') return heurMove(S, rnd, rootMoves);
  return mcts(S, budget, rnd, rootMoves);
}

function playGame(vname, bot, budget, rnd) {
  const v = VARIANTS[vname];
  const info0 = {};
  if (!v) throw new Error('unknown variant ' + vname);
  sim.cfg.komi = !!v.komi;
  sim.cfg.hotA = 0; sim.cfg.hotB = 0;
  let hotMask = 0;
  if (v.hot) {
    if (v.opp) { const k = (rnd() * 4) | 0; hotMask = (1 << k) | (1 << (8 - k)); }
    else if (v.hot === 1) hotMask = 1 << ((rnd() * 9) | 0);
    else { const a = (rnd() * 9) | 0; let b = (rnd() * 8) | 0; if (b >= a) b++; hotMask = (1 << a) | (1 << b); } // v.hot===true counts as 2
    sim.cfg.hotA = v.p2only ? 0 : hotMask; sim.cfg.hotB = hotMask; info0.hot = hotMask;
  }
  const S = newState();
  const info = info0;
  const buf = new Int16Array(96);
  // ---- seeded openings ----
  if (v.seed2) {
    for (let k = 0; k < 2; k++) { const n = legalMoves(S, buf); const m = buf[(rnd() * n) | 0]; step(S, (m / 9) | 0, m % 9); }
    info.opening = 'seeded';
  } else {
    // first move
    let allowed = allowedOpen(v);
    if (v.nofirst) allowed = allowed.filter((m) => !(hotMask >> ((m / 9) | 0) & 1));
    if (v.seedb) { const sb = (rnd() * 9) | 0; allowed = allowed.filter((m) => ((m / 9) | 0) === sb); info.seedBoard = sb; }
    let m;
    if (v.pie && bot === 'mcts') {
      // opener picks the opening whose value (for the replier, who may steal) is closest to 50/50
      const classes = classesOf(allowed);
      let best = -1, bestc = null;
      for (const cls of classes) {
        const T = newState(); step(T, (cls[0] / 9) | 0, cls[0] % 9);
        const r = mcts(T, budget, rnd);
        const sc = Math.min(r.value, 1 - r.value) + rnd() * 1e-6;
        if (sc > best) { best = sc; bestc = cls; }
      }
      m = bestc[(rnd() * bestc.length) | 0];
    } else if (v.pie) { // heuristic bot: choose the opening whose static eval is closest to even
      const classes = classesOf(allowed); let best = -1e9, bc = null;
      for (const cls of classes) {
        const T = newState(); step(T, (cls[0] / 9) | 0, cls[0] % 9);
        const e = -Math.abs(sim.evalH(T, 0)) + rnd() * 0.01;
        if (e > best) { best = e; bc = cls; }
      }
      m = bc[(rnd() * bc.length) | 0];
    } else {
      m = choose(bot, S, rnd, budget, allowed.length < 81 ? allowed : null).move;
    }
    step(S, (m / 9) | 0, m % 9);
    info.opening = m;
    if (v.free2) S[FORCE] = -1;
    if (v.pie) {
      // second player decides whether to steal: steal when the mover's best-play value < 0.5
      let val;
      if (bot === 'mcts') val = mcts(S, budget, rnd).value; else val = 0.5 + sim.evalH(S, 1) / 200;
      const steal = val < 0.5;
      info.steal = steal; info.moverValue = val;
      if (steal) {
        // mark flips to the second player; original first player moves next (same send rule)
        const b = (m / 9) | 0, i = m % 9;
        S[sim.XM + b] = 0; S[sim.OM + b] = 1 << i;
        S[TURN] = 0;
        info.swapped = true;
      }
    }
  }
  // ---- main loop ----
  while (!S[END]) {
    const r = choose(bot, S, rnd, budget, null);
    step(S, (r.move / 9) | 0, r.move % 9);
  }
  const e = S[END];
  // did the tie-break decide it? (count ending, no line, equal weighted boards, komi on)
  const wa = S[sim.WA], wb = S[sim.WB];
  const byLine = sim.WIN[wa] || sim.WIN[wb];
  info.tiebreak = !!(v.komi && !byLine && sim.POP[wa] + sim.POP[wa & sim.cfg.hotA] === sim.POP[wb] + sim.POP[wb & sim.cfg.hotB]);
  info.byLine = !!byLine;
  return { winner: e === 3 ? -1 : e - 1, plies: S[PLY], info, how: null };
}
module.exports = { VARIANTS, playGame, classesOf, openName, ALL };
