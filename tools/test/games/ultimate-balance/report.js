// prints a markdown table from results.jsonl (latest entry per variant/bot/budget/games)
const fs = require('fs');
const rows = fs.readFileSync(__dirname + '/results.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const seen = new Map(); rows.forEach((r) => seen.set(`${r.variant}|${r.bot}|${r.budget}|${r.seed || 1}|${r.games}`, r));
const L = [...seen.values()].filter((r) => r.games >= 100).sort((a, b) => (a.bot === b.bot ? a.budget - b.budget : a.bot < b.bot ? -1 : 1) || a.variant.localeCompare(b.variant));
const p = (x) => (100 * x).toFixed(1);
console.log('| variant | bot | N | P1 win % | P2 win % | draw % | P1-P2 (pp) | 95% CI (pp) | steal % |\n|---|---|---|---|---|---|---|---|---|');
for (const r of L) console.log(`| ${r.variant} | ${r.bot === 'heur' ? 'heuristic 2-ply' : 'MCTS ' + r.budget} | ${r.games} | ${p(r.p1)} | ${p(r.p2)} | ${p(r.draw)} | ${p(r.diff)} | [${p(r.ci_lo)}, ${p(r.ci_hi)}] | ${r.stealRate !== undefined ? p(r.stealRate) : ''} |`);
// pooled over seeds
const grp = new Map(); for (const r of L) { const k = `${r.variant}|${r.bot}|${r.budget}`; (grp.get(k) || grp.set(k, []).get(k)).push(r); }
console.log('\nPooled over seeds (variants run with >1 seed):\n\n| variant | bot | seeds | N | P1 % | P2 % | draw % | P1-P2 (pp) | 95% CI (pp) |\n|---|---|---|---|---|---|---|---|---|');
for (const rs of grp.values()) {
  if (rs.length < 2) continue;
  const n = rs.reduce((a, r) => a + r.games, 0), w0 = rs.reduce((a, r) => a + r.p1 * r.games, 0), w1 = rs.reduce((a, r) => a + r.p2 * r.games, 0), d = n - w0 - w1;
  const m = (w0 - w1) / n, ci = 1.96 * Math.sqrt(((w0 + w1) / n - m * m) / n);
  console.log(`| ${rs[0].variant} | MCTS ${rs[0].budget} | ${rs.length} | ${n} | ${p(w0 / n)} | ${p(w1 / n)} | ${p(d / n)} | ${p(m)} | [${p(m - ci)}, ${p(m + ci)}] |`);
}
console.log('\nPie opening/steal detail:');
for (const r of L.filter((r) => r.opened)) {
  console.log(`\n${r.variant} MCTS ${r.budget} (N=${r.games}):`);
  const co = {}, cs = {};
  for (const [k, n] of Object.entries(r.opened)) { const g = k.replace(/\(\d\)/g, ''); co[g] = (co[g] || 0) + n; cs[g] = (cs[g] || 0) + (r.stolen[k] || 0); }
  for (const [k, n] of Object.entries(co).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: opened ${n}, stolen ${cs[k]} (${p(cs[k] / n)}%)`);
}
