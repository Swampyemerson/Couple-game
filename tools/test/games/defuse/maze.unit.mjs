// Unit tests for the Defuse MAZE module: pure rules / gen / solve, solving from the manual page.
const { MAZE } = await import(new URL('../../../../js/games/defuse/maze.js', import.meta.url));
const { stream } = await import(new URL('../../../../js/games/defuse/util.js', import.meta.url));

const E = { serial: 'AB12C4', batteries: 2, indicators: [{ label: 'RDY', lit: true }, { label: 'PWR', lit: false }] };
const TIERS = [1, 2, 3, 4].map((level) => ({ id: ['chill', 'normal', 'spicy', 'wild'][level - 1], level, stages: [3, 4, 5, 5][level - 1] }));
const SEEDS = 1000;
const N = 6;
const attr = (s, k) => (s.match(new RegExp(`${k}="([^"]*)"`)) || [])[1];

// ── an independent reader of the encoding (does not share code with the module) ──
const cellOf = (name) => (name.charCodeAt(1) - 49) * N + (name.charCodeAt(0) - 65);
const cellName = (i) => 'ABCDEF'[i % N] + (Math.floor(i / N) + 1);
const D = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
function canGo(w, i, d) {
  const c = i % N;
  const r = Math.floor(i / N);
  const nc = c + D[d][0];
  const nr = r + D[d][1];
  if (nc < 0 || nr < 0 || nc >= N || nr >= N) return false;
  const j = nr * N + nc;
  const a = d === 'R' || d === 'D' ? i : j;
  const bit = d === 'R' || d === 'L' ? 1 : 2;
  return !((+w[a]) & bit);
}
const step = (i, d) => i + D[d][0] + D[d][1] * N;
function bfs(w, a) {
  const dist = new Map([[a, 0]]);
  const q = [a];
  while (q.length) {
    const i = q.shift();
    for (const d of 'UDLR') if (canGo(w, i, d)) { const j = step(i, d); if (!dist.has(j)) { dist.set(j, dist.get(i) + 1); q.push(j); } }
  }
  return dist;
}
const passages = (w) => { let n = 0; for (let i = 0; i < 36; i++) for (const d of 'RD') if (canGo(w, i, d)) n++; return n; };
const pathLen = (w, a, b) => bfs(w, a).get(b);
function walk(w, a, route) {
  let i = a;
  for (const d of route) { if (!canGo(w, i, d)) return -1; i = step(i, d); }
  return i;
}
/** Everything a person does with the page: find the svg with the bomb's two rings, trace the route. */
function fromPage(html, rings, p, g, slip) {
  const figs = [...html.matchAll(/<svg[^>]*data-maze="[^"]*"[^>]*>/g)].map((m) => ({ k: attr(m[0], 'data-maze'), mk: attr(m[0], 'data-markers'), w: attr(m[0], 'data-walls') }));
  const want = rings.map(cellName).join(',');
  const hit = figs.filter((f) => f.mk === want);
  if (hit.length !== 1) return null;
  let w = hit[0].w;
  if (slip && attr(slip, 'data-markers') === want) { // the taped correction: open one wall
    const i = cellOf(attr(slip, 'data-cell'));
    const bit = attr(slip, 'data-dir') === 'R' ? 1 : 2;
    const a = w.split('');
    a[i] = String((+a[i]) & ~bit);
    w = a.join('');
  }
  // breadth-first route with parents
  const from = new Map([[p, '']]);
  const q = [p];
  while (q.length) {
    const i = q.shift();
    for (const d of 'UDLR') if (canGo(w, i, d)) { const j = step(i, d); if (!from.has(j)) { from.set(j, from.get(i) + d); q.push(j); } }
  }
  return from.get(g);
}

const build = (seed, T) => {
  const R = MAZE.rules(stream(seed, 'rules', 'maze'), T);
  const S = MAZE.gen(stream(seed, 'gen', 'maze'), E, R, T);
  return { R, S };
};

export async function run({ assert }) {
  assert(MAZE.id === 'maze' && MAZE.tab.length <= 9 && !MAZE.needy && !MAZE.remote, 'plugin identity');
  assert(MAZE.css.includes('.dx-mz') && MAZE.tiers.includes('wild'), 'css prefix + tiers');
  assert(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(MAZE.css + MAZE.page(build('x', TIERS[3]).R, TIERS[3])), 'no emoji');

  for (const T of TIERS) {
    const a = build('det-1', T);
    assert(JSON.stringify(a) === JSON.stringify(build('det-1', T)), `deterministic rules + puzzle (level ${T.level})`);
    assert(MAZE.page(a.R, T) === MAZE.page(build('det-1', T).R, T), `deterministic page (level ${T.level})`);
    assert(JSON.stringify(a) !== JSON.stringify(build('det-2', T)), `different seed, different round (level ${T.level})`);
    assert(JSON.stringify(a.S).length < 120, 'the puzzle is tiny');
  }

  for (const T of TIERS) {
    const want = T.level >= 3 ? 9 : 6;
    const min = T.level >= 3 ? 6 : 4;
    const mazesSeen = new Set();
    const goals = new Set();
    const answers = new Set();
    const ringPairs = new Map();
    let longest = 0;
    let shortest = 99;
    for (let n = 0; n < SEEDS; n++) {
      const seed = `mz-${n}`;
      const { R, S } = build(seed, T);
      assert(R.mazes.length === want && R.n === want, `${want} mazes (level ${T.level}, ${seed})`);
      const pairKeys = new Set();
      const wallKeys = new Set();
      for (const mz of R.mazes) {
        assert(/^[0-3]{36}$/.test(mz.w), `walls are 36 digits 0-3 (${seed})`);
        assert(passages(mz.w) === 35 && bfs(mz.w, 0).size === 36, `a perfect maze: 35 passages, all 36 cells reachable (${seed})`);
        for (let i = 0; i < 6; i++) assert((+mz.w[i * 6 + 5]) & 1 && (+mz.w[30 + i]) & 2, 'the outer edge is walled');
        assert(mz.m.length === 2 && mz.m[0] < mz.m[1] && mz.m[0] >= 0 && mz.m[1] < 36, `two distinct ring cells (${seed})`);
        pairKeys.add(mz.m.join());
        wallKeys.add(mz.w);
      }
      assert(pairKeys.size === want, `ring pairs are unique within the book (${seed})`);
      assert(wallKeys.size === want, `mazes are distinct within the book (${seed})`);
      assert(R.mirror === (T.level >= 4 ? 1 : 0), 'mirror only at level 4');
      // puzzle
      const mz = R.mazes[S.k];
      assert(S.m.join() === mz.m.join(), 'the bomb shows the maze\'s rings');
      assert(S.p !== S.g && !S.m.includes(S.p) && !S.m.includes(S.g), `start differs from goal and from the rings (${seed})`);
      const len = pathLen(mz.w, S.p, S.g);
      assert(len >= min, `route length ${len} >= ${min} (level ${T.level}, ${seed})`);
      longest = Math.max(longest, len);
      shortest = Math.min(shortest, len);
      const ans = MAZE.solve(S, E, R, T);
      assert(ans.length === len && walk(mz.w, S.p, ans) === S.g, `solve() is a shortest route to the goal (${seed})`);
      // solve from the page alone
      const html = MAZE.page(R, T);
      assert(html.split('data-maze="').length - 1 === want, 'every maze is on the page');
      assert(fromPage(html, S.m, S.p, S.g) === ans, `solve-from-page equals solve() (${seed})`);
      // drive: the taps are exactly the route, and also from a resumed position
      const taps = MAZE.drive(S, E, R, null);
      assert(taps.map((t) => t.sel.match(/data-dir="(.)"/)[1]).join('') === ans && taps.every((t) => t.act === 'tap'), `drive() taps the route (${seed})`);
      const mid = walk(mz.w, S.p, ans.slice(0, 2));
      assert(MAZE.drive(S, E, R, { p: mid }).length === len - 2, `drive() resumes from a saved position (${seed})`);
      mazesSeen.add(mz.w);
      goals.add(S.p * 36 + S.g);
      answers.add(ans);
      for (const m of R.mazes) ringPairs.set(m.m.join(), (ringPairs.get(m.m.join()) || 0) + 1);
    }
    assert(mazesSeen.size > SEEDS * 0.95, `mazes vary across seeds (${mazesSeen.size}/${SEEDS}, level ${T.level})`);
    assert(goals.size > 250, `start/goal pairs vary (${goals.size}, level ${T.level})`);
    assert(answers.size > SEEDS * 0.7, `routes vary (${answers.size}, level ${T.level})`);
    assert(ringPairs.size > 400, `ring pairs vary (${ringPairs.size}, level ${T.level})`);
    assert(longest > shortest, `route lengths ${shortest}..${longest}`);
  }

  // difficulty rises with the level: longer routes on average
  const avg = (T) => { let s = 0; for (let n = 0; n < 200; n++) { const { R, S } = build(`avg-${n}`, T); s += pathLen(R.mazes[S.k].w, S.p, S.g); } return s / 200; };
  assert(avg(TIERS[3]) > avg(TIERS[0]) + 2, `level 4 routes are longer than level 1 (${avg(TIERS[3]).toFixed(1)} vs ${avg(TIERS[0]).toFixed(1)})`);

  // the mirrored page (level 4)
  {
    const { R } = build('mir-1', TIERS[3]);
    const html = MAZE.page(R, TIERS[3]);
    assert(/printed mirrored/.test(html) && attr(html, 'data-mirror') === '1', 'level 4 page announces the mirroring');
    assert(!/printed mirrored/.test(MAZE.page(build('mir-1', TIERS[1]).R, TIERS[1])), 'no mirror note below level 4');
    const flat = MAZE.page({ ...R, mirror: 0 }, TIERS[3]);
    assert(flat !== html, 'the drawing itself changes when mirrored');
    // the data attributes are the truth either way
    const walls = (h) => [...h.matchAll(/data-walls="([0-3]{36})"/g)].map((m) => m[1]).join();
    assert(walls(flat) === walls(html), 'data-walls is unmirrored in both');
  }

  // errata: a missing wall that shortens routes in that maze; the bomb uses it
  for (const T of TIERS) {
    let made = 0;
    let changed = 0;
    for (let n = 0; n < 300; n++) {
      const seed = `mze-${n}`;
      const R0 = MAZE.rules(stream(seed, 'rules', 'maze'), T);
      const er = MAZE.errata(stream(seed, 'errata', 'maze'), R0, T);
      if (!er) continue;
      made++;
      const k = er.R.e.k;
      assert(er.R.mazes[k].w !== R0.mazes[k].w && er.R.mazes.every((m, i) => i === k || m.w === R0.mazes[i].w), `errata changes exactly one maze (${seed})`);
      assert(passages(er.R.mazes[k].w) === 36, 'one extra passage');
      assert(er.R.mazes[k].m.join() === R0.mazes[k].m.join(), 'rings are not touched');
      const S = MAZE.gen(stream(seed, 'gen', 'maze'), E, er.R, T);
      assert(S.k === k, `the bomb is the corrected maze (${seed})`);
      assert(S.p !== S.g && !S.m.includes(S.p) && !S.m.includes(S.g), 'start/goal fine');
      const ans = MAZE.solve(S, E, er.R, T);
      assert(ans.length >= (T.level >= 3 ? 6 : 4) && walk(er.R.mazes[k].w, S.p, ans) === S.g, `solve() on the corrected maze (${seed})`);
      const html = MAZE.page(R0, T);
      assert(fromPage(html, S.m, S.p, S.g, er.note) === ans, `solve-from-page + slip equals solve() (${seed})`);
      if (fromPage(html, S.m, S.p, S.g) !== ans) changed++;
    }
    assert(made >= 250, `errata is available almost always (${made}/300, level ${T.level})`);
    assert(changed === made, `without the slip the page's route is wrong (${changed}/${made}, level ${T.level})`);
  }

  assert(typeof MAZE.mount === 'function', 'mount exists');
}
