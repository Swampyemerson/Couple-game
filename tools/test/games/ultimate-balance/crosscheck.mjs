// Cross-check the fast simulator against the real rules (js/games/ultimate.js applyMove/whyNot).
// usage: node crosscheck.mjs [games=200]
import fs from 'fs'; import os from 'os'; import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sim = require('./sim.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.REPO || path.resolve(HERE, '../../../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ult-rules-'));
const done = new Set();
const copy = (rel) => {
  if (done.has(rel)) return; done.add(rel);
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const deps = [...src.matchAll(/from '(\.[^']+)\.js'/g)].map((m) => path.posix.join(path.posix.dirname(rel), m[1]) + '.js');
  const out = path.join(dir, rel.replace(/\.js$/, '.mjs'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, src.replace(/from '(\.[^']+)\.js'/g, "from '$1.mjs'"));
  deps.forEach(copy);
};
copy('js/games/ultimate.js');
const core = await import(pathToFileURL(path.join(dir, 'js/games/core.mjs')).href);
await import(pathToFileURL(path.join(dir, 'js/games/ultimate.mjs')).href);
const def = core.gameById('ultimate');
const clone = (x) => JSON.parse(JSON.stringify(x));
const N = +process.argv[2] || 200;
const rnd = sim.makeRng(12345);
const who = ['a', 'b'];
let moves = 0, illegalChecks = 0, outcomes = { line: 0, count: 0, draw: 0 }, bad = 0;
const fail = (m) => { bad++; if (bad < 10) console.log('MISMATCH', m); };
for (let g = 0; g < N; g++) {
  let real = def.init({ first: 'a', seed: 1, opts: {} });
  const S = sim.newState();
  const buf = new Int16Array(96);
  for (let ply = 0; ply < 200; ply++) {
    const acts = def.next(real);
    if (!acts.length) { if (!S[sim.END] && sim.legalMoves(S, buf) > 0) fail('real over, sim not'); break; }
    if (S[sim.END]) { fail('sim over, real not'); break; }
    const turn = real.turn;
    if (turn !== who[S[sim.TURN]]) fail('turn mismatch');
    // legality of every one of the 81 squares, for the side to move, and for the wrong side
    const legal = new Set(); const n = sim.legalMoves(S, buf);
    for (let k = 0; k < n; k++) legal.add(buf[k]);
    for (let b = 0; b < 9; b++) for (let i = 0; i < 9; i++) {
      const rl = def.apply && !(() => { try { return clone(real) && !!(() => { const c = clone(real); def.apply(c, turn, { b, i }); return false; })(); } catch { return true; } })();
      const sl = sim.isLegal(S, b, i);
      illegalChecks++;
      if (rl !== sl || sl !== legal.has(b * 9 + i)) fail(`legality g${g} ply${ply} b${b} i${i} real=${rl} sim=${sl}`);
    }
    // wrong side must be refused
    try { def.apply(clone(real), turn === 'a' ? 'b' : 'a', { b: [...legal][0] / 9 | 0, i: [...legal][0] % 9 }); fail('wrong side accepted'); } catch { /* ok */ }
    // pick a random legal move (bias a little toward winning small boards to reach line endings)
    const arr = [...legal]; const mv = arr[(rnd() * arr.length) | 0];
    real = def.apply(clone(real), turn, { b: (mv / 9) | 0, i: mv % 9 });
    sim.step(S, (mv / 9) | 0, mv % 9); moves++;
    const bigR = real.big.map((x) => (x === 'a' ? 1 : x === 'b' ? 2 : x === 'd' ? 3 : 0));
    for (let b = 0; b < 9; b++) {
      const sv = S[sim.WA] >> b & 1 ? 1 : S[sim.WB] >> b & 1 ? 2 : S[sim.WD] >> b & 1 ? 3 : 0;
      if (sv !== bigR[b]) fail(`big board ${b} g${g} ply${ply}`);
      for (let i = 0; i < 9; i++) {
        const rc = real.cells[b * 9 + i]; const sc = S[sim.XM + b] >> i & 1 ? 'a' : S[sim.OM + b] >> i & 1 ? 'b' : null;
        if (rc !== sc) fail(`cell ${b},${i}`);
      }
    }
    if (real.force !== S[sim.FORCE] && !(real.force === null && S[sim.FORCE] === -1)) fail('force mismatch');
    const re = real.end; const se = S[sim.END];
    if (!!re !== !!se) fail(`end flag g${g} ply${ply} real=${JSON.stringify(re)} sim=${se}`);
    if (re) {
      const rw = re.who === 'a' ? 1 : re.who === 'b' ? 2 : 3;
      if (rw !== se) fail(`winner real=${rw} sim=${se}`);
      outcomes[re.why === 'line' ? 'line' : re.who ? 'count' : 'draw']++;
      break;
    }
  }
}
console.log(JSON.stringify({ games: N, moves, legalityChecks: illegalChecks, outcomes, mismatches: bad }));
process.exit(bad ? 1 : 0);
