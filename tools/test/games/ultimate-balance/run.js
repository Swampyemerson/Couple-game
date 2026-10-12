'use strict';
// usage: node run.js <variant> <budget> <games> [bot=mcts|heur] [seed=1] [workers=4]
// Equal-strength bots on both sides. Appends one JSON line to results.jsonl and prints a summary.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'); const path = require('path');
if (isMainThread) {
  const [variant, budget, games, bot = 'mcts', seed = '1', workers = '4'] = process.argv.slice(2);
  if (!variant || !budget || !games) { console.error('usage: node run.js <variant> <budget> <games> [mcts|heur] [seed] [workers]'); process.exit(2); }
  const { VARIANTS } = require('./game.js');
  if (!VARIANTS[variant]) { console.error('variants: ' + Object.keys(VARIANTS).join(' ')); process.exit(2); }
  const W = +workers, N = +games, t0 = Date.now();
  let finished = 0; const results = [];
  const prog = setInterval(() => process.stderr.write(`  ${variant} b${budget}: ${results.length}/${N}\n`), 30000);
  for (let w = 0; w < W; w++) {
    const wk = new Worker(__filename, { workerData: { variant, budget: +budget, N, bot, seed: +seed, w, W } });
    wk.on('message', (m) => { if (m.res) results.push(m.res); });
    wk.on('error', (e) => { console.error(e); process.exit(1); });
    wk.on('exit', () => { if (++finished === W) { clearInterval(prog); summarize(); } });
  }
  function summarize() {
    const n = results.length;
    let w0 = 0, w1 = 0, d = 0, plies = 0, steals = 0, line = 0, tb = 0, byLine = 0;
    const stolen = {}, opened = {};
    for (const r of results) {
      if (r.winner === 0) w0++; else if (r.winner === 1) w1++; else d++;
      plies += r.plies; if (r.info.tiebreak) tb++; if (r.info.byLine) byLine++;
      if (r.info.steal !== undefined) { const k = r.info.openName; opened[k] = (opened[k] || 0) + 1; if (r.info.steal) { steals++; stolen[k] = (stolen[k] || 0) + 1; } }
    }
    const mean = (w0 - w1) / n;
    const varr = (w0 + w1) / n - mean * mean;       // outcomes in {+1,0,-1}
    const se = Math.sqrt(varr / n), ci = 1.96 * se;
    const out = {
      variant, bot, budget: +budget, seed: +seed, games: n, p1: w0 / n, p2: w1 / n, draw: d / n, diff: mean, ci_lo: mean - ci, ci_hi: mean + ci,
      avgPlies: plies / n, tiebreakGames: tb, tiebreakShareOfP2Wins: w1 ? tb / w1 : 0, lineEndShare: byLine / n, secs: (Date.now() - t0) / 1000,
    };
    if (Object.keys(opened).length) { out.stealRate = steals / n; out.opened = opened; out.stolen = stolen; }
    fs.appendFileSync(path.join(__dirname, 'results.jsonl'), JSON.stringify(out) + '\n');
    const pc = (x) => (100 * x).toFixed(1) + '%';
    console.log(`${variant} ${bot}${bot === 'mcts' ? budget : ''} N=${n}  P1 ${pc(out.p1)}  P2 ${pc(out.p2)}  draw ${pc(out.draw)}  P1-P2 ${(100 * mean).toFixed(1)}pp  95%CI [${(100 * out.ci_lo).toFixed(1)}, ${(100 * out.ci_hi).toFixed(1)}]  ${out.secs.toFixed(0)}s` + (out.stealRate !== undefined ? `  steal ${pc(out.stealRate)}` : '') + (tb ? `  tiebreak=${tb} (${pc(out.tiebreakShareOfP2Wins)} of P2 wins)` : ''));
  }
} else {
  const sim = require('./sim.js'); const { playGame, openName } = require('./game.js');
  const { variant, budget, N, bot, seed, w, W } = workerData;
  for (let g = w; g < N; g += W) {
    const rnd = sim.makeRng((seed * 1000003 + g * 7919 + budget * 31 + variant.length * 17) | 0);
    const r = playGame(variant, bot, budget, rnd);
    if (typeof r.info.opening === 'number') r.info.openName = openName(r.info.opening);
    parentPort.postMessage({ res: { winner: r.winner, plies: r.plies, info: { steal: r.info.steal, openName: r.info.openName, tiebreak: r.info.tiebreak, byLine: r.info.byLine } } });
  }
}
