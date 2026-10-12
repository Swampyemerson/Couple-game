// Board games: Four in a Row (four), Dots & Boxes (dots), Ultimate Tic-Tac-Toe (ultimate).
//   node tools/test/games/board.test.js            screenshots go to $SHOTS (default: <tmp>/board-shots)
//
// 1. Rules, in node: the game files are copied to a temp dir as .mjs and imported, then driven
//    through init/next/apply/result (and the engine's derive) with targeted move sequences.
// 2. UI, in two simulated phones (light, then dark): a full online game per game played by
//    tapping the real board (select, then confirm), same-phone games played with mouse clicks
//    and keys, illegal moves through the UI, and screenshots at 390 and 360 px wide.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'board-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const GAMES = ['four', 'dots', 'ultimate'];
let passed = 0;
const failures = [];
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); passed++; console.log('ok -', m); };
async function section(name, fn) {
  console.log(`\n# ${name}`);
  try { await fn(); } catch (e) { failures.push(`${name}: ${e.message}`); console.error('not ok -', e.message); }
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
function lcg(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }

// ── load the rules in node ────────────────────────────────────────────
async function loadRules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-rules-'));
  const done = new Set();
  const copy = (rel) => { // copy a module and everything it imports, as .mjs
    if (done.has(rel)) return;
    done.add(rel);
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const deps = [...src.matchAll(/from '(\.[^']+)\.js'/g)].map((m) => path.posix.join(path.posix.dirname(rel), m[1]) + '.js');
    const out = path.join(dir, rel.replace(/\.js$/, '.mjs'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, src.replace(/from '(\.[^']+)\.js'/g, "from '$1.mjs'"));
    deps.forEach(copy);
  };
  GAMES.forEach((g) => copy(`js/games/${g}.js`));
  const core = await import(pathToFileURL(path.join(dir, 'js/games/core.mjs')).href);
  for (const g of GAMES) await import(pathToFileURL(path.join(dir, `js/games/${g}.mjs`)).href);
  return { core, dir };
}
/** Play moves in order; each goes to whoever next() says may act. */
function run(def, first, moves, from) {
  let s = from ? clone(from) : def.init({ first, seed: 7, opts: {} });
  for (const m of moves) {
    const acts = def.next(s);
    if (acts.length !== 1) throw new Error(`game ended early (move ${JSON.stringify(m)})`);
    s = def.apply(clone(s), acts[0], clone(m));
  }
  return s;
}

// Sequences found offline (role-relative: the first mover starts).
const FOUR_DRAW = [2, 4, 5, 5, 6, 4, 6, 2, 0, 1, 3, 4, 4, 5, 3, 4, 6, 4, 0, 3, 1, 5, 2, 1, 2, 1, 1, 1, 0, 0, 2, 6, 6, 3, 6, 3, 0, 0, 3, 2, 5, 5];
const TRAP_GAME = [2, 0, 3, 0, 4, 1, 5]; // the first mover forks on the bottom row at move 5 (open at both ends) and wins
const FOUR_DIAG = [0, 1, 1, 2, 3, 2, 2, 3, 6, 3, 3]; // first mover wins on the ↗ diagonal
const ULT_WIN = [[1, 3], [3, 1], [1, 6], [6, 1], [1, 0], [0, 6], [6, 6], [6, 2], [2, 6], [6, 3], [3, 6], [6, 7], [7, 3], [3, 7], [7, 0], [0, 4], [4, 4], [4, 7], [7, 6], [6, 4], [4, 5], [5, 1], [4, 3]];
let ULT_COUNT = null; // a legal v2 log that ends on the boards count (last move kept apart), for the finale layout checks
let ULT_MP = null; // a legal v2 log that stops with the player to move one board from the win
let ULT_DENY = null; // a legal v2 log whose last move denies the other player a live big line
let ULT_LL = null; // a legal v2 log that stops with only one or two big lines left (filled in by the ultimate rules tests)
const DOT_KEYS = [];
for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) DOT_KEYS.push(`h-${r}-${c}`);
for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) DOT_KEYS.push(`v-${r}-${c}`);
const dotMove = (k) => { const [l, r, c] = k.split('-'); return { l, r: Number(r), c: Number(c) }; };

let DOTS_SAFE = null; // a quick-mode position with exactly one safe line left (built in rulesTests, replayed in the UI)
async function rulesTests() {
  const { core, dir } = await loadRules();
  const four = core.gameById('four');
  const dots = core.gameById('dots');
  const ult = core.gameById('ultimate');

  await section('four rules', () => {
    const cols = (xs) => xs.map((col) => ({ col }));
    const has = (s, cells) => cells.every(([x, y]) => s.win.runs.some((r) => r.cells.some(([a, b]) => a === x && b === y)));
    let s = run(four, 'a', cols([0, 0, 1, 1, 2, 2, 3]));
    ok(s.win && s.win.who === 'a' && s.win.runs[0].dir === 'across' && four.next(s).length === 0, 'four across wins and ends the game');
    ok(four.result(s).winner === 'a' && /across/i.test(four.result(s).sub), 'result names the winner and the direction');
    s = run(four, 'b', cols([0, 1, 0, 1, 0, 1, 0]));
    ok(s.win && s.win.who === 'b' && s.win.runs[0].dir === 'down', 'four stacked up wins (first mover b)');
    s = run(four, 'a', cols(FOUR_DIAG));
    ok(s.win && s.win.who === 'a' && has(s, [[0, 0], [1, 1], [2, 2], [3, 3]]), 'four on the rising diagonal wins');
    s = run(four, 'a', cols([6, 5, 5, 4, 3, 4, 4, 3, 0, 3, 3]));
    ok(s.win && s.win.who === 'a' && has(s, [[3, 3], [4, 2], [5, 1], [6, 0]]), 'four on the falling diagonal wins');
    s = run(four, 'a', cols([0, 0, 1, 1, 3, 3, 2]));
    ok(s.win && s.win.who === 'a', 'a disc dropped into the middle of a line completes it');
    s = run(four, 'a', cols([0, 0, 1, 1, 3, 3, 4, 4, 2]));
    ok(s.win && s.win.runs[0].cells.length === 5, 'five in a row counts (all five marked)');
    s = run(four, 'a', cols([0, 1, 0, 1, 0, 1, 2, 1]));
    ok(s.win && s.win.who === 'b', 'the second player can win too');
    s = run(four, 'a', cols([0, 0, 0, 0, 0, 0]));
    ok(errOf(() => four.apply(clone(s), 'a', { col: 0 })) === 'That column is full', 'full column is rejected with a friendly message');
    ok(['x', 7, -1, 2.5, null].every((col) => errOf(() => four.apply(four.init({ first: 'a' }), 'a', { col })) !== null), 'bad columns are rejected');
    ok(errOf(() => four.apply(four.init({ first: 'a' }), 'b', { col: 0 })) !== null, 'moving out of turn is rejected');
    s = run(four, 'a', cols(FOUR_DRAW));
    ok(!s.win && s.n === 42 && four.next(s).length === 0, 'a full board with no four ends the game');
    const r = four.result(s);
    ok(r.winner === null && /draw/i.test(r.sub), 'full board is a draw');
    // one disc finishing both diagonals at once: two runs in the same direction class
    const x = four.init({ first: 'a' });
    x.cols = [['a'], ['b', 'a'], ['b', 'b', 'a'], ['b', 'b', 'b'], ['a', 'b', 'a'], ['b', 'a'], ['a']];
    x.n = 14;
    s = four.apply(clone(x), 'a', { col: 3 });
    ok(s.win && s.win.runs.length === 2 && s.win.runs.every((r) => r.dir === 'diag'), 'a disc can finish both diagonals at once');
    ok(/two lines/i.test(four.result(s).sub), 'the result says two lines, not just "on the diagonal"');
    const d = core.derive(four, { first: 'a', seed: 1, lists: { a: cols([0, 0, 0, 0, 1]), b: cols([0, 0, 0]) } });
    ok(d.rejected.length === 1 && d.rejected[0].error === 'That column is full' && d.count === 7 && d.state.cols[1].length === 1, 'engine replay drops a move into a full column and plays on');
  });

  await section('four v2: legacy replay, setup move, Ghost Column, PopOut', () => {
    const other = (w) => (w === 'a' ? 'b' : 'a');
    const seeded = (first, seed) => { const s = four.init({ first }); s.seed = seed; return s; };
    const step = (s, m, who) => four.apply(clone(s), who || four.next(s)[0], m);
    const withSetup = (mode, seed = 5, first = 'a') => step(seeded(first, seed), { setup: 2, mode });
    const replay = (first, seq, setup) => {
      const lists = { a: [], b: [] };
      const mine = seq.map((col) => ({ col }));
      if (setup) lists[first].push(setup);
      mine.forEach((m, i) => lists[i % 2 ? other(first) : first].push(m));
      return core.derive(four, { first, seed: 3, lists });
    };
    // 1. legacy logs (no setup move) replay exactly as the original game did
    let d = replay('a', FOUR_DIAG);
    ok(JSON.stringify(d.state) === '{"cols":[["a"],["b","a"],["b","b","a"],["a","b","b","a"],[],[],["a"]],"turn":"b","n":11,"win":{"who":"a","runs":[{"dir":"diag","cells":[[0,0],[1,1],[2,2],[3,3]]}]},"seed":3}' && JSON.stringify(d.result) === '{"winner":"a","sub":"Four on the diagonal"}', 'legacy: the FOUR_DIAG log replays to the exact original state and result');
    d = replay('a', FOUR_DRAW);
    ok(JSON.stringify(d.state) === '{"cols":[["a","a","a","b","a","b"],["b","a","b","b","a","b"],["a","b","a","a","a","b"],["a","a","b","b","b","a"],["b","b","b","a","b","b"],["a","b","b","b","a","b"],["a","a","a","b","a","a"]],"turn":"a","n":42,"win":null,"seed":3}' && JSON.stringify(d.result) === '{"winner":null,"text":"Board full","sub":"Nobody lined up four. It’s a draw."}', 'legacy: the FOUR_DRAW log replays to the exact original state and result');
    ok(d.state.v === undefined && d.state.mode === undefined && d.rejected.length === 0, 'legacy: no mode, no version, nothing rejected');
    // the same games after a classic setup play the same board
    const c1 = replay('a', FOUR_DIAG, { setup: 2, mode: 'classic' });
    ok(c1.rejected.length === 0 && c1.count === 12 && JSON.stringify(c1.state.cols) === JSON.stringify(replay('a', FOUR_DIAG).state.cols) && c1.state.win.who === 'a', 'classic (v2) plays the same board as the legacy game');
    const c2 = replay('b', FOUR_DRAW, { setup: 2, mode: 'classic' });
    ok(c2.over && c2.result.winner === null && c2.state.n === 42 && c2.result.text === 'Board full', 'classic (v2): a full board is still a draw');

    // 2. the setup move
    let s = withSetup('classic');
    ok(s.v === 2 && s.mode === 'classic' && s.n === 0 && s.turn === 'a' && four.next(s)[0] === 'a' && four.next(s).length === 1, 'setup: sets the version and mode and does not pass the turn');
    ok(errOf(() => step(seeded('a', 1), { setup: 2, mode: 'classic' }, 'b')) !== null, 'setup: only the first mover may send it');
    ok(errOf(() => step(step(seeded('a', 1), { col: 3 }), { setup: 2, mode: 'classic' })) !== null, 'setup: refused once a disc has been played');
    d = core.derive(four, { first: 'a', seed: 4, lists: { a: [{ col: 1 }, { setup: 2, mode: 'pop' }], b: [{ col: 2 }] } });
    ok(d.rejected.length === 1 && d.rejected[0].who === 'a' && d.state.v === undefined && d.state.n === 2, 'engine replay: a setup after the first disc is dropped and the match stays legacy');
    ok(errOf(() => step(s, { setup: 2, mode: 'ghost' })) !== null, 'setup: refused a second time');
    ok(errOf(() => step(seeded('a', 1), { setup: 2, mode: 'nope' })) === 'Unknown mode' && errOf(() => step(seeded('a', 1), { setup: 2 })) === 'Unknown mode' && errOf(() => step(seeded('a', 1), { setup: 2, mode: 'constructor' })) === 'Unknown mode', 'setup: an unknown mode is rejected');
    ok(errOf(() => step(seeded('a', 1), { setup: 1, mode: 'classic' })) !== null, 'setup: only version 2');
    ok(errOf(() => step(seeded('a', 1), { pop: 0 })) !== null && errOf(() => step(s, { pop: 0 })) !== null, 'pop: refused in legacy and classic matches');
    d = core.derive(four, { first: 'b', seed: 4, lists: { a: [{ col: 1 }], b: [{ setup: 2, mode: 'ghost' }, { col: 3 }] } });
    ok(d.rejected.length === 0 && d.count === 3 && d.state.mode === 'ghost' && d.state.cols[3].length === 1 && d.state.cols[1].length === 1, 'engine replay: setup, disc, disc (the setup is in the first mover’s own list)');

    // 3. Ghost Column
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const g = withSetup('ghost', seed).ghost;
      if (!(g >= 0 && g <= 6 && g !== 3)) throw new Error('FAIL: the ghost column must be a non-centre column, saw ' + g);
      if (withSetup('ghost', seed).ghost !== g) throw new Error('FAIL: the ghost column must be the same for the same seed');
      seen.add(g);
    }
    ok(seen.size >= 4, `ghost: seeded, never the centre, deterministic per seed (${[...seen].sort().join(',')} over 60 seeds)`);
    s = withSetup('ghost', 11);
    const gc = s.ghost;
    const other0 = gc === 0 ? 1 : 0;
    for (let i = 0; i < 3; i++) s = step(s, { col: gc });
    ok(s.cols[gc].length === 3 && !s.win, 'ghost: the capped column takes three discs');
    ok(/ghost/i.test(errOf(() => step(s, { col: gc }))), 'ghost: a fourth disc in the capped column is refused with a friendly message');
    ok(four.next(s).length === 1, 'ghost: the game goes on after the refusal');
    let t = withSetup('ghost', 11);
    for (let i = 0; i < 6; i++) t = step(t, { col: other0 });
    ok(t.cols[other0].length === 6 || t.win, 'ghost: the other columns still hold six');
    // no way to break the cap, and a full ghost board is a draw (play random non-winning drops)
    const rnd = lcg(99);
    let drawn = 0;
    for (let g = 0; g < 400 && drawn < 3; g++) {
      let x = withSetup('ghost', 100 + g);
      while (four.next(x).length) {
        const legal = [0, 1, 2, 3, 4, 5, 6].filter((c) => errOf(() => step(x, { col: c })) === null);
        if (!legal.length) throw new Error('FAIL: ghost: a running game must have a legal drop');
        const quiet = legal.filter((c) => !step(x, { col: c }).win);
        const pick = (quiet.length ? quiet : legal);
        x = step(x, { col: pick[Math.floor(rnd() * pick.length)] });
        if (x.cols[x.ghost].length > 3) throw new Error('FAIL: ghost: the cap broke');
      }
      if (!x.win) { drawn++; if (x.n !== 39 || !x.draw || four.result(x).winner !== null || four.result(x).text !== 'No drops left') throw new Error('FAIL: ghost: a full board must be a draw after 39 discs, saying so accurately'); }
    }
    ok(drawn === 3, 'ghost: with no legal drop left the game ends in a draw after 39 discs');
    const wc = [0, 1, 2, 3, 4, 5, 6].filter((c) => c !== gc);
    s = withSetup('ghost', 11, 'a');
    for (const col of [wc[0], wc[1], wc[0], wc[1], wc[0], wc[1], wc[0]]) s = step(s, { col });
    ok(s.win && s.win.who === 'a' && s.win.runs[0].dir === 'down', 'ghost: ordinary wins still work');

    // 4. PopOut
    const pops = (cols, who = 'a', extra = {}) => { const x = withSetup('pop', 5, who); x.cols = clone(cols); x.n = 10; x.mv = { a: 5, b: 5 }; return Object.assign(x, extra); };
    s = pops([['a', 'b', 'a'], ['b'], [], [], [], [], []]);
    let r = step(s, { pop: 0 });
    ok(JSON.stringify(r.cols[0]) === '["b","a"]' && r.turn === 'b' && r.n === 11 && r.mv.a === 6 && !r.win, 'pop: the bottom disc leaves, the column slips down, the turn passes');
    ok(errOf(() => step(s, { pop: 1 })) === 'You can only pop your own discs from the bottom row', 'pop: only your own disc');
    ok(errOf(() => step(s, { pop: 4 })) !== null && errOf(() => step(s, { pop: 7 })) !== null && errOf(() => step(s, { pop: -1 })) !== null && errOf(() => step(s, { pop: 'x' })) !== null, 'pop: an empty or bad column is refused');
    ok(errOf(() => step(s, { pop: 0 }, 'b')) !== null, 'pop: not out of turn');
    // a pop that makes only the popper's four wins
    s = pops([['a', 'b', 'a'], ['a', 'a'], ['b', 'a'], ['b', 'a'], [], [], []]);
    r = step(s, { pop: 0 });
    ok(r.win && r.win.who === 'a' && !r.win.both && !r.win.gift && r.win.runs.length === 1 && four.next(r).length === 0, 'pop: a pop that lines up the popper’s four wins');
    // a pop that lines up both: the popper wins
    s = pops([['a', 'b', 'a'], ['b', 'a'], ['b', 'a'], ['b', 'a'], [], [], []]);
    r = step(s, { pop: 0 });
    ok(r.win && r.win.who === 'a' && r.win.both && r.win.both.length >= 1 && /popper/i.test(four.result(r).sub), 'pop: when both sides line up four at once, the popper wins');
    s = pops([['b', 'a', 'b'], ['a', 'b'], ['a', 'b'], ['a', 'b'], [], [], []], 'b');
    r = step(s, { pop: 0 });
    ok(r.win && r.win.who === 'b' && r.win.both, 'pop: …whoever the popper is');
    // a pop that lines up only the other side's four hands them the win
    s = pops([['a', 'b'], ['b'], ['b'], ['b'], [], [], []]);
    r = step(s, { pop: 0 });
    ok(r.win && r.win.who === 'b' && r.win.gift && /gave/i.test(four.result(r).sub), 'pop: a pop that only lines up the other side’s four gives them the win');
    // no pop-draw before the cap, a draw at the cap
    s = pops([['a'], [], [], [], [], [], []], 'a', { n: 98 });
    r = step(step(s, { col: 1 }), { col: 2 });
    ok(four.next(r).length === 0 && r.draw === 'long' && four.result(r).winner === null && /long game/i.test(four.result(r).text), 'pop: a hundred moves with no four is a draw');
    ok(four.next(step(pops([['a'], [], [], [], [], [], []], 'a', { n: 97 }), { col: 1 })).length === 1, 'pop: …and not a move before that');
    // random PopOut games always end, and the books balance
    for (let g = 0; g < 200; g++) {
      let x = withSetup('pop', 300 + g, g % 2 ? 'b' : 'a');
      let drops = 0;
      let popped = 0;
      for (let guard = 0; guard < 300 && four.next(x).length; guard++) {
        const who = four.next(x)[0];
        const moves = [];
        for (let c = 0; c < 7; c++) { if (x.cols[c].length < 6) moves.push({ col: c }); if (x.cols[c][0] === who) moves.push({ pop: c }); }
        const m = moves[Math.floor(rnd() * moves.length)];
        x = step(x, m);
        if (m.pop !== undefined) popped++; else drops++;
        if (x.cols.some((c) => c.length > 6)) throw new Error('FAIL: pop: a column overflowed');
      }
      if (four.next(x).length) throw new Error('FAIL: pop: a game ran past 100 moves');
      if (x.cols.reduce((n, c) => n + c.length, 0) !== drops - popped || x.n !== drops + popped) throw new Error('FAIL: pop: disc count does not balance');
    }
    ok(true, 'pop: 200 random PopOut games all end within 100 moves and the disc count balances');

    // 5. traps (a drop that leaves two winning drops) and Blockers
    s = withSetup('classic');
    for (const col of [2, 0, 3, 0]) s = step(s, { col });
    ok(s.tr.a === 0 && s.tr.b === 0, 'trap: two in the bottom row is not yet a trap');
    s = step(s, { col: 4 });
    ok(s.tr.a === 1 && s.tr.b === 0 && !s.win, 'trap: three in a row with both ends open leaves two winning drops, counted for the mover');
    s = step(s, { col: 1 });
    ok(s.tr.a === 1 && s.tr.b === 0, 'trap: …and only once');
    s = step(s, { col: 5 });
    ok(s.win && s.win.who === 'a', 'trap: the other end wins');
    // a v1 (legacy) state has no counters at all, and a v2 state from before they existed does not break
    let old = withSetup('classic');
    delete old.tr;
    for (const col of [2, 0, 3, 0, 4]) old = step(old, { col });
    ok(old.tr === undefined && !old.win, 'trap: matches saved before the counter existed play on');
    const stonesOf = (seed) => withSetup('blockers', seed).stones;
    const combos = new Set();
    for (let seed = 1; seed <= 80; seed++) {
      const b = withSetup('blockers', seed);
      const st = b.stones;
      if (st.length !== 3 || new Set(st).size !== 3 || st.includes(3) || st.some((c) => c < 0 || c > 6) || JSON.stringify(st) !== JSON.stringify([...st].sort((x, y) => x - y))) throw new Error('FAIL: blockers: three distinct, sorted, non-centre columns, saw ' + JSON.stringify(st));
      if (b.cols.some((c, i) => JSON.stringify(c) !== JSON.stringify(st.includes(i) ? ['x'] : []))) throw new Error('FAIL: blockers: one stone on the floor of each chosen column');
      if (JSON.stringify(stonesOf(seed)) !== JSON.stringify(st)) throw new Error('FAIL: blockers: same seed, same stones');
      combos.add(st.join(''));
    }
    ok(combos.size >= 6 && withSetup('blockers', 5).turn === 'a' && withSetup('blockers', 5).n === 0, `blockers: three seeded non-centre stones, deterministic per seed (${combos.size} layouts in 80 seeds), no turn passed`);
    // a four cannot pass through a stone; the same row with a disc there is a win
    const blk = (mid) => { const b = withSetup('blockers', 5); b.stones = [2, 0, 1]; b.cols = [['a'], ['a'], [mid], ['a'], [], [], []]; return b; };
    ok(!step(blk('x'), { col: 4 }).win && step(blk('a'), { col: 4 }).win, 'blockers: a stone never counts toward a line');
    const sc = withSetup('blockers', 9);
    const stc = sc.stones[0];
    let col6 = sc;
    for (let i = 0; i < 5; i++) col6 = step(col6, { col: stc });
    ok(col6.cols[stc].length === 6 && errOf(() => step(col6, { col: stc })) === 'That column is full', 'blockers: a stone takes up a hole (five discs fill its column)');
    ok(errOf(() => step(withSetup('blockers', 9), { pop: 0 })) !== null, 'blockers: no popping');
    let bd = 0;
    for (let g = 0; g < 400 && bd < 3; g++) {
      let x = withSetup('blockers', 700 + g);
      while (four.next(x).length) {
        const legal = [0, 1, 2, 3, 4, 5, 6].filter((c) => errOf(() => step(x, { col: c })) === null);
        if (!legal.length) throw new Error('FAIL: blockers: a running game must have a legal drop');
        const quiet = legal.filter((c) => !step(x, { col: c }).win);
        const pick = quiet.length ? quiet : legal;
        x = step(x, { col: pick[Math.floor(rnd() * pick.length)] });
      }
      if (!x.win) { bd++; if (x.n !== 39 || x.draw !== 'full' || four.result(x).winner !== null) throw new Error('FAIL: blockers: a full board is a draw after 39 discs'); }
    }
    ok(bd === 3, 'blockers: a full board is a draw after 39 discs');
  });

  await section('dots rules', () => {
    const mv = (...ks) => ks.map(dotMove);
    let s = run(dots, 'a', mv('h-0-0', 'v-0-0', 'h-1-0'));
    ok(dots.next(s)[0] === 'b', 'turn passes when no box closes');
    s = run(dots, 'a', mv('v-0-1'), s);
    ok(s.boxes[0] === 'b' && dots.next(s)[0] === 'b' && s.got === 1, 'closing a box claims it and gives another turn');
    s = run(dots, 'a', mv('h-4-3'), s);
    ok(dots.next(s)[0] === 'a', 'the extra turn ends when the next line closes nothing');
    s = run(dots, 'a', mv('h-0-0', 'h-1-0', 'v-0-0', 'h-0-1', 'h-1-1', 'v-0-2'));
    ok(s.boxes.every((x) => !x) && dots.next(s)[0] === 'a', 'two boxes set up, none closed yet');
    s = run(dots, 'a', mv('v-0-1'), s);
    ok(s.boxes[0] === 'a' && s.boxes[1] === 'a' && s.got === 2 && dots.next(s)[0] === 'a', 'one line closing two boxes claims both and gives one extra turn');
    ok(dots.score(s).a === 2 && dots.score(s).b === 0, 'score counts boxes');
    ok(errOf(() => dots.apply(clone(s), 'a', dotMove('v-0-1'))) === 'That line is already drawn', 'drawing a line twice is rejected');
    const bad = [{ l: 'h', r: 5, c: 0 }, { l: 'h', r: 0, c: 4 }, { l: 'v', r: 4, c: 0 }, { l: 'v', r: 0, c: 5 }, { l: 'x', r: 0, c: 0 }, { l: 'h', r: '0', c: 0 }];
    ok(bad.every((m) => errOf(() => dots.apply(dots.init({ first: 'a' }), 'a', m)) !== null), 'lines off the board are rejected');
    // random full games: always 40 lines, 16 boxes, extra turns exactly when a box closes
    const rnd = lcg(99);
    let sawTie = false;
    let sawWin = false;
    let extraOk = true;
    for (let g = 0; g < 400 && !(sawTie && sawWin && g > 20); g++) {
      let st = dots.init({ first: g % 2 ? 'a' : 'b' });
      while (dots.next(st).length) {
        const w = dots.next(st)[0];
        const free = DOT_KEYS.filter((k) => !st.order.includes(k));
        const before = st.boxes.filter(Boolean).length;
        st = dots.apply(clone(st), w, dotMove(free[Math.floor(rnd() * free.length)]));
        const closed = st.boxes.filter(Boolean).length - before;
        if (dots.next(st).length && (closed > 0) !== (dots.next(st)[0] === w)) extraOk = false;
      }
      const sc = dots.score(st);
      if (st.order.length !== 40 || sc.a + sc.b !== 16) throw new Error('FAIL: a full game must draw 40 lines and claim 16 boxes');
      const r = dots.result(st);
      if (sc.a === sc.b) { sawTie = true; if (r.winner !== null) throw new Error('FAIL: tie must be a draw'); } else {
        sawWin = true;
        if (r.winner !== (sc.a > sc.b ? 'a' : 'b')) throw new Error('FAIL: most boxes must win');
      }
    }
    ok(extraOk, 'over hundreds of random games, extra turns happen exactly when a box closes');
    ok(sawWin && sawTie, 'games end after 40 lines; most boxes wins and 8–8 is a draw');
  });

  // ── dots: modes, versioning, records (builder D) ──
  const dInfo = dots.dotsInfo;
  const dSeeded = (first, seed) => { const s = dots.init({ first, seed, opts: {} }); s.seed = seed; return s; };
  const dSetup = (s, who, mode) => dots.apply(clone(s), who, { setup: 2, mode });
  const dFree = (s) => {
    const N = s.n || 5;
    const out = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N - 1; c++) if (!s.h[r * (N - 1) + c]) out.push(`h-${r}-${c}`);
    for (let r = 0; r < N - 1; r++) for (let c = 0; c < N; c++) if (!s.v[r * N + c]) out.push(`v-${r}-${c}`);
    return out;
  };
  /** A random full game in `mode`; returns the final state and whether every extra turn was earned. */
  const dPlay = (mode, seed, rnd, first = 'a') => {
    let s = dSeeded(first, seed);
    if (mode) s = dSetup(s, first, mode);
    let turnsOk = true;
    while (dots.next(s).length) {
      const w = dots.next(s)[0];
      const free = dFree(s);
      const before = s.boxes.filter(Boolean).length;
      s = dots.apply(clone(s), w, dotMove(free[Math.floor(rnd() * free.length)]));
      const closed = s.boxes.filter(Boolean).length - before;
      if (dots.next(s).length && (closed > 0) !== (dots.next(s)[0] === w)) turnsOk = false;
    }
    return { s, turnsOk };
  };

  await section('dots: legacy logs (no setup move) replay exactly as before', async () => {
    const { legacyDots } = await import(pathToFileURL(path.join(__dirname, 'fixtures/dots-legacy.mjs')).href);
    const rnd = lcg(2024);
    let steps = 0;
    let rejects = 0;
    for (let g = 0; g < 120; g++) {
      const first = g % 2 ? 'a' : 'b';
      let o = legacyDots.init({ first, seed: g });
      let n = dots.init({ first, seed: g });
      if (JSON.stringify(o) !== JSON.stringify(n)) throw new Error('FAIL: a fresh legacy state differs from the original');
      const lists = { a: [], b: [] };
      while (legacyDots.next(o).length) {
        const w = legacyDots.next(o)[0];
        const free = DOT_KEYS.filter((k) => !o.order.includes(k));
        let mv = dotMove(free[Math.floor(rnd() * free.length)]);
        const roll = rnd();
        if (roll < 0.08 && o.order.length) mv = dotMove(o.order[0]); // already drawn
        else if (roll < 0.14) mv = { l: 'h', r: 9, c: 1 }; // off the board
        else if (roll < 0.17) mv = { l: 'v', r: 1 }; // malformed
        const eo = errOf(() => legacyDots.apply(clone(o), w, clone(mv)));
        const en = errOf(() => dots.apply(clone(n), w, clone(mv)));
        if (eo !== en) throw new Error(`FAIL: error differs for ${JSON.stringify(mv)}: "${eo}" vs "${en}"`);
        const ew = errOf(() => dots.apply(clone(n), w === 'a' ? 'b' : 'a', clone(dotMove(free[0]))));
        if (ew !== 'Not your turn') throw new Error('FAIL: the wrong player must be refused');
        if (eo) { rejects++; continue; }
        o = legacyDots.apply(clone(o), w, clone(mv));
        n = dots.apply(clone(n), w, clone(mv));
        lists[w].push(mv);
        steps++;
        if (JSON.stringify(o) !== JSON.stringify(n)) throw new Error(`FAIL: legacy state differs after ${JSON.stringify(mv)}`);
        if (JSON.stringify(legacyDots.next(o)) !== JSON.stringify(dots.next(n)) || JSON.stringify(legacyDots.score(o)) !== JSON.stringify(dots.score(n))) throw new Error('FAIL: legacy next/score differ');
      }
      if (JSON.stringify(legacyDots.result(o)) !== JSON.stringify(dots.result(n))) throw new Error('FAIL: legacy result differs');
      // the engine's replay of the saved lists agrees too
      const dn = core.derive(dots, { first, seed: g, lists });
      const dold = core.derive(legacyDots, { first, seed: g, lists });
      if (JSON.stringify(dn.state) !== JSON.stringify(dold.state) || JSON.stringify(dn.result) !== JSON.stringify(dold.result) || dn.count !== dold.count) throw new Error('FAIL: engine replay of a legacy log differs');
      if (dn.state.ver !== undefined || dn.state.n !== undefined || dn.state.mode !== undefined) throw new Error('FAIL: a legacy state grew version fields');
    }
    ok(steps > 4000 && rejects > 100, `120 random legacy matches (${steps} moves, ${rejects} illegal ones) replay identically to the original rules, errors included`);
    // one fixed saved log, with its known outcome
    const saved = { first: 'a', seed: 5, lists: { a: ['h-0-0', 'h-1-0', 'v-0-0'].map(dotMove), b: ['v-0-1', 'h-4-3'].map(dotMove) } };
    const d = core.derive(dots, saved);
    ok(d.state.boxes[0] === 'a' && d.count === 5 && d.acts[0] === 'a' && !d.rejected.length, 'a saved five-move log still replays to the same position');
  });

  await section('dots: setup move rules', () => {
    const base = dSeeded('a', 3);
    const s2 = dSetup(base, 'a', 'quick');
    ok(s2.ver === 2 && s2.mode === 'quick' && s2.n === 4 && s2.turn === 'a' && dots.next(s2)[0] === 'a' && s2.order.length === 0, 'setup sets version, mode and size, and does not pass the turn');
    ok(base.ver === undefined && base.n === undefined, 'a legacy state has no version (so it keeps the 5x5 rules)');
    ok(errOf(() => dots.apply(clone(base), 'b', { setup: 2, mode: 'quick' })) === 'Not your turn', 'only the first mover may send the setup');
    ok(['nope', '', null, undefined, '__proto__', 'constructor', 7].every((m) => errOf(() => dots.apply(clone(base), 'a', { setup: 2, mode: m })) === 'Unknown mode'), 'an unknown mode is rejected');
    ok(errOf(() => dots.apply(clone(base), 'a', { setup: 1, mode: 'quick' })) === 'Unknown mode', 'only setup version 2 exists');
    ok(errOf(() => dots.apply(clone(s2), 'a', { setup: 2, mode: 'big' })) !== null, 'a second setup is rejected');
    const played = dots.apply(clone(base), 'a', dotMove('h-0-0'));
    ok(errOf(() => dots.apply(clone(played), 'b', { setup: 2, mode: 'big' })) !== null && errOf(() => dots.apply(clone(played), 'a', { setup: 2, mode: 'big' })) !== null, 'a setup after the first line is rejected');
    const d = core.derive(dots, { first: 'b', seed: 4, lists: { a: [], b: [{ setup: 2, mode: 'big' }, dotMove('h-0-0'), dotMove('h-1-1')] } });
    ok(d.state.mode === 'big' && d.state.n === 6 && d.state.order.length === 1 && d.acts[0] === 'a' && d.count === 2, 'through the engine: setup then a line, and the turn passes only on the line');
    const bad = core.derive(dots, { first: 'a', seed: 4, lists: { a: [dotMove('h-0-0')], b: [{ setup: 2, mode: 'big' }] } });
    ok(bad.rejected.length === 1 && bad.state.ver === undefined, 'through the engine: a late setup is dropped and the game stays legacy');
  });

  await section('dots: sizes, totals and turns in every mode', () => {
    const rnd = lcg(31);
    const want = { classic: [40, 16], quick: [24, 9], big: [60, 25], sweet: [40, 16], scramble: [40, 16] };
    for (const [mode, [lines, boxes]] of Object.entries(want)) {
      let allOk = true;
      let ties = 0;
      for (let g = 0; g < 25; g++) {
        const { s, turnsOk } = dPlay(mode, 100 + g, rnd, g % 2 ? 'a' : 'b');
        const drawnLines = s.order.length + (s.pre ? s.pre.length : 0);
        const claimed = s.boxes.filter(Boolean).length;
        const p = dots.score(s);
        if (drawnLines !== lines || claimed !== boxes || p.a + p.b !== boxes + (mode === 'sweet' ? 1 : 0) || !turnsOk) allOk = false;
        const r = dots.result(s);
        if (p.a === p.b) { ties++; if (r.winner !== null) allOk = false; } else if (r.winner !== (p.a > p.b ? 'a' : 'b')) allOk = false;
      }
      ok(allOk, `${mode}: 25 random games end after ${lines} lines with ${boxes} boxes, extra turns exactly on a close${mode === 'sweet' ? ', 17 points' : ''}${ties ? ` (${ties} draws)` : ''}`);
      if (mode === 'sweet') ok(ties === 0, 'sweet: 17 points can never tie, so a heart always settles it');
    }
    ok(dInfo.MODE_IDS.length === 5 && dInfo.MODE_IDS.every((m) => dInfo.MODES[m].n >= 4), 'five modes are offered');
  });

  await section('dots: sweetheart box', () => {
    const hearts = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const s = dSetup(dSeeded('a', seed), 'a', 'sweet');
      const s2 = dSetup(dSeeded('b', seed), 'b', 'sweet');
      if (!(s.heart >= 0 && s.heart < 16) || s.heart !== s2.heart || s.prompt !== s2.prompt || !(s.prompt >= 0 && s.prompt < dInfo.PROMPTS.length)) throw new Error('FAIL: the heart box and its prompt are seeded and deterministic');
      hearts.add(s.heart);
    }
    ok(hearts.size >= 8, `the heart lands on ${hearts.size} different boxes across 60 seeds`);
    // close the heart box for 'b': a, b, a draw three sides, b closes it
    let s = dSetup(dSeeded('a', 9), 'a', 'sweet');
    const hr = Math.floor(s.heart / 4);
    const hc = s.heart % 4;
    const edges = [`h-${hr}-${hc}`, `h-${hr + 1}-${hc}`, `v-${hr}-${hc}`, `v-${hr}-${hc + 1}`];
    s = run(dots, 'a', edges.slice(0, 3).map(dotMove), s);
    s = run(dots, 'a', [dotMove(edges[3])], s);
    ok(s.boxes[s.heart] === 'b' && dots.score(s).b === 2 && dots.score(s).a === 0 && s.got === 1, 'closing the heart box is worth 2 points but still one box, and an extra turn');
    ok(dots.next(s)[0] === 'b', 'closing the heart gives the extra turn like any box');
    const fin = dPlay('sweet', 12, lcg(5)).s;
    ok(/points to/.test(dots.result(fin).sub), 'the result counts points in sweet');
    const idle = dots.init({ first: 'a' });
    ok(dots.score(idle).a === 0 && !idle.heart, 'no heart outside sweet');
  });

  await section('dots: scramble pre-drawn lines', () => {
    const seen = new Set();
    let allOk = true;
    for (let seed = 1; seed <= 80; seed++) {
      const s = dSetup(dSeeded('a', seed), 'a', 'scramble');
      const again = dSetup(dSeeded('b', seed), 'b', 'scramble');
      if (JSON.stringify(s.pre) !== JSON.stringify(again.pre)) allOk = false;
      if (s.pre.length < 4 || s.pre.length > 6 || new Set(s.pre).size !== s.pre.length) allOk = false;
      if (s.pre.some((k) => !DOT_KEYS.includes(k)) || DOT_KEYS.some((k) => s.pre.includes(k) !== !!(k[0] === 'h' ? s.h : s.v)[k[0] === 'h' ? Number(k[2]) * 4 + Number(k[4]) : Number(k[2]) * 5 + Number(k[4])])) allOk = false;
      if (s.order.length || s.boxes.some(Boolean)) allOk = false;
      for (let br = 0; br < 4; br++) for (let bc = 0; bc < 4; bc++) {
        const sides = [`h-${br}-${bc}`, `h-${br + 1}-${bc}`, `v-${br}-${bc}`, `v-${br}-${bc + 1}`].filter((k) => s.pre.includes(k)).length;
        if (sides > 2) allOk = false;
      }
      seen.add(s.pre.join());
    }
    ok(allOk, '80 seeds: 4 to 6 lines, no box closed, no box with three sides, same lines for the same seed');
    ok(seen.size >= 60, `every opening differs (${seen.size} distinct boards in 80 seeds)`);
    const s = dSetup(dSeeded('a', 7), 'a', 'scramble');
    ok(errOf(() => dots.apply(clone(s), 'a', dotMove(s.pre[0]))) === 'That line is already drawn', 'a pre-drawn line cannot be drawn again');
    ok(dots.next(s).length === 1 && dFree(s).length === 40 - s.pre.length, 'the game has exactly the remaining lines to play');
  });

  await section('dots: chains, sacrifices, moments, strips', () => {
    // a three-box row: whoever takes it can take all, or hand over the last two to keep control
    const setupRow = ['h-0-0', 'h-0-1', 'h-0-2', 'h-1-0', 'h-1-1', 'h-1-2', 'v-0-0'].map(dotMove);
    const row = run(dots, 'a', setupRow);
    ok(dots.next(row)[0] === 'b' && row.boxes.every((x) => !x), 'a three-box row is open for the second player');
    const greedy = run(dots, 'a', ['v-0-1', 'v-0-2', 'v-0-3'].map(dotMove), row);
    const g = dInfo.analyze(greedy);
    ok(g.best.n === 3 && g.best.who === 'b' && g.steps.slice(-3).map((x) => x.run).join() === '1,2,3' && g.sacs.length === 0, 'taking all three counts a 3-box chain and is no sacrifice');
    const dealt = run(dots, 'a', ['v-0-1', 'v-0-3'].map(dotMove), row);
    const dl = dInfo.analyze(dealt);
    ok(dl.sacs.length === 1 && dl.sacs[0].who === 'b' && dots.next(dealt)[0] === 'a', 'taking one and leaving two for the other player is detected as a sacrifice');
    const taken = run(dots, 'a', [dotMove('v-0-2')], dealt);
    const tk = dInfo.analyze(taken);
    ok(tk.steps[tk.steps.length - 1].closed.length === 2 && tk.runs[tk.runs.length - 1].who === 'a' && tk.sacs.length === 1, 'the double-cross line closes both boxes in one go');
    const plain = dInfo.analyze(run(dots, 'a', ['v-0-3'].map(dotMove), row));
    ok(plain.sacs.length === 0, 'handing boxes over without having taken any is not called a sacrifice');
    // moment lines
    const total = Object.values(dInfo.MOMENTS).reduce((n, l) => n + l.length, 0) + Object.values(dInfo.STRIP).reduce((n, l) => n + l.length, 0);
    ok(total >= 40 && dInfo.PROMPTS.length >= 40 && new Set(dInfo.PROMPTS).size === dInfo.PROMPTS.length, `${total} moment and strip lines, ${dInfo.PROMPTS.length} distinct heart prompts`);
    ok(Object.values(dInfo.MOMENTS).every((l) => l.length >= 3), 'every situation has at least three lines to vary');
    const nm = (w) => (w === 'a' ? 'Emerson' : 'Sydney');
    const fin = dPlay('classic', 21, lcg(8)).s;
    const an = dInfo.analyze(fin);
    const res = dots.result(fin);
    const w = res.winner || 'a';
    const fake = { ...an, best: { n: 1, who: null }, sacs: [], behind: { a: 0, b: 0 } };
    const lead = { ...fake, pts: { a: 9, b: 7 } };
    const lines = (before, res2, anx = lead) => dInfo.pickMoment(fin, anx, res2, before, nm, 77);
    ok(/Emerson/.test(lines({ streak: 2, streakWho: 'a', chain: 9, mw: 3 }, { winner: 'a' })) && /3/.test(lines({ streak: 2, streakWho: 'a', chain: 9, mw: 3 }, { winner: 'a' })), 'a third win in a row is celebrated with the count');
    ok(/Sydney/.test(lines({ streak: 3, streakWho: 'b', chain: 9, mw: 3 }, { winner: 'a' })) && /3/.test(lines({ streak: 3, streakWho: 'b', chain: 9, mw: 3 }, { winner: 'a' })), 'breaking a streak names the streak');
    ok(lines(null, { winner: null }) === lines(null, { winner: null }) && dInfo.MOMENTS.draw.includes(lines(null, { winner: null })), 'a draw gets a draw line, the same one on both phones');
    ok(/6/.test(lines({ streak: 0, streakWho: '', chain: 3, mw: 2 }, { winner: 'a' }, { ...lead, best: { n: 6, who: 'a' } })), 'a new chain record names the chain');
    ok(dInfo.MOMENTS.chainFirst.map((t) => t.replace('{n}', '6')).includes(lines({ streak: 0, streakWho: '', chain: 0, mw: 0 }, { winner: 'a' }, { ...lead, best: { n: 6, who: 'a' } })) && !/record|longest|frame/i.test(dInfo.MOMENTS.chainFirst.join()), 'with nothing on the books yet, a long chain is a first, not a record');
    ok(dInfo.MOMENTS.comeback.some((t) => t.includes('{W}')) && /Emerson|Sydney/.test(lines(null, { winner: 'b' }, { ...lead, pts: { a: 7, b: 9 }, behind: { a: 0, b: 5 } })), 'a comeback line names the winner');
    ok(!/[{}]/.test(['win', 'rout', 'photo', 'draw'].map((k) => dInfo.MOMENTS[k].map((t) => t.replace(/\{\w+\}/g, 'x')).join()).join()), 'no stray placeholders');
    const s1 = dInfo.pickStrip({}, nm, 'm1');
    const s2 = dInfo.pickStrip({ games_n: 4, streak: 3, streak_who: 'b', w_a_n: 1, w_b_n: 3 }, nm, 'm1');
    ok(dInfo.STRIP.first.includes(s1) && /Sydney/.test(s2) && /3/.test(s2), 'the strip knows a first game and a streak');
    ok(/Emerson/.test(dInfo.pickStrip({ games_n: 2, streak: 1, streak_who: 'a', w_a_n: 2, w_b_n: 0 }, nm, 'q')) && /2/.test(dInfo.pickStrip({ games_n: 4, streak: 1, streak_who: 'a', w_a_n: 2, w_b_n: 2 }, nm, 'q')), 'the strip shows who won last and a level series');
    void w;
  });

  await section('dots: squeeze counts, hearts, ledger lines', () => {
    const t0 = dInfo.tension(dSeeded('a', 1));
    ok(t0.safe === 40 && t0.offer === 0 && t0.left === 40, 'an empty board has 40 safe lines and nothing on offer');
    const row = run(dots, 'a', ['h-0-0', 'h-0-1', 'h-0-2', 'h-1-0', 'h-1-1', 'h-1-2', 'v-0-0'].map(dotMove));
    ok(dInfo.tension(row).offer === 3, 'a three-box row on offer counts all three boxes (the chain is walked)');
    const dealt = run(dots, 'a', ['v-0-1', 'v-0-3'].map(dotMove), row);
    ok(dInfo.tension(dealt).offer === 2, 'the handed-over pair counts two');
    const lone = run(dots, 'a', ['h-0-0', 'h-1-0', 'v-0-0'].map(dotMove));
    ok(dInfo.tension(lone).offer === 1 && dInfo.tension(lone).safe === 36, 'one box on offer, and the line that takes it is no longer safe');
    // a position with exactly one safe line left, found by playing only safe lines
    const safeKeys = (s) => dFree(s).filter((k) => { const s2 = dots.apply(clone(s), s.turn, dotMove(k)); return s2.got === 0 && dInfo.tension(s2).offer === 0; });
    let found = null;
    for (let seed = 1; seed < 400 && !found; seed++) {
      const rnd = lcg(seed);
      let s = dSetup(dSeeded('a', 1), 'a', 'quick');
      const moves = [{ role: 'a', move: { setup: 2, mode: 'quick' } }];
      for (;;) {
        const sk = safeKeys(s);
        if (sk.length === 1) { found = { moves, last: sk[0], s }; break; }
        if (!sk.length) break;
        const k = sk[Math.floor(rnd() * sk.length)];
        const who = dots.next(s)[0];
        moves.push({ role: who, move: dotMove(k) });
        s = dots.apply(clone(s), who, dotMove(k));
      }
    }
    ok(found && dInfo.tension(found.s).safe === 1 && dInfo.tension(found.s).offer === 0, `found a 3×3 position with exactly one safe line (${found && found.moves.length - 1} lines in)`);
    const after = dots.apply(clone(found.s), found.s.turn, dotMove(found.last));
    ok(dInfo.tension(after).safe === 0 && dInfo.tension(after).offer === 0 && dInfo.tension(after).left > 0, 'drawing it leaves no safe lines, and the next player has to give');
    DOTS_SAFE = { moves: found.moves, last: found.last };
    // hearts
    const nm = (w) => (w === 'a' ? 'Emerson' : 'Sydney');
    const lead = dInfo.pickStrip({ games_n: 3, hearts_a_n: 1, hearts_b_n: 3 }, nm, 'k', 'sweet');
    ok(/Sydney/.test(lead) && /3/.test(lead) && /1/.test(lead), `the Sweetheart strip tells the heart race ("${lead}")`);
    ok(/2/.test(dInfo.pickStrip({ games_n: 4, hearts_a_n: 2, hearts_b_n: 2 }, nm, 'k', 'sweet')) && !/heart/i.test(dInfo.pickStrip({ games_n: 4, hearts_a_n: 2, hearts_b_n: 2, w_a_n: 2, w_b_n: 2 }, nm, 'k', 'classic')), 'level hearts say so, and only in Sweetheart');
    const hs = { heart: 3, boxes: [], n: 5 };
    hs.boxes[3] = 'a';
    const fake = { steps: [], runs: [], pts: { a: 9, b: 8 }, behind: { a: 0, b: 0 }, best: { n: 1, who: null }, sacs: [] };
    const hm = dInfo.pickMoment(hs, fake, { winner: 'a' }, null, nm, 5);
    ok(dInfo.MOMENTS.heartSwing.map((t) => t.replace(/\{W\}/g, 'Emerson').replace(/\{L\}/g, 'Sydney').replace('{m}', '1')).includes(hm), `a one-point win that hinged on the heart says so ("${hm}")`);
    ok(!dInfo.MOMENTS.heartSwing.includes(dInfo.pickMoment({ ...hs, boxes: Object.assign([], { 3: 'b' }) }, fake, { winner: 'a' }, null, nm, 5)), 'if the loser closed the heart it is not a heart swing');
  });

  await section('ultimate rules', () => {
    const mv = (pairs) => pairs.map(([b, i]) => ({ b, i }));
    let s = run(ult, 'a', mv([[4, 0]]));
    ok(s.force === 0, 'playing square 0 sends the opponent to board 0');
    ok(/top-left/.test(errOf(() => ult.apply(clone(s), 'b', { b: 1, i: 0 })) || ''), 'playing outside the board you were sent to is rejected');
    ok(errOf(() => ult.apply(clone(s), 'b', { b: 0, i: 5 })) === null, 'playing inside it is fine');
    s = run(ult, 'a', mv([[4, 4]]));
    ok(errOf(() => ult.apply(clone(s), 'b', { b: 4, i: 4 })) === 'That square is taken', 'a taken square is rejected');
    // a wins board 0, then b sends a to board 0 → a may play anywhere open
    s = run(ult, 'a', mv([[4, 4], [4, 0], [0, 0], [0, 4], [4, 8], [8, 0], [0, 1], [1, 0], [0, 2]]));
    ok(s.big[0] === 'a' && s.force === 2, 'three in a row wins a small board (and still sends on)');
    s = run(ult, 'a', mv([[2, 0]]), s);
    ok(s.force === null, 'being sent to a won board means a free move');
    ok(/won/.test(errOf(() => ult.apply(clone(s), 'a', { b: 0, i: 5 })) || ''), 'a won board takes no more moves');
    const sent = run(ult, 'a', mv([[1, 1]]), s); // b now has to play in board 1
    ok(sent.force === 1 && /have to play in the top board/.test(errOf(() => ult.apply(clone(sent), 'b', { b: 0, i: 5 })) || ''), 'tapping a won board while sent elsewhere names the board you have to play in');
    ok([1, 2, 3, 5, 6, 7, 8].every((b) => errOf(() => ult.apply(clone(s), 'a', { b, i: 3 })) === null), 'a free move can go in any open board');
    // win a board by playing its own matching square → free move
    let c = ult.init({ first: 'a' });
    c.cells[36] = 'a'; c.cells[44] = 'a'; c.force = 4;
    c = ult.apply(c, 'a', { b: 4, i: 4 });
    ok(c.big[4] === 'a' && c.force === null, 'sending someone to the board you just won frees them');
    // dead board, then no line left for anyone → count decides
    const crafted = (big, b, cells, turn) => { const st = ult.init({ first: turn }); st.big = big; cells.forEach(([i, w]) => { st.cells[b * 9 + i] = w; }); st.force = b; return st; };
    const near = [[0, 'a'], [1, 'b'], [2, 'a'], [3, 'a'], [4, 'b'], [5, 'b'], [7, 'a'], [8, 'a']]; // a draw pattern, missing square 6
    c = crafted(['a', 'b', 'a', 'b', 'b', 'a', 'a', 'a', null], 8, near, 'b');
    ok(ult.next(c).length === 1, 'game goes on while a big line is still possible');
    c = ult.apply(c, 'b', { b: 8, i: 6 });
    ok(c.big[8] === 'd', 'a small board that fills with no winner is dead');
    ok(ult.next(c).length === 0 && c.end.why === 'count' && ult.result(c).winner === 'a', 'no line left: most boards won (5–3) wins');
    c = crafted(['a', 'b', 'a', 'b', 'a', 'b', 'b', 'a', null], 8, near, 'b');
    c = ult.apply(c, 'b', { b: 8, i: 6 });
    ok(ult.next(c).length === 0 && ult.result(c).winner === null && /draw/i.test(ult.result(c).sub), 'no line left and boards tied 4–4: a draw');
    c = crafted(['a', 'b', 'a', null, 'd', 'b', 'a', 'b', null], 3, [[0, 'b'], [1, 'b']], 'b');
    ok(ult.next(c).length === 1, 'a can still make the left column, so play continues');
    c = ult.apply(c, 'b', { b: 3, i: 2 });
    ok(c.big[8] === null && ult.next(c).length === 0 && ult.result(c).winner === 'b', 'game ends as soon as no line is possible, even with a board open (b wins 4–3)');
    s = run(ult, 'b', mv(ULT_WIN));
    ok(s.end && s.end.why === 'line' && ult.result(s).winner === 'b', 'three small boards in a row wins the game');
    ok(errOf(() => ult.apply(clone(s), 'a', { b: 8, i: 8 })) !== null, 'no moves after the game is won');
    ok(ult.score(s).b >= 3, 'score counts boards won');
    // hundreds of random games: the send rule holds on every move, and every game ends
    const rnd = lcg(7);
    let ends = { line: 0, count: 0 };
    for (let g = 0; g < 300; g++) {
      let st = ult.init({ first: g % 2 ? 'a' : 'b' });
      let moves = 0;
      while (ult.next(st).length) {
        const legal = [];
        for (let b = 0; b < 9; b++) { if (st.big[b] || (st.force !== null && st.force !== b)) continue; for (let i = 0; i < 9; i++) if (!st.cells[b * 9 + i]) legal.push([b, i]); }
        if (!legal.length) throw new Error(`FAIL: ultimate: game ${g} has no legal move but is not over`);
        const [b, i] = legal[Math.floor(rnd() * legal.length)];
        st = ult.apply(clone(st), st.turn, { b, i });
        moves++;
        if (!st.end && st.force !== (st.big[i] ? null : i)) throw new Error(`FAIL: ultimate: send rule broken in game ${g}`);
        if (st.force !== null && st.big[st.force]) throw new Error(`FAIL: ultimate: sent to a closed board in game ${g}`);
        if (moves > 81) throw new Error('FAIL: ultimate: more than 81 moves');
      }
      ends[st.end.why]++;
      const r = ult.result(st);
      if (st.end.why === 'line' && r.winner !== st.end.who) throw new Error('FAIL: ultimate: line winner wrong');
    }
    ok(ends.line > 0 && ends.count > 0, `300 random games all end cleanly (${ends.line} on a line, ${ends.count} on boards)`);
    const d = core.derive(ult, { first: 'a', seed: 1, lists: { a: [{ b: 4, i: 0 }], b: [{ b: 5, i: 5 }, { b: 0, i: 4 }] } });
    ok(d.rejected.length === 1 && /top-left/.test(d.rejected[0].error), 'engine replay drops a move in the wrong board');
  });

  await section('ultimate v2: legacy replay, setup move, komi, Hot Boards, Wildcards, Last Light', () => {
    const mv = (pairs) => pairs.map(([b, i]) => ({ b, i }));
    // the original rules, copied verbatim from before v2: legacy logs must replay exactly like this
    const LINES0 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    const NAMES0 = ['top-left', 'top', 'top-right', 'left', 'middle', 'right', 'bottom-left', 'bottom', 'bottom-right'];
    const lineOf0 = (arr) => { for (const L of LINES0) { const v = arr[L[0]]; if ((v === 'a' || v === 'b') && arr[L[1]] === v && arr[L[2]] === v) return { who: v, line: L }; } return null; };
    const canStill0 = (big, w) => LINES0.some((L) => L.every((k) => big[k] === null || big[k] === w));
    const ref = {
      init: (first) => ({ cells: Array(81).fill(null), big: Array(9).fill(null), force: null, turn: first, last: null, end: null }),
      apply(s, who, move) {
        const b = move && move.b; const i = move && move.i;
        let err = null;
        if (s.end) err = 'The game is over';
        else if (!Number.isInteger(b) || b < 0 || b > 8 || !Number.isInteger(i) || i < 0 || i > 8) err = 'Pick a square';
        else if (who !== s.turn) err = 'Not your turn';
        else if (s.force !== null && s.force !== b) err = `You have to play in the ${NAMES0[s.force]} board`;
        else if (s.big[b] === 'd') err = 'That board is full';
        else if (s.big[b]) err = 'That board is already won';
        else if (s.cells[b * 9 + i]) err = 'That square is taken';
        if (err) throw new Error(err);
        s.cells[b * 9 + i] = who; s.last = b * 9 + i;
        const small = s.cells.slice(b * 9, b * 9 + 9);
        if (lineOf0(small)) s.big[b] = who; else if (small.every(Boolean)) s.big[b] = 'd';
        s.force = s.big[i] ? null : i; s.turn = who === 'a' ? 'b' : 'a';
        const big = lineOf0(s.big);
        if (big) s.end = { why: 'line', who: big.who, line: big.line };
        else if (!canStill0(s.big, 'a') && !canStill0(s.big, 'b')) {
          const a = s.big.filter((x) => x === 'a').length; const bb = s.big.filter((x) => x === 'b').length;
          s.end = { why: 'count', who: a > bb ? 'a' : bb > a ? 'b' : null, a, b: bb };
        }
        return s;
      },
    };
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const bare = (s) => { const c = clone(s); delete c.seed; return c; };
    const seeded = (first, seed) => { const s = ult.init({ first, seed, opts: {} }); s.seed = seed; return s; };
    const step = (s, m, who) => ult.apply(clone(s), who || s.turn, clone(m));
    const flow = (s, seq) => seq.reduce((st, m) => step(st, m), s);
    const other2 = (w) => (w === 'a' ? 'b' : 'a');
    // replay a role-relative fixture log ({ first, seed, lists }) into a state, move by move in turn order
    const flowLists = (fx) => { let st = seeded(fx.first, fx.seed); const used = { a: 0, b: 0 }; for (let g = 0; g < 400; g++) { const w = st.end ? null : st.turn; if (!w || used[w] >= fx.lists[w].length) break; st = step(st, fx.lists[w][used[w]++]); } return st; };

    // 1. legacy: no setup move, same states and results as the original rules
    let a = ref.init('b'); let b = seeded('b', 11);
    let allSame = true;
    for (const m of mv(ULT_WIN)) { a = ref.apply(a, a.turn, m); b = step(b, m); if (!same(bare(b), a)) allSame = false; }
    ok(allSame && b.v === undefined && b.end.why === 'line' && same(ult.result(b), { winner: 'b', sub: 'Three boards in a row' }), 'legacy: the old ULT_WIN log (no setup) replays to the same state and result as the original rules');
    const dl = core.derive(ult, { first: 'b', seed: 3, lists: { a: mv(ULT_WIN).filter((_, i) => i % 2), b: mv(ULT_WIN).filter((_, i) => !(i % 2)) } });
    ok(dl.over && dl.result.winner === 'b' && dl.rejected.length === 0 && dl.state.v === undefined && !('mode' in dl.state) && !('hot' in dl.state) && !('wild' in dl.state), 'legacy: through the engine, the old log ends with b winning, nothing rejected, no v2 fields appear');
    const refResult = (x) => {
      const e = x.end; const a = x.big.filter((v) => v === 'a').length; const bb = x.big.filter((v) => v === 'b').length;
      if (e && e.why === 'line') return { winner: e.who, sub: 'Three boards in a row' };
      if (e && e.who) return { winner: e.who, sub: `No big line was left, so boards won decide it: ${Math.max(a, bb)} to ${Math.min(a, bb)}` };
      return { winner: null, text: 'Stalemate', sub: `No big line was left and boards won are tied ${a}–${bb}. It’s a draw.` };
    };
    const rl = lcg(321);
    let legacyOk = true; let legacyEnds = 0; let legacyErrs = true;
    for (let g = 0; g < 250; g++) {
      let x = ref.init(g % 2 ? 'a' : 'b'); let y = seeded(g % 2 ? 'a' : 'b', g);
      for (let n = 0; n < 90 && !x.end; n++) {
        let m;
        if (rl() < 0.15) m = { b: Math.floor(rl() * 10) - 1, i: Math.floor(rl() * 10) - 1 }; // some junk and illegal moves too
        else { const legal = []; for (let bb = 0; bb < 9; bb++) { if (x.big[bb] || (x.force !== null && x.force !== bb)) continue; for (let i = 0; i < 9; i++) if (!x.cells[bb * 9 + i]) legal.push({ b: bb, i }); } if (!legal.length) break; m = legal[Math.floor(rl() * legal.length)]; }
        let ex = null; let ey = null; let nx; let ny;
        try { nx = ref.apply(clone(x), x.turn, clone(m)); } catch (e) { ex = e.message; }
        try { ny = ult.apply(clone(y), y.turn, clone(m)); } catch (e) { ey = e.message; }
        if (ex !== ey) legacyErrs = false;
        if (ex === null && ey === null) {
          x = nx; y = ny;
          if (!same(bare(y), x) || ult.next(y).length !== (x.end || x.big.every(Boolean) ? 0 : 1)) legacyOk = false;
          if (!same(ult.score(y), { a: x.big.filter((v) => v === 'a').length, b: x.big.filter((v) => v === 'b').length })) legacyOk = false;
        }
      }
      if (x.end) { legacyEnds++; if (!same(ult.result(y), refResult(x))) legacyOk = false; }
    }
    ok(legacyOk && legacyErrs && legacyEnds > 150, `legacy: 250 random logs (with junk and illegal moves) match the original rules move for move: states, errors, scores and results (${legacyEnds} finished)`);
    ok(errOf(() => ult.apply(seeded('a', 1), 'a', { steal: 1 })) === 'Pick a square' && errOf(() => ult.apply(flow(seeded('a', 1), mv([[4, 4]])), 'b', { steal: 1 })) === 'Pick a square', 'legacy: { steal: 1 } is just a bad move (plain "Pick a square"), the pie rule never shipped');
    ok(ult.apply(flow(seeded('a', 1), mv([[4, 4]])), 'b', { b: 4, i: 3, wild: 1 }).cells[39] === 'b' && !ult.apply(flow(seeded('a', 1), mv([[4, 4]])), 'b', { b: 4, i: 3, wild: 1 }).wild, 'legacy: an extra wild flag is ignored, as every unknown field always was');

    // 2. the setup move
    const s0 = seeded('a', 5);
    let s = step(s0, { setup: 2, mode: 'classic' });
    ok(s.v === 2 && s.mode === 'classic' && s.turn === 'a' && s.first === 'a' && ult.next(s).length === 1 && ult.next(s)[0] === 'a' && s.cells.every((x) => !x), 'setup: sets v = 2 and the mode, and does not pass the turn');
    ok(errOf(() => step(s0, { setup: 2, mode: 'classic' }, 'b')) === 'Not your turn', 'setup: only the first mover may send it');
    ok(errOf(() => step(flow(s0, mv([[4, 4]])), { setup: 2, mode: 'classic' })) !== null && errOf(() => step(flow(s0, mv([[4, 4]])), { setup: 2, mode: 'classic' }, 'a')) !== null, 'setup: refused once any mark is on the board');
    ok(errOf(() => step(s, { setup: 2, mode: 'hot' })) !== null, 'setup: refused a second time');
    ok(['nope', undefined, 7, 'constructor', '__proto__'].every((m) => errOf(() => step(s0, { setup: 2, mode: m })) === 'Unknown mode'), 'setup: an unknown mode is rejected ("Unknown mode")');
    ok(errOf(() => step(s0, { setup: 1, mode: 'classic' })) !== null && errOf(() => step(s0, { setup: 3, mode: 'classic' })) !== null, 'setup: only version 2');
    ok(errOf(() => step(flow(s0, mv([[4, 4]])), { setup: 2, mode: 'classic' }, 'b')) !== null, 'setup: the second player cannot send it either, before or after the first mark');
    for (const mode of ['classic', 'hot', 'wild']) {
      const run1 = flow(step(seeded('b', 9), { setup: 2, mode }), mv(ULT_WIN));
      ok(run1.end && run1.end.who === 'b' && run1.big.every((x, i) => x === flow(seeded('b', 9), mv(ULT_WIN)).big[i]), `setup: a ${mode} game plays the same moves as classic rules (log wins for b)`);
    }
    const dv = core.derive(ult, { first: 'a', seed: 4, lists: { a: [{ setup: 2, mode: 'hot' }, { b: 4, i: 0 }], b: [{ setup: 2, mode: 'wild' }, { b: 0, i: 5 }] } });
    ok(dv.state.mode === 'hot' && dv.rejected.length === 1 && dv.rejected[0].who === 'b' && dv.count === 3 && dv.state.cells[5] === 'b', 'engine replay: a setup from the second player is dropped, the rest plays on');

    // 3. random v2 games: send rule always holds, every game ends, and v2 has no draws
    const rb = lcg(5);
    let sendOk = true; let finished = 0; let noDraw = true; let ties = 0;
    for (let g = 0; g < 300; g++) {
      let st = step(seeded(g % 2 ? 'a' : 'b', g), { setup: 2, mode: ['classic', 'hot', 'wild'][g % 3] });
      let n = 0;
      while (ult.next(st).length) {
        const w = st.turn;
        const legal = []; for (let bb = 0; bb < 9; bb++) { if (st.big[bb] || (st.force !== null && st.force !== bb)) continue; for (let i = 0; i < 9; i++) if (!st.cells[bb * 9 + i]) legal.push({ b: bb, i }); }
        let m = legal[Math.floor(rb() * legal.length)];
        if (st.mode === 'wild' && st.force !== null && st.wild[w] && rb() < 0.2) { const free = []; for (let bb = 0; bb < 9; bb++) { if (st.big[bb] || bb === st.force) continue; for (let i = 0; i < 9; i++) if (!st.cells[bb * 9 + i]) free.push({ b: bb, i, wild: 1 }); } if (free.length) m = free[Math.floor(rb() * free.length)]; }
        st = step(st, m, w);
        n++;
        if (!st.end && st.force !== (st.big[m.i] ? null : m.i)) sendOk = false;
        if (n > 90) throw new Error('FAIL: ultimate v2: game never ends');
      }
      if (!st.end || !st.end.who || !ult.result(st).winner) noDraw = false;
      if (st.end && st.end.tie) { ties++; if (st.end.who === st.first) noDraw = false; }
      finished++;
    }
    ok(sendOk && noDraw && finished === 300, `300 random v2 games across all modes (wildcards thrown in): the send rule holds on every move, every game ends with a winner, never a draw (${ties} ended tied on boards)`);

    // 4. Hot Boards
    const hs = (seed) => step(seeded('a', seed), { setup: 2, mode: 'hot' });
    const h1 = hs(1); const h1b = hs(1);
    const PAIRS = ['0,8', '1,7', '2,6', '3,5'];
    ok(same(h1.hot, h1b.hot) && PAIRS.includes(h1.hot.join()), 'hot: the hot boards are one opposite pair through the centre (0&8, 1&7, 2&6 or 3&5), the same for the same seed');
    const variety = new Set(Array.from({ length: 40 }, (_, k) => hs(k).hot.join()));
    ok([...variety].every((x) => PAIRS.includes(x)) && variety.size === 4, `hot: every seed gives one of the four pairs, and all four turn up (${[...variety].sort().join(' / ')} in 40 seeds)`);
    ok(Array.from({ length: 40 }, (_, k) => hs(k)).every((x, k) => x.hot.join() === hs(k).hot.join()), 'hot: deterministic per seed');
    let hc = hs(2);
    const hotB = hc.hot[0]; const coldB = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((x) => !hc.hot.includes(x));
    const win = (st, b, w, cells) => { const c = clone(st); cells.forEach((i) => { c.cells[b * 9 + i] = w; }); return c; };
    hc.big[hotB] = 'a';
    ok(ult.score(hc).a === 2 && ult.score(hc).b === 0, 'hot: a hot board counts 2 in the boards-won score');
    hc.big[coldB] = 'b';
    ok(ult.score(hc).b === 1, 'hot: an ordinary board still counts 1');
    // a count ending: hot board decides it
    const crafted = (big, b, cells, turn, base) => { const st = clone(base); st.big = big; cells.forEach(([i, w]) => { st.cells[b * 9 + i] = w; }); st.force = b; st.turn = turn; return st; };
    const near = [[0, 'a'], [1, 'b'], [2, 'a'], [3, 'a'], [4, 'b'], [5, 'b'], [7, 'a'], [8, 'a']];
    const hb = hs(3); const hotSet = hb.hot;
    // boards: 8 is the open one; give 'a' 3 boards and 'b' 4 so that without a hot weight b would lead; put a's boards on the hot ones where possible
    const bigC = ['a', 'b', 'a', 'b', 'a', 'b', 'b', 'a', null];
    let hz = crafted(bigC, 8, near, 'b', hb);
    hz.hot = [0, 2]; // two of a's boards are hot: a 2+2+1+1 = 6 vs b 4 (4–4 without hot boards)
    hz = step(hz, { b: 8, i: 6 });
    ok(hz.end && hz.end.why === 'count' && hz.end.who === 'a' && hz.end.a === 6 && hz.end.b === 4 && /double/.test(ult.result(hz).sub), 'hot: the count ending weighs hot boards double (a wins 6–4, where it would have been a draw at 4–4), and the result says so');
    let hq = crafted(bigC, 8, near, 'b', hb); hq.hot = [1, 3]; hq = step(hq, { b: 8, i: 6 });
    ok(hq.end.who === 'b' && hq.end.b === 6 && hq.end.a === 4, 'hot: with b\'s boards hot, b wins the count instead');
    // big line rules are unchanged: a line of boards wins whatever is hot
    const hl = flow(step(seeded('b', 9), { setup: 2, mode: 'hot' }), mv(ULT_WIN));
    ok(hl.end.why === 'line' && hl.end.who === 'b', 'hot: three boards in a row still wins outright');
    ok(step(hs(4), { b: 0, i: 0 }).hot.join() === hs(4).hot.join() && step(hs(4), { b: 0, i: 0 }).force === 0, 'hot: hot boards do not change the send rule');

    // 5. Wildcards
    const ws = (seed) => step(seeded('a', seed), { setup: 2, mode: 'wild' });
    let w1 = ws(1);
    ok(same(w1.wild, { a: 1, b: 1 }), 'wild: each player starts with one wildcard');
    w1 = flow(w1, mv([[4, 0]])); // b is sent to board 0
    ok(/have to play in the top-left/.test(errOf(() => step(w1, { b: 5, i: 5 })) || ''), 'wild: without the wildcard you still have to obey the send');
    const w2 = step(w1, { b: 5, i: 5, wild: 1 });
    ok(w2.cells[5 * 9 + 5] === 'b' && w2.wild.b === 0 && w2.wild.a === 1 && w2.force === 5 && w2.turn === 'a', 'wild: a wildcard plays in any open board; the send rule carries on from the square (sent to board 5)');
    const w3 = flow(w2, mv([[5, 1]])); // a obeys; b is sent to board 1
    ok(/already/.test(errOf(() => step(w3, { b: 7, i: 7, wild: 1 })) || ''), 'wild: a second use is refused with a friendly message (used already)');
    ok(errOf(() => step(w3, { b: 7, i: 7, wild: 1 })) === 'You’ve used your wildcard already' && w3.wild.b === 0 && step(w3, { b: 1, i: 1 }).turn === 'a', 'wild: refusing it changes nothing, the normal move still works');
    let wf = flow(ws(3), mv([[4, 4], [4, 0], [0, 0]])); // a free? board 0 is open: still forced
    wf.big[3] = 'a'; wf.force = null; wf.turn = 'b';
    ok(/play anywhere/.test(errOf(() => step(wf, { b: 7, i: 7, wild: 1 })) || '') && wf.wild.b === 1, 'wild: on a free move it is refused ("keep your wildcard") and not spent');
    const w4 = flow(ws(5), mv([[2, 3]])); // b sent to board 3
    ok(/sent to/.test(errOf(() => step(w4, { b: 3, i: 4, wild: 1 })) || ''), 'wild: using it on the board you were sent to is refused and not spent');
    ok(/closed|already won|full/i.test(errOf(() => step({ ...w2, big: w2.big.map((x, i) => (i === 7 ? 'a' : x)), turn: 'b', force: 4 }, { b: 7, i: 0, wild: 1 })) || ''), 'wild: it cannot go into a won board');
    ok(/no wildcards/i.test(errOf(() => step(flow(step(seeded('a', 1), { setup: 2, mode: 'classic' }), mv([[4, 0]])), { b: 5, i: 5, wild: 1 })) || '') && /no wildcards/i.test(errOf(() => step(flow(hs(1), mv([[4, 0]])), { b: 5, i: 5, wild: 1 })) || ''), 'wild: classic and hot have no wildcards');
    ok(w2.lw === 1 && step(w2, { b: 5, i: 0 }).lw === 0, 'wild: the state remembers when the last move was a wildcard');

    // 5b. komi: a count ending tied on boards goes to the player who moved second (v2 only)
    const komiGame = (first, mode, hotPair) => {
      let st = crafted(bigC, 8, near, 'b', step(seeded(first, 3), { setup: 2, mode }));
      if (hotPair) st.hot = hotPair;
      return step(st, { b: 8, i: 6 });
    };
    ok(same(ult.kit.BALANCE, { komi: true }), 'the BALANCE section is isolated and on (komi)');
    ok(ult.howTo.length <= 4 && ult.howTo.some((l) => /Tied on boards at the end\? The player who went second wins\./.test(l)), 'howTo: at most four lines, one of them states the tie rule');
    for (const mode of ['classic', 'wild']) {
      const ka = komiGame('a', mode); const kb2 = komiGame('b', mode);
      ok(ka.end.why === 'count' && ka.end.a === 4 && ka.end.b === 4 && ka.end.tie === 1 && ka.end.who === 'b' && ult.result(ka).winner === 'b' && kb2.end.who === 'a' && ult.result(kb2).winner === 'a' && ult.next(ka).length === 0, `komi (${mode}): tied 4–4 on the count, the player who went second wins (b when a opened, a when b opened)`);
    }
    const kh = komiGame('a', 'hot', [0, 1]); // a has hot board 0, b has hot board 1: 5–5 weighted
    ok(kh.end.a === 5 && kh.end.b === 5 && kh.end.tie === 1 && kh.end.who === 'b' && komiGame('b', 'hot', [0, 1]).end.who === 'a', 'komi (hot): a weighted tie (5–5) goes to the second mover as well');
    ok(komiGame('a', 'hot', [0, 2]).end.who === 'a' && !komiGame('a', 'hot', [0, 2]).end.tie && komiGame('a', 'hot', [1, 3]).end.who === 'b', 'komi: only an exact tie is decided by it, a lead still wins');
    const rk = ult.result(komiGame('a', 'classic'));
    ok(rk.winner === 'b' && rk.sub === 'Boards tied 4–4 — ties go to the player who went second.' && !('text' in rk), 'komi: the result says the tie went to the player who went second');
    const rkh = ult.result(kh); const nmE = (w) => (w === 'a' ? 'Emerson' : 'Sydney');
    ok(rkh.sub === 'Boards tied 5–5, hot boards counting double — ties go to the player who went second.' && ult.kit.tiePlate(kh, nmE) === 'Boards tied 5–5, hot boards counting double: Sydney wins the tie-break' && ult.kit.tieLight(kh, nmE) === 'No big line left. Boards tied 5–5, hot boards counting double: ties go to Sydney', 'komi (hot): the result, the plate and the Last Light line all say the tie was on hot-weighted boards');
    ok(ult.kit.tiePlate(komiGame('a', 'classic'), nmE) === 'Boards tied 4–4: Sydney wins the tie-break' && ult.kit.tieLight(komiGame('a', 'classic'), nmE) === 'No big line left. Boards tied 4–4: ties go to Sydney' && !/hot/.test(rk.sub), 'komi (classic): no hot clause in a plain tie');
    const hotTie = clone(kh); hotTie.big = hotTie.big.map((x) => x); hotTie.hot = [0, 1];
    ok(ult.kit.momentKeys(hotTie, ult.result(hotTie), {}).keys[0] === 'komi' && ult.kit.momentKeys(hotTie, ult.result(hotTie), {}).keys.indexOf('komi') < ult.kit.momentKeys(hotTie, ult.result(hotTie), {}).keys.indexOf('hot'), 'moment: a hot game decided by the tie-break gets the komi moment, not the hot one');
    const legacyTie = step(crafted(bigC, 8, near, 'b', seeded('a', 3)), { b: 8, i: 6 });
    ok(legacyTie.end.who === null && !legacyTie.end.tie && ult.result(legacyTie).winner === null && ult.result(legacyTie).text === 'Stalemate' && legacyTie.v === undefined, 'komi: a legacy (no setup) game tied on the count is still a draw, untouched');
    ok(errOf(() => step(flow(step(seeded('a', 2), { setup: 2, mode: 'classic' }), mv([[6, 2]])), { steal: 1 })) === 'Pick a square', 'the pie rule is gone: { steal: 1 } is rejected like any bad move, in v2 too');
    const tn = (st) => ult.kit.tieNote(st, (w) => (w === 'a' ? 'Emerson' : 'Sydney'));
    const lvl = step(seeded('a', 2), { setup: 2, mode: 'classic' }); lvl.big = ['a', 'b', null, null, null, null, null, null, null];
    const up = clone(lvl); up.big[2] = 'a';
    ok(tn(lvl) === 'Tied on boards so far: ties go to Sydney' && tn(up) === null && tn(Object.assign(seeded('a', 2), { big: lvl.big })) === null && ult.kit.secondMover(lvl) === 'b', 'komi: the tie note names the second mover while boards are level, and only in v2');
    ok(/^Tied on boards so far, hot boards counting double: ties go to Sydney$/.test(tn(Object.assign(clone(lvl), { mode: 'hot', hot: [5, 6] }))), 'komi (hot): the in-play tie note carries the hot clause too');

    // 5c. Match point, Denied!, series ledger (view-only helpers) and the dn counter
    {
      const B = (str) => [...str].map((x) => (x === '.' ? null : x));
      const mp = (big, turn, force) => ult.kit.matchPoint({ big: B(big), turn, force, end: null });
      ok(mp('aa.......', 'a', 2) && !mp('aa.......', 'a', 3) && !mp('aa.......', 'b', 2), 'match point: the player to move is one board from the win only when the board they are sent to completes a big line of theirs');
      ok(mp('aa.......', 'a', null) && mp('a...a....', 'a', null) && !mp('ab.......', 'a', null) && !mp('.........', 'a', null), 'match point: on a free move any open board counts; a blocked line does not; an empty big board has none');
      const wmp = (mode, wild, force) => ult.kit.matchPoint({ big: B('aa.......'), turn: 'a', force, end: null, mode, wild });
      ok(wmp('wild', { a: 1, b: 1 }, 3) === true && wmp('wild', { a: 0, b: 1 }, 3) === false && wmp('wild', { a: 1, b: 0 }, 3) === true && wmp('classic', undefined, 3) === false && wmp('hot', undefined, 3) === false && wmp('wild', { a: 1, b: 1 }, 2) === true, 'match point (wild): a held wildcard reaches any open board, so it counts like a free move; a spent one, or other modes, do not');
      ok(!ult.kit.matchPoint({ big: B('aa.......'), turn: 'a', force: 2, end: { why: 'line' } }) && mp('aad......', 'a', 2) === false, 'match point: nothing once the game is over, and a dead board in the line blocks it');
      const dn1 = ult.kit.deniedNow({ big: B('aa.......') }, { big: B('aab......'), last: 2 * 9 + 4 });
      ok(dn1 === true && ult.kit.deniedNow({ big: B('aa.......') }, { big: B('aaa......'), last: 2 * 9 + 4 }) === false && ult.kit.deniedNow({ big: B('ab.......') }, { big: B('abb......'), last: 2 * 9 + 4 }) === false && ult.kit.deniedNow({ big: B('aa.......') }, { big: B('aa.b.....'), last: 3 * 9 }) === false && ult.kit.deniedNow(null, { big: B('aab......'), last: 20 }) === false, 'denied: winning the third board of a line the other player held two of is a denial; completing your own line, blocking a line they only held one of, or any other board is not');
      ok(ult.kit.denies(B('b........'), 2, 'a') === false && ult.kit.denies(B('bba......'), 2, 'a') === true && ult.kit.denies(B('b.b......'), 1, 'a') === true && ult.kit.denies(B('b.b......'), 1, 'b') === false, 'denied: the helper works on any line through the board');
      // fixtures from real play, and the dn counter agrees with the view-only check on every move
      const rq = lcg(2026);
      for (let g = 0; g < 4000 && !(ULT_MP && ULT_DENY && ULT_COUNT); g++) {
        const first = g % 2 ? 'a' : 'b';
        let st = step(seeded(first, 500 + g), { setup: 2, mode: 'classic' });
        const lists = { a: [], b: [] };
        lists[first].push({ setup: 2, mode: 'classic' });
        let n = 0; const exp = { a: 0, b: 0 }; let countPre = null;
        while (ult.next(st).length && n < 90) {
          if (!ULT_MP && n > 8 && ult.kit.matchPoint(st)) ULT_MP = { first, seed: 500 + g, lists: clone(lists), who: st.turn };
          const legal = []; for (let bb = 0; bb < 9; bb++) { if (st.big[bb] || (st.force !== null && st.force !== bb)) continue; for (let i = 0; i < 9; i++) if (!st.cells[bb * 9 + i]) legal.push({ b: bb, i }); }
          // lean towards winning a small board, so denials and match points turn up
          const win = legal.filter((m) => { const t = clone(st); try { return ult.apply(t, t.turn, m).big[m.b] === st.turn; } catch { return false; } });
          const m = win.length && rq() < 0.6 ? win[Math.floor(rq() * win.length)] : legal[Math.floor(rq() * legal.length)];
          const prevSt = st; const who = st.turn;
          st = step(st, m);
          lists[who].push(m); n++;
          if (st.end && st.end.why === 'count') { const pre = clone(lists); pre[who].pop(); countPre = { pre, last: m, mover: who }; }
          if (ult.kit.deniedNow(prevSt, st)) { exp[who]++; if (!ULT_DENY && !st.end) { const pre = clone(lists); pre[who].pop(); ULT_DENY = { first, seed: 500 + g, lists: clone(lists), pre, last: m, mover: who }; } }
        }
        if (st.dn.a !== exp.a || st.dn.b !== exp.b) throw new Error(`FAIL: the dn counter disagrees with deniedNow in game ${g}`);
        if (!ULT_COUNT && st.end && st.end.why === 'count' && countPre) ULT_COUNT = { first, seed: 500 + g, pre: countPre.pre, last: countPre.last, mover: countPre.mover, text: ult.result(st).sub };
      }
      ok(!!ULT_COUNT, 'a real v2 game that ends on the boards count was found for the finale layout test');
      ok(!!ULT_MP && !!ULT_DENY, 'match point and denied: found real games with a match-point position and with a denying last move');
      ok(ult.kit.matchPoint(flowLists(ULT_MP)) && flowLists(ULT_MP).turn === ULT_MP.who, 'match point: the fixture really is a match-point position for the player to move');
      const dnState = flowLists(ULT_DENY);
      ok(dnState.dn[ULT_DENY.mover] >= 1 && ult.kit.deniedNow(flowLists(ULT_DENY.pre), dnState), 'denied: the fixture log ends on a denial, and the dn counter saw it');
      const dnWin = clone(dnState); dnWin.end = { why: 'line', who: ULT_DENY.mover, line: [0, 1, 2] }; dnWin.down = { a: 2, b: 2 };
      const dk = ult.kit.momentKeys(dnWin, { winner: ULT_DENY.mover }, { games_n: 3 }).keys;
      ok(dk.includes('deny') && dk.includes('comeback') && dk.indexOf('comeback') < dk.indexOf('deny') && ult.kit.MOMENTS.deny.length >= 4, 'moment: a winner who denied a line gets the deny moment, right after comeback');
      const dnLoser = clone(dnWin); dnLoser.end.who = other2(ULT_DENY.mover); dnLoser.dn = { a: 0, b: 0 }; dnLoser.dn[ULT_DENY.mover] = 1;
      ok(!ult.kit.momentKeys(dnLoser, { winner: other2(ULT_DENY.mover) }, { games_n: 3 }).keys.includes('deny'), 'moment: the other player gets no deny moment');
      const lg = (d) => ult.kit.ledgerText(d, (w) => (w === 'a' ? 'Emerson' : 'Sydney'));
      ok(lg({ games_n: 9, wins_a_n: 5, wins_b_n: 4, streak: 2, streak_who: 'b' }) === 'Series: Emerson 5 · Sydney 4 · Sydney on 2' && lg({ games_n: 3, wins_a_n: 1, wins_b_n: 1, streak: 1, streak_who: 'b', draws_n: 1 }) === 'Series: Emerson 1 · Sydney 1 · 1 draw' && lg({ games_n: 5, wins_a_n: 1, wins_b_n: 1, draws_n: 3 }) === 'Series: Emerson 1 · Sydney 1 · 3 draws' && lg({}) === null, 'ledger: "Series: Emerson 5 · Sydney 4 · Sydney on 2", streaks only from 2, "1 draw" / "3 draws" only when there are some');
    }

    // 6. Last Light
    const bigs = (arr) => arr.map((x) => (x === '.' ? null : x));
    ok(ult.kit.liveLines(ult.init({ first: 'a' }).big).length === 8 && ult.kit.lastLight(ult.init({ first: 'a' })) === null, 'last light: all eight lines are alive at the start, nothing to say');
    const L2 = seeded('a', 1); L2.big = bigs(['a', 'b', 'd', 'a', 'd', 'b', 'a', '.', 'b']);
    ok(same(ult.kit.liveLines(L2.big), [3]) && ult.kit.lastLight(L2) === 'Only the left column can still win it', 'last light: names the only line left ("Only the left column can still win it")');
    const L3 = seeded('a', 1); L3.big = bigs(['a', 'a', '.', 'b', 'd', 'a', '.', 'b', 'b']);
    ok(ult.kit.liveLines(L3.big).length === 2 && ult.kit.lastLight(L3) === 'Only the top row and the bottom row can still win it', 'last light: names two lines when two are left');
    const L4 = seeded('a', 1); L4.big = bigs(['a', '.', '.', '.', '.', '.', '.', '.', '.']);
    ok(ult.kit.lastLight(L4) === null, 'last light: silent while many lines are alive');
    const L5 = seeded('a', 1); L5.big = bigs(['a', 'b', 'a', 'b', 'a', 'b', 'b', 'a', 'b']); L5.end = { why: 'count', who: 'b' };
    ok(ult.kit.lastLight(L5) === null, 'last light: nothing once the game is over');

    // a legal log (classic, v2) that stops when one or two big lines are left, for the UI to replay
    {
      const rr = lcg(77);
      for (let g = 0; g < 400 && !ULT_LL; g++) {
        const first = g % 2 ? 'a' : 'b';
        let st = step(seeded(first, 100 + g), { setup: 2, mode: 'classic' });
        const lists = { a: [], b: [] };
        lists[first].push({ setup: 2, mode: 'classic' });
        let n = 0;
        while (ult.next(st).length && n < 90) {
          if (n > 20 && ult.kit.lastLight(st)) { ULT_LL = { first, seed: 100 + g, lists, text: ult.kit.lastLight(st) }; break; }
          const legal = []; for (let bb = 0; bb < 9; bb++) { if (st.big[bb] || (st.force !== null && st.force !== bb)) continue; for (let i = 0; i < 9; i++) if (!st.cells[bb * 9 + i]) legal.push({ b: bb, i }); }
          if (!legal.length) break;
          const m = legal[Math.floor(rr() * legal.length)];
          lists[st.turn].push(m); st = step(st, m); n++;
        }
      }
      ok(!!ULT_LL && /^Only the .+ can still win it( · .+)?$/.test(ULT_LL.text), `last light: found a real game that gets down to ${ULT_LL ? '"' + ULT_LL.text + '"' : 'nothing'}`);
    }

    // 7. records, rivalry, moments
    const names = (w) => (w === 'a' ? 'Emerson' : 'Sydney');
    const pools = Object.values(ult.kit.MOMENTS);
    ok(pools.reduce((n, p) => n + p.length, 0) >= 20 && pools.every((p) => p.length >= 3) && Object.values(ult.kit.STRIPS).every((p) => p.length >= 2), `moments: a pool of ${pools.reduce((n, p) => n + p.length, 0)} lines keyed by situation, strips too`);
    const fin = (first, mode, seq, seed = 3) => flow(step(seeded(first, seed), { setup: 2, mode }), seq);
    const wonB = fin('b', 'classic', mv(ULT_WIN));
    const resB = ult.result(wonB);
    const t1 = ult.kit.tally({}, wonB, resB, 'm1');
    ok(t1.last_id === 'm1' && t1.games_n === 1 && t1.streak === 1 && t1.streak_who === 'b' && t1.streak_best === 1 && t1.wins_b_n === 1 && t1.classic_b_n === 1 && t1.line_n === 1 && t1.quick_best === 82 - 23 && !('draws_n' in t1), 'records: a first win sets the streak, per-mode wins, the fast record');
    const t1b = ult.kit.tally({}, wonB, resB, 'm1');
    ok(same(t1, t1b), 'records: the same inputs always give the same values (two phones agree)');
    ok(Object.keys(t1).every((k) => /^[a-zA-Z0-9_.-]{1,60}$/.test(k) && ['number', 'string'].includes(typeof t1[k])) && !('streak_n' in t1) && Object.keys(t1).filter((k) => /_(m|best|pb|n)$/.test(k)).every((k) => typeof t1[k] === 'number' && (k !== 'streak_best_who')), 'records: valid flat keys; only the counters that go up end in _n/_best');
    const t2 = ult.kit.tally({ ...t1 }, wonB, resB, 'm2');
    ok(t2.streak === 2 && t2.games_n === 2 && t2.wins_b_n === 2 && !('quick_best' in t2) && t2.streak_best === 2, 'records: a second win extends the streak, the counts and the best streak; an equal-speed win is not a new record');
    const kk = ult.kit.momentKeys(wonB, resB, { ...t1 });
    ok(kk.keys[0] === 'streakExt' && kk.k.streakExt === 2, 'moment: a second win in a row is a streak extended');
    const kb = ult.kit.momentKeys(wonB, resB, { streak: 3, streak_who: 'a', games_n: 5 });
    ok(kb.keys[0] === 'streakBreak' && kb.k.streakBreak === 3, 'moment: ending the other player\'s 3-game streak is called out');
    const kr = ult.kit.momentKeys(wonB, resB, { ...t1, streak_who: '', streak: 0, quick_best: 82 - 40 });
    ok(kr.keys[0] === 'record', 'moment: a faster win than ever is a record');
    ok(ult.kit.momentKeys(wonB, resB, {}).keys.includes('firstMode') && !ult.kit.momentKeys(wonB, resB, { classic_b_n: 2 }).keys.includes('firstMode'), 'moment: a first win in a mode is noted');
    const draw = seeded('a', 1); draw.big = bigs(['a', 'b', 'a', 'b', 'a', 'b', 'b', 'a', 'd']); draw.end = { why: 'count', who: null, a: 4, b: 4 };
    ok(ult.kit.tally({ streak: 2, streak_who: 'a' }, draw, { winner: null }, 'm3').draws_n === 1 && !('streak' in ult.kit.tally({ streak: 2, streak_who: 'a' }, draw, { winner: null }, 'm3')) && ult.kit.momentKeys(draw, { winner: null }, {}).keys[0] === 'draw', 'records: a draw is counted, leaves the streak alone, and has its own moment');
    // comeback + komi + wild + hot situations from real play
    const cb = fin('a', 'classic', mv([[0, 0]]));
    cb.down = { a: 2, b: 0 };
    cb.end = { why: 'line', who: 'a', line: [0, 1, 2] }; cb.big = bigs(['a', 'a', 'a', 'b', 'b', '.', '.', '.', '.']);
    ok(ult.kit.momentKeys(cb, { winner: 'a' }, { games_n: 3, classic_a_n: 1 }).keys.includes('comeback') && ult.kit.tally({}, cb, { winner: 'a' }, 'x').comeback_n === 1, 'moment: a win after trailing by 2+ boards is a comeback');
    const tieWin = komiGame('a', 'classic');
    ok(ult.kit.momentKeys(tieWin, ult.result(tieWin), { games_n: 3, classic_b_n: 2 }).keys.includes('komi') && !ult.kit.momentKeys(tieWin, ult.result(tieWin), {}).keys.includes('stolen'), 'moment: winning on the tie-break is a komi moment');
    const wildWin = step(flow(ws(8), mv([[4, 0]])), { b: 5, i: 5, wild: 1 });
    wildWin.end = { why: 'line', who: 'b', line: [0, 1, 2] };
    ok(ult.kit.momentKeys(wildWin, { winner: 'b' }, { games_n: 3, wild_b_n: 1 }).keys.includes('wild'), 'moment: winning with the wildcard move is a wildcard moment');
    const hotWin = hs(6); hotWin.big[hotWin.hot[0]] = 'a'; hotWin.big[hotWin.hot[1]] = 'a'; hotWin.end = { why: 'count', who: 'a', a: 4, b: 1 };
    ok(ult.kit.momentKeys(hotWin, { winner: 'a' }, { games_n: 3, hot_a_n: 1 }).keys.includes('hot'), 'moment: winning on boards with hot boards is a hot moment');
    // text: stored code -> same text on both phones; no raw placeholders
    let texts = true;
    for (const [key, pool] of Object.entries(ult.kit.MOMENTS)) pool.forEach((_, idx) => { const tx = ult.kit.momentText(`${key}.${idx}.3`, wonB, resB, names); if (!tx || /[{}]/.test(tx)) texts = false; });
    ok(texts && ult.kit.momentText('nope.1.0', wonB, resB, names) === null && ult.kit.momentText('draw.99.0', wonB, resB, names) === null && ult.kit.momentText(undefined, wonB, resB, names) === null, 'moment: every line fills in cleanly; a garbled stored code shows nothing');
    ok(ult.kit.momentText(t1.last_moment, wonB, resB, names) === ult.kit.momentText(t1b.last_moment, wonB, resB, names) && /Sydney|Emerson|squares|board/.test(ult.kit.momentText(t1.last_moment, wonB, resB, names)), 'moment: both phones derive the same line from the stored code');
    const strips = [{}, { games_n: 3, streak: 3, streak_who: 'b' }, { games_n: 3, wins_a_n: 2, wins_b_n: 1, classic_a_n: 2, classic_b_n: 1 }, { games_n: 2, wins_a_n: 1, wins_b_n: 1, classic_a_n: 1, classic_b_n: 1 }, { games_n: 4, wins_a_n: 2, wins_b_n: 2, classic_a_n: 4 }];
    ok(strips.every((d) => { const x = ult.kit.stripText(d, 'classic', names, 'mm'); return x && !/[{}]/.test(x) && x === ult.kit.stripText(d, 'classic', names, 'mm'); }) && /Sydney/.test(ult.kit.stripText(strips[1], 'classic', names, 'mm')) && /Hot Boards/.test(ult.kit.stripText({ games_n: 3, wins_a_n: 2, wins_b_n: 1, classic_a_n: 3 }, 'hot', names, 'q')), 'rivalry strip: deterministic, names the streak holder, flags a first game in a mode');
  });
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── UI helpers ─────────────────────────────────────────────────────────
const SEL = {
  four: (col) => `.g-four .g4-col[data-col="${col}"]`,
  dots: (k) => `.g-dots .gd-hit[data-k="${k}"]`,
  ultimate: ([b, i]) => `.g-ult .gu-c[data-b="${b}"][data-i="${i}"]`,
};
const moveCount = (e) => e.lists.a.length + e.lists.b.length - [...e.lists.a, ...e.lists.b].filter((m) => m && m.setup !== undefined).length; // setup moves aren't plays
async function waitMoves(h, id, n, pages) {
  const t0 = Date.now();
  let es = [];
  while (Date.now() - t0 < 8000) {
    es = await Promise.all(pages.map((p) => h.engine(p, id)));
    if (es.every((e) => e && moveCount(e) === n)) return es;
    await h.wait(40);
  }
  throw new Error(`FAIL: expected ${n} moves on every phone, saw ${es.map((e) => e && moveCount(e)).join('/')}`);
}
async function toastSays(pg, re) {
  for (let t = 0; t < 30; t++) {
    const texts = await pg.$$eval('.toast', (ts) => ts.map((x) => x.textContent));
    if (texts.some((x) => re.test(x))) return true;
    await pg.waitForTimeout(50);
  }
  return false;
}
async function shot(pg, name) {
  await pg.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
async function seeBoard(pg) {
  await pg.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
  await pg.click('#game-root [data-g="end-look"]');
  await pg.waitForTimeout(150);
}

/**
 * Play a full online game by tapping (select, then confirm) on whichever phone may move.
 * `nextMove(state, actor, i)` returns the move key; `check(before, after, actor)` runs after each move.
 */
async function onlineGame(h, game, scheme, nextMove, { midAt, check } = {}) {
  const resultsBefore = h.results().filter((r) => r.game === game).length;
  const id = await h.newOnlineGame(h.a, game);
  await h.openMatch(h.b, id);
  await waitMoves(h, id, 0, [h.a, h.b]);
  const page = { a: h.a, b: h.b };
  let n = 0;
  let prev = await h.engine(h.a, id);
  while (!prev.over) {
    const actor = prev.acts[0];
    const pg = page[actor];
    const waiting = page[actor === 'a' ? 'b' : 'a'];
    const key = nextMove(prev.state, actor, n);
    const sel = SEL[game](key);
    if (n === 0) {
      const locked = await waiting.evaluate((g) => {
        const root = document.querySelector(`.g-${g}`);
        const btns = [...root.querySelectorAll('button')];
        return btns.length ? btns.every((b) => b.disabled) : root.classList.contains('is-locked');
      }, game === 'ultimate' ? 'ult' : game);
      ok(locked, `${game} (${scheme}): the board is locked on the phone that is waiting`);
    }
    await pg.tap(sel);
    if (n === midAt) {
      await pg.waitForTimeout(450);
      await shot(h.a, `${game}-${scheme}-390-mid`);
      await shot(h.b, `${game}-${scheme}-360-mid`);
    }
    const still = await h.engine(pg, id);
    if (moveCount(still) !== n) throw new Error(`FAIL: ${game}: the first tap must only select, not play`);
    await pg.tap(sel);
    n++;
    const [ea, eb] = await waitMoves(h, id, n, [h.a, h.b]);
    if (JSON.stringify(ea.state) !== JSON.stringify(eb.state)) throw new Error(`FAIL: ${game}: phones disagree after move ${n}`);
    if (check) check(prev, ea, actor);
    prev = ea;
    if (n > 200) throw new Error('FAIL: game never ended');
  }
  const [ea, eb] = await waitMoves(h, id, n, [h.a, h.b]);
  ok(ea.over && eb.over && JSON.stringify(ea.result) === JSON.stringify(eb.result), `${game} (${scheme}): online game over after ${n} moves, both phones agree (${ea.result.winner || 'draw'})`);
  await h.a.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
  await h.b.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
  await h.settle();
  const recs = h.results().filter((r) => r.game === game);
  ok(recs.length === resultsBefore + 1 && recs[recs.length - 1].winner === (ea.result.winner || 'draw'), `${game} (${scheme}): one result recorded with the right winner`);
  await shot(h.a, `${game}-${scheme}-390-endcard`);
  await seeBoard(h.a);
  await seeBoard(h.b);
  await h.wait(250);
  await shot(h.a, `${game}-${scheme}-390-end`);
  await shot(h.b, `${game}-${scheme}-360-end`);
  await h.closeGame(h.a);
  await h.closeGame(h.b);
  return { id, final: ea };
}

async function localId(pg) { return pg.evaluate(() => window.__lastMatchId); }
/** Leave whatever game screen is open (so one failed section can't break the next). */
async function leave(h, pg) {
  for (let t = 0; t < 3 && await pg.isVisible('#game-root [data-g="close"]'); t++) { await pg.click('#game-root [data-g="close"]').catch(() => {}); await pg.waitForTimeout(150); }
}
const visibleToast = async (pg) => pg.$$eval('.toast', (ts) => ts.length);

async function uiTests(scheme, port) {
  const h = await launch({ port, only: GAMES, colorScheme: scheme });
  try {
    await h.b.setViewportSize({ width: 360, height: 760 });

    // ── Four in a Row ──
    await section(`four online (${scheme})`, async () => {
      await leave(h, h.a); await leave(h, h.b);
      const other = (w) => (w === 'a' ? 'b' : 'a');
      const before = h.results().filter((r) => r.game === 'four').length;
      const id = await h.newOnlineGame(h.a, 'four');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      const first = h.matches().find((m) => m.id === id).first;
      const page = { a: h.a, b: h.b };
      const P1 = page[first];
      const P2 = page[other(first)];
      // the mode picker: only the first mover, who sees a rivalry line; the partner is told what's going on
      ok(await P1.isVisible('.g4-mc[data-mode="ghost"]') && await P1.isVisible('.g4-riv'), `four (${scheme}): the first mover sees the mode picker and the rivalry strip`);
      ok(!(await P2.isVisible('.g4-modes')) && /picking a mode/i.test(await P2.textContent('.g4-plate')), `four (${scheme}): the partner sees "is picking a mode…" and no picker`);
      ok(/first game|no history/i.test(await P1.textContent('.g4-riv')), `four (${scheme}): the empty board says it is the first game`);
      ok(await P1.$$eval('.g4-mc', (bs) => bs.every((b) => b.getBoundingClientRect().height >= 44)), `four (${scheme}): mode chips are at least 44 px tall`);
      await shot(h.a, `four-${scheme}-390-picker`);
      await shot(h.b, `four-${scheme}-360-picker`);
      ok(await P2.$$eval('.g4-col', (bs) => bs.every((b) => b.disabled)), `four (${scheme}): the board is locked on the phone that is waiting`);
      // a tap on the locked board gives a cue and plays nothing
      await P2.tap(SEL.four(3), { force: true }); // the column is disabled: the tap lands on the guard laid over it
      ok(await toastSays(P2, /picking a mode/i) && moveCount(await h.engine(P2, id)) === 0, `four (${scheme}): a tap out of turn gives a gentle cue and plays nothing`);
      let n = 0;
      let prev = await h.engine(h.a, id);
      while (!prev.over) {
        const actor = prev.acts[0];
        const pg = page[actor];
        const sel = SEL.four(TRAP_GAME[n]);
        await pg.tap(sel);
        if (n === 6) { await pg.waitForTimeout(450); await shot(h.a, `four-${scheme}-390-mid`); await shot(h.b, `four-${scheme}-360-mid`); }
        if (moveCount(await h.engine(pg, id)) !== n) throw new Error('FAIL: four: the first tap must only lift the disc, not play');
        await pg.tap(sel);
        n++;
        const [ea, eb] = await waitMoves(h, id, n, [h.a, h.b]); // (the setup move isn't counted)
        if (JSON.stringify(ea.state) !== JSON.stringify(eb.state)) throw new Error('FAIL: four: phones disagree after move ' + n);
        if (ea.state.n !== n) throw new Error('FAIL: four: one disc per move');
        if (n === 1) {
          const m = h.matches().find((x) => x.id === id);
          ok(JSON.stringify(m[first][0]) === '{"setup":2,"mode":"classic"}' && ea.state.v === 2 && ea.state.mode === 'classic', `four (${scheme}): the first tap-and-drop sends the setup move, then the disc`);
        }
        if (n === 5) {
          for (const pg2 of [h.a, h.b]) await pg2.waitForSelector('.g4-stamp', { timeout: 3500 });
          ok(/trap/i.test(await h.a.textContent('.g4-stamp')) && /trap/i.test(await h.b.textContent('.g4-stamp')) && ea.state.tr[first] === 1, `four (${scheme}): a double threat stamps "Trap!" on both phones`);
        }
        if (n === 3) {
          const waiting = page[ea.acts[0] === 'a' ? 'b' : 'a'];
          await waiting.tap(SEL.four(0), { force: true });
          ok(await toastSays(waiting, /’s turn/) && moveCount(await h.engine(waiting, id)) === n, `four (${scheme}): mid-game, a tap out of turn says whose turn it is and plays nothing`);
        }
        prev = ea;
        if (n > 40) throw new Error('FAIL: four never ended');
      }
      const [ea, eb] = await waitMoves(h, id, n, [h.a, h.b]);
      ok(ea.over && eb.over && JSON.stringify(ea.result) === JSON.stringify(eb.result) && ea.result.winner === first, `four (${scheme}): online game over after ${n} discs, both phones agree`);
      await h.a.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
      await h.b.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
      await h.settle();
      const recs = h.results().filter((r) => r.game === 'four');
      ok(recs.length === before + 1 && recs[recs.length - 1].winner === first, `four (${scheme}): one result recorded with the right winner`);
      // the books: both phones watched it end, it was counted once
      const gd = h.docs['gamedata/four'] || {};
      ok(gd.games_n === 1 && gd.last_id === id && gd.streak === 1 && gd.streak_who === first && gd[`wins_${first}_n`] === 1 && gd[`classic_${first}_n`] === 1 && gd.quick_best === 100 - 4 && gd.quick_best_who === first && gd[`trap_${first}_n`] === 1, `four (${scheme}): both phones saw it end and the records were counted once (${JSON.stringify(gd)})`);
      await seeBoard(h.a);
      await seeBoard(h.b);
      await h.wait(400);
      const ma = await h.a.textContent('.g4-moment');
      const mb = await h.b.textContent('.g4-moment');
      ok(ma.length > 4 && ma === mb && /trap|fork|threats? at once|double threat|blocked one/i.test(ma) && await h.a.isVisible('.g4-moment'), `four (${scheme}): both phones show the same moment line ("${ma}")`);
      await shot(h.a, `four-${scheme}-390-end`);
      await shot(h.b, `four-${scheme}-360-end`);
      await h.closeGame(h.a);
      await h.closeGame(h.b);
    });

    // ── Four: landscape phone, side by side, no scrolling ──
    await section(`four landscape (${scheme})`, async () => {
      await leave(h, h.a); await leave(h, h.b);
      const pg = h.a;
      for (const [w, ht] of [[844, 390], [667, 375]]) {
        await pg.setViewportSize({ width: w, height: ht });
        await h.newLocalGame(pg, 'four');
        await pg.waitForTimeout(450);
        const m = await pg.evaluate(() => {
          const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width }; };
          const gr = document.querySelector('#game-root');
          return { wrap: r('.g4-wrap'), plate: r('.g4-plate'), modes: r('.g4-modes'), col: r('.g4-col'), sh: gr.scrollHeight, ch: gr.clientHeight, dh: document.documentElement.scrollHeight, ih: innerHeight, sw: gr.scrollWidth, iw: innerWidth };
        });
        ok(m.sh <= m.ch + 1 && m.dh <= m.ih + 1 && m.sw <= m.iw + 1, `four (${scheme}): ${w}x${ht} fits with no scrolling`);
        ok(m.plate.l > m.wrap.r && m.modes.l > m.wrap.r && m.plate.b <= m.ih && m.modes.b <= m.ih, `four (${scheme}): ${w}x${ht} board left, picker and plate beside it, all on screen`);
        console.log(`   four ${w}x${ht}: board ${Math.round(m.wrap.w)}px wide, columns ${m.col.w.toFixed(1)}px`);
        ok(m.col.w >= 28, `four (${scheme}): ${w}x${ht} columns stay usable (${m.col.w.toFixed(1)}px)`);
        await pg.tap(SEL.four(2));
        ok(await pg.$eval('.g4-colhl', (x) => x.classList.contains('on')) && await pg.$eval('.g4-ghost', (x) => x.classList.contains('on')), `four (${scheme}): ${w}x${ht} a tapped column still shows where the disc will land`);
        await pg.tap(SEL.four(2));
        await pg.tap(SEL.four(3));
        await pg.waitForTimeout(900);
        if (w === 844) await shot(pg, `four-${scheme}-844x390`);
        await h.closeGame(pg);
      }
      await pg.setViewportSize({ width: 390, height: 844 });
    });

    // ── Four: the series strip shows on both phones, and the finale repeats it as a ledger ──
    await section(`four ledger online (${scheme})`, async () => {
      await leave(h, h.a); await leave(h, h.b);
      const other = (w) => (w === 'a' ? 'b' : 'a');
      const nm = { a: 'Emerson', b: 'Sydney' };
      const id = await h.newOnlineGame(h.a, 'four');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      const first = h.matches().find((m) => m.id === id).first;
      const page = { a: h.a, b: h.b };
      const P2 = page[other(first)];
      const tally = /Emerson \d+ · Sydney \d+/;
      ok(await page[first].isVisible('.g4-riv') && await P2.isVisible('.g4-riv') && tally.test(await P2.textContent('.g4-riv')) && await P2.textContent('.g4-riv') === await page[first].textContent('.g4-riv'), `four (${scheme}): the waiting phone sees the same series tally as the first mover (${await P2.textContent('.g4-riv')})`);
      const before = h.docs['gamedata/four'] || {};
      let n = 0;
      let prev = await h.engine(h.a, id);
      while (!prev.over) {
        const pg = page[prev.acts[0]];
        await pg.tap(SEL.four([0, 1, 0, 1, 0, 1, 0][n]));
        await pg.tap(SEL.four([0, 1, 0, 1, 0, 1, 0][n]));
        n++;
        [prev] = await waitMoves(h, id, n, [h.a, h.b]);
      }
      await h.a.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
      await h.b.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
      await h.settle();
      await seeBoard(h.a);
      await seeBoard(h.b);
      await h.wait(500);
      const gd = h.docs['gamedata/four'] || {};
      const want = `Series: Emerson ${gd.wins_a_n || 0} · Sydney ${gd.wins_b_n || 0}${gd.draws_n ? ` · ${gd.draws_n} draw${gd.draws_n === 1 ? '' : 's'}` : ''}${gd.streak >= 2 ? ` · ${nm[gd.streak_who]} on ${gd.streak}` : ''}`;
      const la = await h.a.textContent('.g4-ledger');
      const lb = await h.b.textContent('.g4-ledger');
      ok(gd.last_id === id && gd.games_n === before.games_n + 1, `four (${scheme}): the match was counted once`);
      ok(la === want && lb === want && await h.a.isVisible('.g4-ledger') && await h.b.isVisible('.g4-ledger'), `four (${scheme}): both phones show the ledger under the moment, equal to the books ("${la}")`);
      await shot(h.a, `four-${scheme}-390-ledger`);
      await h.closeGame(h.a); await h.closeGame(h.b);
    });

    // ── Four: small portrait phones, picker / pop buttons / strip, nothing scrolls ──
    await section(`four small portrait (${scheme})`, async () => {
      await leave(h, h.a); await leave(h, h.b);
      const pg = h.a;
      const fits = async (label, wantDesc) => {
        const m = await pg.evaluate(() => {
          const gr = document.querySelector('#game-root');
          const kids = [...document.querySelectorAll('.g-four *')].filter((e) => e.getClientRects().length && !e.closest('[hidden]'));
          const d = document.querySelector('.g4-mdesc');
          return { over: gr.scrollHeight - gr.clientHeight, ih: innerHeight, bottom: Math.max(...kids.map((e) => e.getBoundingClientRect().bottom)), sw: gr.scrollWidth - innerWidth, descH: d && !d.hidden ? d.getBoundingClientRect().height : 0, edge: document.querySelector('.g4-edge').getBoundingClientRect().bottom };
        });
        ok(m.over <= 0 && m.sw <= 0 && m.bottom <= m.ih - 8 && m.edge < m.ih, `four (${scheme}): ${label}: nothing scrolls and the board shadow is not clipped (over ${m.over}px, content ends ${Math.round(m.bottom)} of ${m.ih})`);
        if (wantDesc) ok(await pg.$$eval('.g4-mc', (bs) => new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size === 1 && bs.length === 4), `four (${scheme}): ${label}: the four mode chips sit on one row`);
        if (wantDesc) ok(m.descH > 0 && m.descH < 24, `four (${scheme}): ${label}: a one-line mode description shows (${Math.round(m.descH)}px)`);
      };
      for (const [w, ht] of [[390, 664], [360, 640], [360, 560]]) {
        await pg.setViewportSize({ width: w, height: ht });
        await h.newLocalGame(pg, 'four');
        await pg.waitForTimeout(350);
        await fits(`${w}x${ht} picker and strip`, true);
        await pg.click('.g4-mc[data-mode="pop"]');
        await fits(`${w}x${ht} PopOut picked`, true);
        await pg.tap(SEL.four(0));
        await pg.tap(SEL.four(0));
        await pg.waitForTimeout(800);
        ok(await pg.isVisible('.g4-acts') && await pg.isVisible('.g4-label'), `four (${scheme}): ${w}x${ht} the Drop / Pop buttons and the mode label show`);
        await fits(`${w}x${ht} Drop / Pop buttons and mode label`, false);
        await h.closeGame(pg);
      }
      await h.newLocalGame(pg, 'four');
      await pg.click('.g4-mc[data-mode="classic"]'); // leave the remembered mode as it was
      await h.closeGame(pg);
      await pg.setViewportSize({ width: 390, height: 844 });
    });

    // ── Dots & Boxes ──
    await section(`dots online (${scheme})`, async () => {
      await leave(h, h.a); await leave(h, h.b);
      const rnd = lcg(scheme === 'dark' ? 5 : 3);
      const order = [...DOT_KEYS];
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      let extras = 0;
      let doubles = 0;
      let momentP = null;
      let ledgerP = null;
      const { id: dotsId, final } = await onlineGame(h, 'dots', scheme, (s) => order.find((k) => !s.order.includes(k)), {
        midAt: 22,
        check: (before, after, actor) => {
          if (after.over && !momentP) momentP = Promise.all([h.a, h.b].map((p) => p.waitForSelector('.g-dots .gd-m:not([hidden])', { timeout: 7000 }).then(() => p.textContent('.g-dots .gd-m')))).catch(() => null);
          if (after.over && !ledgerP) ledgerP = Promise.all([h.a, h.b].map((p) => p.waitForSelector('.g-dots .gd-ledger:not([hidden])', { timeout: 7000 }).then(() => p.textContent('.g-dots .gd-ledger')))).catch(() => null);
          const closed = after.state.boxes.filter(Boolean).length - before.state.boxes.filter(Boolean).length;
          if (closed && !after.over) { extras++; if (after.acts[0] !== actor) throw new Error('FAIL: dots: closing a box must give another turn'); }
          if (!closed && !after.over && after.acts[0] === actor) throw new Error('FAIL: dots: turn must pass when no box closes');
          if (closed === 2) doubles++;
        },
      });
      ok(extras > 0, `dots (${scheme}): ${extras} extra turns after closing boxes, all correct${doubles ? ` (${doubles} double)` : ''}`);
      const sc = final.state.boxes.reduce((m, w) => ({ ...m, [w]: m[w] + 1 }), { a: 0, b: 0 });
      ok(sc.a + sc.b === 16 && final.state.order.length === 40, `dots (${scheme}): ends with every line drawn, ${sc.a}–${sc.b}`);
      const mm = await momentP;
      ok(mm && mm[0] && mm[0] === mm[1], `dots (${scheme}): both phones close with the same moment line ("${mm && mm[0]}")`);
      const gd = h.docs['gamedata/dots'] || {};
      const lg = await ledgerP;
      const wantLedger = `Series: Emerson ${gd.w_a_n || 0} · Sydney ${gd.w_b_n || 0}${gd.draws_n ? ` · ${gd.draws_n} draw${gd.draws_n === 1 ? '' : 's'}` : ''}`;
      ok(lg && lg[0] === lg[1] && lg[0] === wantLedger, `dots (${scheme}): both phones print the same series ledger, matching the stored records ("${lg && lg[0]}")`);
      const dw = final.result.winner;
      ok(gd.games_n === 1 && gd.last_id === dotsId && (dw ? gd.streak === 1 && gd.streak_who === dw && gd.classic_a_n + gd.classic_b_n === 1 : gd.draws_n === 1), `dots (${scheme}): both phones saw it end, but it was counted once`);
    });

    // ── Dots & Boxes: modes, chains, keyboard, landscape, records (builder D) ──
    const dotsBoard = async (pg) => pg.evaluate(() => ({ dots: document.querySelectorAll('.g-dots .gd-dot').length, modes: document.querySelectorAll('.g-dots .gd-mode').length, chip: (document.querySelector('.g-dots .gd-modechip') || {}).textContent || '', plate: document.querySelector('.g-dots .gd-plate-t').textContent }));
    const dotsPlay = async (id, k, n) => {
      const e = await h.engine(h.a, id);
      const pg = e.acts[0] === 'a' ? h.a : h.b;
      await pg.tap(SEL.dots(k));
      await pg.tap(SEL.dots(k));
      await waitMoves(h, id, n, [h.a, h.b]);
      return pg;
    };
    const dotsPickClassic = async (pg) => { const b = pg.locator('.g-dots .gd-mode[data-mode="classic"]'); if (await b.count()) await b.tap(); };

    await section(`dots modes: picker, setup then move, both phones agree (${scheme})`, async () => {
      await leave(h, h.a); await leave(h, h.b);
      const id = await h.newOnlineGame(h.a, 'dots');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      const first = (await h.engine(h.a, id)).acts[0];
      const mover = first === 'a' ? h.a : h.b;
      const waiter = first === 'a' ? h.b : h.a;
      ok(await mover.$$eval('.g-dots .gd-mode', (xs) => xs.length === 5 && xs.every((x) => x.getBoundingClientRect().height >= 44)), `dots (${scheme}): the first mover sees five mode chips, each at least 44px tall`);
      const w = await dotsBoard(waiter);
      ok(w.modes === 0 && /picking a mode/.test(w.plate), `dots (${scheme}): the waiting phone has no picker and says they are picking a mode`);
      await mover.tap('.g-dots .gd-mode[data-mode="sweet"]');
      ok(await mover.$$eval('.g-dots .gd-box.gd-open .gd-heart', (xs) => xs.length) === 1, `dots (${scheme}): picking Sweetheart previews the heart box`);
      await shot(mover, `dots-${scheme}-${first === 'a' ? 390 : 360}-picker-sweet`);
      await mover.tap('.g-dots .gd-mode[data-mode="scramble"]');
      const pre = await mover.$$eval('.g-dots .gd-lo.gd-s', (xs) => xs.length);
      ok(pre >= 4 && pre <= 6, `dots (${scheme}): picking Scramble previews its ${pre} pre-drawn lines`);
      await shot(mover, `dots-${scheme}-${first === 'a' ? 390 : 360}-picker-scramble`);
      await mover.tap('.g-dots .gd-mode[data-mode="quick"]');
      ok((await dotsBoard(mover)).dots === 16 && (await dotsBoard(waiter)).dots === 25, `dots (${scheme}): the picker redraws the board (3×3) for the mover only`);
      await h.settle();
      ok((h.docs['gamedata/dots'] || {}).mode === 'quick', `dots (${scheme}): the choice is stored for rematches`);
      await dotsPlay(id, 'h-1-1', 1);
      const [ea, eb] = await Promise.all([h.engine(h.a, id), h.engine(h.b, id)]);
      ok(ea.state.ver === 2 && ea.state.mode === 'quick' && ea.state.n === 4 && JSON.stringify(ea.state) === JSON.stringify(eb.state), `dots (${scheme}): setup and the first line both went through, and both phones agree`);
      const lists = [...ea.lists.a, ...ea.lists.b];
      ok(lists.filter((m) => m.setup === 2).length === 1 && (first === 'a' ? ea.lists.a : ea.lists.b)[0].setup === 2, `dots (${scheme}): the setup is the first move in the first mover's own list`);
      for (const pg of [h.a, h.b]) {
        const b = await dotsBoard(pg);
        ok(b.dots === 16 && b.modes === 0 && b.chip === 'Quick', `dots (${scheme}): after the first line both phones show the 3×3 board, no picker, and a "Quick" label`);
      }
      await shot(h.a, `dots-${scheme}-390-quick`);
      await shot(h.b, `dots-${scheme}-360-quick`);
      await leave(h, h.a); await leave(h, h.b);
      // a new match remembers the mode; tapping the board without touching the picker plays it
      const id2 = await h.newOnlineGame(h.a, 'dots');
      await h.openMatch(h.b, id2);
      await waitMoves(h, id2, 0, [h.a, h.b]);
      const first2 = (await h.engine(h.a, id2)).acts[0];
      const mover2 = first2 === 'a' ? h.a : h.b;
      ok(await mover2.$eval('.g-dots .gd-mode[data-mode="quick"]', (x) => x.getAttribute('aria-checked') === 'true'), `dots (${scheme}): the next match starts on the mode you picked last`);
      await dotsPlay(id2, 'h-0-0', 1);
      ok((await h.engine(h.a, id2)).state.mode === 'quick', `dots (${scheme}): tapping the board without the picker plays the remembered mode`);
      await leave(h, h.a); await leave(h, h.b);
      // back to Classic for the sections that follow
      const id3 = await h.newOnlineGame(h.a, 'dots');
      await h.openMatch(h.b, id3);
      const first3 = (await h.engine(h.a, id3)).acts[0];
      await dotsPickClassic(first3 === 'a' ? h.a : h.b);
      await dotsPlay(id3, 'h-0-0', 1);
      const e3 = await h.engine(h.a, id3);
      ok(e3.state.mode === 'classic' && e3.state.n === 5, `dots (${scheme}): Classic is still the 4×4 game`);
      await leave(h, h.a); await leave(h, h.b);
    });

    await section(`dots chain meter and sacrifice (${scheme})`, async () => {
      await leave(h, h.a); await leave(h, h.b);
      const spy = () => { window.__hz = []; const o = AudioParam.prototype.setValueAtTime; AudioParam.prototype.setValueAtTime = function (v, t) { window.__hz.push(Math.round(v)); return o.call(this, v, t); }; };
      const row = ['h-0-0', 'h-0-1', 'h-0-2', 'h-1-0', 'h-1-1', 'h-1-2', 'v-0-0'];
      // a three-box chain, taken in one turn
      let id = await h.newOnlineGame(h.a, 'dots');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      let n = 0;
      for (const k of row) await dotsPlay(id, k, ++n);
      await h.a.evaluate(spy); await h.b.evaluate(spy);
      const taker = (await h.engine(h.a, id)).acts[0];
      const tpg = taker === 'a' ? h.a : h.b;
      const wpg = taker === 'a' ? h.b : h.a;
      await dotsPlay(id, 'v-0-1', ++n);
      await dotsPlay(id, 'v-0-2', ++n);
      ok(/Two boxes/.test(await tpg.textContent('.g-dots .gd-plate-t')), `dots (${scheme}): the plate counts the chain as it grows`);
      await dotsPlay(id, 'v-0-3', ++n);
      for (const pg of [tpg, wpg]) {
        await pg.waitForFunction(() => { const p = document.querySelector('.g-dots .gd-pop'); return p && !p.hidden && /Chain of 3!/.test(p.textContent); }, null, { timeout: 4000 });
      }
      ok(true, `dots (${scheme}): "Chain of 3!" stamps on both phones, the partner's as a replay`);
      await h.wait(300);
      await shot(tpg, `dots-${scheme}-${taker === 'a' ? 390 : 360}-chain`);
      for (const pg of [tpg, wpg]) {
        const hz = (await pg.evaluate(() => window.__hz)).filter((f) => f >= 320 && f <= 440);
        ok(hz.length >= 3 && hz.slice(0, 3).join() === '330,370,416', `dots (${scheme}): the box sounds climb in pitch (${hz.slice(0, 3).join(', ')} Hz)`);
      }
      await leave(h, h.a); await leave(h, h.b);
      // the same row, but the taker hands the last two over to keep control
      id = await h.newOnlineGame(h.a, 'dots');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      n = 0;
      for (const k of row) await dotsPlay(id, k, ++n);
      const t2 = (await h.engine(h.a, id)).acts[0];
      await dotsPlay(id, 'v-0-1', ++n);
      await dotsPlay(id, 'v-0-3', ++n);
      for (const pg of [h.a, h.b]) {
        await pg.waitForFunction((nm) => { const p = document.querySelector('.g-dots .gd-pop'); return p && !p.hidden && p.textContent.includes(nm + ' gives up 2 to keep control'); }, t2 === 'a' ? 'Emerson' : 'Sydney', { timeout: 4000 });
      }
      ok(true, `dots (${scheme}): the sacrifice is called out on both phones`);
      await shot(t2 === 'a' ? h.a : h.b, `dots-${scheme}-${t2 === 'a' ? 390 : 360}-sacrifice`);
      await leave(h, h.a); await leave(h, h.b);
    });

    await section(`dots sweetheart: closing the heart shows the prompt on both phones (${scheme})`, async () => {
      await leave(h, h.a); await leave(h, h.b);
      const id = await h.newOnlineGame(h.a, 'dots');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      const first = (await h.engine(h.a, id)).acts[0];
      await (first === 'a' ? h.a : h.b).tap('.g-dots .gd-mode[data-mode="sweet"]');
      const mover = first === 'a' ? h.a : h.b;
      const heart = await mover.evaluate(() => { const g = document.querySelector('.g-dots .gd-box.gd-open'); const m = g.getAttribute('transform').match(/translate\(([\d.]+) ([\d.]+)\)/); return { x: Number(m[1]), y: Number(m[2]) }; });
      const bc = Math.round((heart.x - 50 - 50) / 100);
      const br = Math.round((heart.y - 50 - 50) / 100);
      const edges = [`h-${br}-${bc}`, `h-${br + 1}-${bc}`, `v-${br}-${bc}`, `v-${br}-${bc + 1}`];
      let n = 0;
      for (const k of edges) await dotsPlay(id, k, ++n);
      const e = await h.engine(h.a, id);
      const closer = e.state.boxes[e.state.heart];
      ok(e.state.mode === 'sweet' && closer && e.state.heart === br * 4 + bc, `dots (${scheme}): the heart box is where the preview showed it`);
      const texts = [];
      for (const pg of [h.a, h.b]) {
        await pg.waitForSelector('.g-dots .gd-card:not([hidden])', { timeout: 4000 });
        texts.push(await pg.textContent('.g-dots .gd-card-t'));
        ok((await pg.textContent('.g-dots .gd-card-k')).includes(closer === 'a' ? 'Emerson' : 'Sydney') && await pg.$eval('.g-dots .gd-done', (x) => x.getBoundingClientRect().height >= 44), `dots (${scheme}): the prompt card names who closed the heart and has a 44px button`);
      }
      ok(texts[0] && texts[0] === texts[1], `dots (${scheme}): both phones show the same prompt ("${texts[0]}")`);
      await shot(h.a, `dots-${scheme}-390-heart`);
      await shot(h.b, `dots-${scheme}-360-heart`);
      await h.a.tap('.g-dots .gd-done');
      ok(await h.a.$eval('.g-dots .gd-card', (x) => x.hidden) && !(await h.b.$eval('.g-dots .gd-card', (x) => x.hidden)), `dots (${scheme}): Done hides the card on this phone only`);
      await leave(h, h.a); await leave(h, h.b);
    });

    await section(`dots scramble: pre-drawn lines cannot be drawn (${scheme})`, async () => {
      if (scheme !== 'light') return;
      await leave(h, h.a); await leave(h, h.b);
      await h.newLocalGame(h.a, 'dots');
      const pg = h.a;
      await pg.tap('.g-dots .gd-mode[data-mode="scramble"]');
      const keys = await pg.$$eval('.g-dots .gd-hit.is-drawn', (xs) => xs.map((x) => x.dataset.k));
      ok(keys.length >= 4 && keys.length <= 6, `dots (${scheme}): ${keys.length} pre-drawn lines show on the board`);
      await pg.tap(SEL.dots(keys[0]), { force: true });
      ok(await toastSays(pg, /already drawn/i) && moveCount(await h.engine(pg, await localId(pg))) === 0, `dots (${scheme}): a pre-drawn line is refused`);
      await shot(pg, `dots-${scheme}-390-scramble`);
      await dotsPickClassic(pg);
      await leave(h, h.a);
    });

    await section('dots keyboard: roving tabindex, arrows, Enter then Enter', async () => {
      if (scheme !== 'light') return;
      await leave(h, h.a); await leave(h, h.b);
      await h.newLocalGame(h.a, 'dots');
      const pg = h.a;
      const id = await localId(pg);
      const active = () => pg.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.k);
      ok(await pg.$$eval('.g-dots .gd-hit[tabindex="0"]', (xs) => xs.length) === 1 && await pg.$$eval('.g-dots .gd-hit[tabindex="-1"]', (xs) => xs.length) === 39, 'dots keys: the grid is one tab stop');
      await pg.focus(SEL.dots('h-0-0'));
      const press = async (k) => { await pg.keyboard.press(k); return active(); };
      ok(await press('ArrowRight') === 'h-0-1', 'dots keys: right moves along the row');
      ok(await press('ArrowDown') === 'v-0-1' && await press('ArrowDown') === 'h-1-1', 'dots keys: down goes through the next row of lines and keeps its column');
      ok(await press('ArrowUp') === 'v-0-1' && await press('ArrowUp') === 'h-0-1', 'dots keys: up comes back the same way');
      ok(await press('ArrowLeft') === 'h-0-0' && await press('ArrowLeft') === 'h-0-0', 'dots keys: the row ends at the edge');
      ok(await press('ArrowUp') === 'h-0-0', 'dots keys: and so does the top');
      ok(/Enter picks this line/.test(await pg.textContent('.gd-plate')) && await pg.$eval('.gd-pg', (x) => x.classList.contains('is-hover')), 'dots keys: moving the focus previews the line');
      await pg.keyboard.press('Enter');
      ok(await pg.$eval('.gd-pg', (x) => x.classList.contains('is-sel')) && /Enter again/.test(await pg.textContent('.gd-plate')) && moveCount(await h.engine(pg, id)) === 0, 'dots keys: Enter selects the line, it does not draw it');
      await pg.keyboard.press('Escape');
      ok(!(await pg.$eval('.gd-pg', (x) => x.classList.contains('is-sel'))), 'dots keys: Escape lets go');
      await pg.keyboard.press('Space');
      await pg.keyboard.press('Space');
      const e = await h.engine(pg, id);
      ok(moveCount(e) === 1 && e.state.order[0] === 'h-0-0' && e.state.mode === 'classic', 'dots keys: Space, Space draws it (after the mode setup)');
      const now = await active();
      ok(now && now !== 'h-0-0' && await pg.$$eval('.g-dots .gd-hit[tabindex="0"]', (xs) => xs.length) === 1, 'dots keys: focus stays in the grid, on a line still free');
      await pg.focus(SEL.dots('h-0-0'));
      ok(await press('ArrowRight') === 'h-0-1', 'dots keys: arrows step to the next free line');
      await pg.keyboard.press('Enter');
      await pg.keyboard.press('Enter');
      await pg.focus(SEL.dots('h-0-0'));
      ok(await press('ArrowRight') === 'h-0-2', 'dots keys: arrows skip lines already drawn');
      await pg.keyboard.press('Enter');
      await pg.keyboard.press('Enter');
      await pg.focus(SEL.dots('h-0-0'));
      await pg.keyboard.press('Enter');
      ok(await toastSays(pg, /already drawn/i), 'dots keys: Enter on a drawn line says so');
      await h.closeGame(pg);
    });

    await section(`dots landscape and small screens (${scheme})`, async () => {
      await leave(h, h.a); await leave(h, h.b);
      const pg = h.a;
      await h.newLocalGame(pg, 'dots');
      for (const [w, ht, tag] of [[844, 390, 'landscape'], [667, 375, 'landscape'], [360, 640, 'portrait'], [390, 844, 'portrait']]) {
        await pg.setViewportSize({ width: w, height: ht });
        await h.wait(250);
        const m = await pg.evaluate(() => {
          const r = (s) => { const x = document.querySelector(s); return x && x.getBoundingClientRect().toJSON(); };
          const root = document.querySelector('.g-dots');
          return { wrap: r('.gd-wrap'), plate: r('.gd-plate'), picker: r('.gd-picker'), ih: innerHeight, iw: innerWidth, rootScroll: root.scrollHeight - root.clientHeight, pageScroll: document.scrollingElement.scrollHeight - innerHeight, gameScroll: (() => { const g = document.querySelector('#game-root'); return g.scrollHeight - g.clientHeight; })(), hx: document.querySelector('#game-root').scrollWidth - innerWidth };
        });
        const where = `${w}×${ht}`;
        ok(m.hx <= 1, `dots (${scheme}) ${where}: no sideways scroll`);
        ok(m.wrap.right <= m.iw && m.wrap.left >= 0, `dots (${scheme}) ${where}: the board is on screen (${Math.round(m.wrap.width)}px)`);
        if (tag === 'landscape') {
          ok(m.plate.bottom <= m.ih && m.picker.bottom <= m.ih && m.wrap.bottom <= m.ih && m.pageScroll <= 1 && m.gameScroll <= 1 && m.rootScroll <= 1, `dots (${scheme}) ${where}: board, picker and plate all fit without scrolling`);
          ok(m.plate.left >= m.wrap.right - 2 && m.wrap.width >= 230, `dots (${scheme}) ${where}: plate beside the board, board ${Math.round(m.wrap.width)}px`);
        } else {
          ok(m.plate.bottom <= m.ih + 1 || m.rootScroll > 0, `dots (${scheme}) ${where}: plate on screen or the stage scrolls`);
          ok(m.wrap.width >= (ht < 700 ? 190 : 330), `dots (${scheme}) ${where}: board ${Math.round(m.wrap.width)}px`);
        }
        await shot(pg, `dots-${scheme}-${w}x${ht}-picker`);
      }
      // a few lines in, in landscape
      await pg.setViewportSize({ width: 844, height: 390 });
      await h.wait(250);
      for (const k of ['h-1-1', 'v-1-2', 'h-2-2']) await pg.click(SEL.dots(k));
      await h.wait(600);
      const m2 = await pg.evaluate(() => ({ pageScroll: document.scrollingElement.scrollHeight - innerHeight, plate: document.querySelector('.gd-plate').getBoundingClientRect().bottom, ih: innerHeight }));
      ok(m2.pageScroll <= 1 && m2.plate <= m2.ih, `dots (${scheme}) 844×390: still no scrolling once the picker has gone`);
      await shot(pg, `dots-${scheme}-844x390-play`);
      await pg.setViewportSize({ width: 390, height: 844 });
      await h.closeGame(pg);
      // a chain stamp in landscape stays beside the board, off the boxes
      await pg.setViewportSize({ width: 844, height: 390 });
      await h.newLocalGame(pg, 'dots');
      for (const k of ['h-0-0', 'h-0-1', 'h-0-2', 'h-1-0', 'h-1-1', 'h-1-2', 'v-0-0', 'v-0-1', 'v-0-2', 'v-0-3']) await pg.click(SEL.dots(k));
      await pg.waitForFunction(() => { const p = document.querySelector('.g-dots .gd-pop'); return p && !p.hidden && /Chain of 3/.test(p.textContent); }, null, { timeout: 4000 });
      const pr = await pg.evaluate(() => { const p = document.querySelector('.g-dots .gd-pop').getBoundingClientRect(); const w = document.querySelector('.g-dots .gd-wrap').getBoundingClientRect(); return { px: p.left, pr: p.right, wr: w.right, pt: p.top, pb: p.bottom, ih: innerHeight, lines: Math.round(p.height / 20) }; });
      ok(pr.px >= pr.wr - 1 && pr.pt >= 0 && pr.pb <= pr.ih && pr.lines <= 3, `dots (${scheme}) 844×390: the chain stamp sits beside the board, not over it`);
      await shot(pg, `dots-${scheme}-844x390-chain`);
      await pg.setViewportSize({ width: 390, height: 844 });
      await h.closeGame(pg);
      // the end view: the plate steps aside for the status line, and nothing scrolls
      for (const [w, ht] of [[844, 390], [667, 375]]) {
        await pg.setViewportSize({ width: w, height: ht });
        await h.newLocalGame(pg, 'dots');
        await pg.tap('.g-dots .gd-mode[data-mode="quick"]');
        const keys = [];
        for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) keys.push(`h-${r}-${c}`);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) keys.push(`v-${r}-${c}`);
        for (const k of keys) await pg.click(SEL.dots(k));
        await seeBoard(pg);
        await h.wait(300);
        const e = await pg.evaluate(() => ({ plate: getComputedStyle(document.querySelector('.g-dots .gd-plate')).display, status: document.querySelector('.gm-status').textContent.trim(), page: document.scrollingElement.scrollHeight - innerHeight, game: document.querySelector('#game-root').scrollHeight - document.querySelector('#game-root').clientHeight, root: (() => { const r = document.querySelector('.g-dots'); return r.scrollHeight - r.clientHeight; })(), wrap: document.querySelector('.gd-wrap').getBoundingClientRect().width }));
        ok(e.plate === 'none' && /win|draw|all/i.test(e.status), `dots (${scheme}) ${w}×${ht}: after "see the board" the result is said once (status line), not twice`);
        ok(e.page <= 1 && e.game <= 1 && e.root <= 1, `dots (${scheme}) ${w}×${ht}: the end view does not scroll (board ${Math.round(e.wrap)}px)`);
        await shot(pg, `dots-${scheme}-${w}x${ht}-endview`);
        await h.closeGame(pg);
      }
      await pg.setViewportSize({ width: 390, height: 844 });
      await h.newLocalGame(pg, 'dots');
      await dotsPickClassic(pg);
      await h.closeGame(pg);
    });

    await section(`dots records and rivalry strip (${scheme})`, async () => {
      if (scheme !== 'light') return;
      await leave(h, h.a); await leave(h, h.b);
      const pg = h.a;
      const before = clone(h.docs['gamedata/dots'] || {});
      const playQuick = async (seed) => {
        await h.newLocalGame(pg, 'dots');
        const id = await localId(pg);
        await pg.tap('.g-dots .gd-mode[data-mode="quick"]');
        const rnd = lcg(seed);
        const keys = [];
        for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) keys.push(`h-${r}-${c}`);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) keys.push(`v-${r}-${c}`);
        for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
        for (const k of keys) await pg.click(SEL.dots(k));
        const e = await h.engine(pg, id);
        await pg.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
        await h.settle();
        await h.closeGame(pg);
        return { id, e };
      };
      const g1 = await playQuick(11);
      const gd = h.docs['gamedata/dots'] || {};
      const w1 = g1.e.result.winner;
      ok(g1.e.over && g1.e.state.order.length === 24 && gd.last_id === g1.id && gd.games_n === (before.games_n || 0) + 1, `dots (${scheme}): a finished 3×3 game is counted once (games: ${gd.games_n})`);
      if (w1) ok(gd.streak_who === w1 && gd[`quick_${w1}_n`] >= 1 && gd[`w_${w1}_n`] >= 1 && gd.streak >= 1, `dots (${scheme}): the winner's streak and per-mode win are recorded`);
      else ok(gd.draws_n >= 1, `dots (${scheme}): a draw is counted as a draw`);
      ok(gd.p_g === (before.games_n || 0) && typeof gd.p_streak === 'number', `dots (${scheme}): the records as they were are kept for the moment line`);
      await h.newLocalGame(pg, 'dots');
      const strip = await pg.textContent('.g-dots .gd-strip');
      ok(strip && !/First game of Dots/.test(strip) && /Emerson|Sydney|all square|apiece|Even|Dead level/i.test(strip), `dots (${scheme}): the empty board shows the rivalry ("${strip}")`);
      await shot(pg, `dots-${scheme}-390-strip`);
      await dotsPickClassic(pg);
      await leave(h, pg);
    });

    await section(`dots squeeze: last safe line, then none left (${scheme})`, async () => {
      await leave(h, h.a); await leave(h, h.b);
      const id = await h.newOnlineGame(h.a, 'dots');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      const first = h.matches().find((m) => m.id === id).first;
      const lists = { a: [], b: [] };
      for (const { role, move } of DOTS_SAFE.moves) lists[role === 'a' ? first : first === 'a' ? 'b' : 'a'].push(move);
      await h.a.evaluate(([mid, L]) => globalThis.claude.use('db').then((db) => db.doc('matches/' + mid).update({ a: JSON.stringify(L.a), b: JSON.stringify(L.b) })), [id, lists]);
      const n = DOTS_SAFE.moves.length - 1;
      await waitMoves(h, id, n, [h.a, h.b]);
      await h.wait(300);
      const e = await h.engine(h.a, id);
      const mv = e.acts[0] === 'a' ? h.a : h.b;
      const wt = e.acts[0] === 'a' ? h.b : h.a;
      const plate = (pg) => pg.textContent('.g-dots .gd-plate-t');
      ok(/Last safe line!/.test(await plate(mv)) && /Last safe line!/.test(await plate(wt)), `dots (${scheme}): both phones say "Last safe line!" ("${await plate(mv)}" / "${await plate(wt)}")`);
      await shot(mv, `dots-${scheme}-390-lastsafe`);
      await dotsPlay(id, DOTS_SAFE.last, n + 1);
      await h.wait(300);
      const e2 = await h.engine(h.a, id);
      const nm = e2.acts[0] === 'a' ? 'Emerson' : 'Sydney';
      for (const pg of [h.a, h.b]) {
        const t = await plate(pg);
        ok(t.includes('No safe lines left') && t.includes(nm + ' has to give'), `dots (${scheme}): and with none left the plate says who has to give ("${t}")`);
      }
      await shot(h.b, `dots-${scheme}-360-nosafe`);
      // a box on offer
      await leave(h, h.a); await leave(h, h.b);
      const id2 = await h.newOnlineGame(h.a, 'dots');
      await h.openMatch(h.b, id2);
      await waitMoves(h, id2, 0, [h.a, h.b]);
      let k = 0;
      for (const key of ['h-0-0', 'h-0-1', 'h-0-2', 'h-1-0', 'h-1-1', 'h-1-2', 'v-0-0']) await dotsPlay(id2, key, ++k);
      for (const pg of [h.a, h.b]) ok(/3 boxes on offer/.test(await plate(pg)), `dots (${scheme}): a three-box row says "3 boxes on offer" on both phones ("${await plate(pg)}")`);
      await leave(h, h.a); await leave(h, h.b);
    });

    await section('dots hearts: tally, strip and ledger over two Sweetheart matches', async () => {
      if (scheme !== 'light') return;
      await leave(h, h.a); await leave(h, h.b);
      const pg = h.a;
      const before = clone(h.docs['gamedata/dots'] || {});
      const playSweet = async (seed) => {
        await h.newLocalGame(pg, 'dots');
        const id = await localId(pg);
        await pg.tap('.g-dots .gd-mode[data-mode="sweet"]');
        const rnd = lcg(seed);
        const keys = [...DOT_KEYS];
        for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
        for (const kk of keys) await pg.click(SEL.dots(kk));
        const e = await h.engine(pg, id);
        await pg.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
        await pg.waitForSelector('.g-dots .gd-ledger:not([hidden])', { timeout: 4000 });
        const gd = h.docs['gamedata/dots'] || {};
        const ledger = await pg.textContent('.g-dots .gd-ledger');
        const stamp = await pg.textContent('.g-dots .gd-m');
        await h.settle();
        await h.closeGame(pg);
        return { e, ledger, stamp, gd: clone(h.docs['gamedata/dots'] || {}) };
      };
      const g1 = await playSweet(21);
      const g2 = await playSweet(22);
      const hearts = (g) => (g.hearts_a_n || 0) + (g.hearts_b_n || 0);
      ok(hearts(g1.gd) === hearts(before) + 1 && hearts(g2.gd) === hearts(before) + 2, `dots: each Sweetheart match counts its heart once (hearts_a_n ${g2.gd.hearts_a_n || 0}, hearts_b_n ${g2.gd.hearts_b_n || 0})`);
      const closer = (g) => g.e.state.boxes[g.e.state.heart];
      ok((g2.gd[`hearts_${closer(g2)}_n`] || 0) === (g1.gd[`hearts_${closer(g2)}_n`] || 0) + 1, 'the heart goes to whoever closed it');
      const want = (gd) => `Series: Emerson ${gd.w_a_n || 0} · Sydney ${gd.w_b_n || 0}${gd.draws_n ? ` · ${gd.draws_n} draw${gd.draws_n === 1 ? '' : 's'}` : ''}${(gd.streak_who === 'a' || gd.streak_who === 'b') && gd.streak >= 2 ? ` · ${gd.streak_who === 'a' ? 'Emerson' : 'Sydney'} on ${gd.streak}` : ''}`;
      ok(g1.ledger === want(g1.gd) && g2.ledger === want(g2.gd), `dots: the ledger under the stamp matches the stored records ("${g2.ledger}")`);
      ok(g2.stamp && g2.stamp.length > 10, `dots: and the moment stamp reads "${g2.stamp}"`);
      await h.newLocalGame(pg, 'dots');
      await pg.tap('.g-dots .gd-mode[data-mode="sweet"]');
      const strip = await pg.textContent('.g-dots .gd-strip');
      const ha = g2.gd.hearts_a_n || 0;
      const hb = g2.gd.hearts_b_n || 0;
      ok(/heart/i.test(strip) && strip.includes(String(Math.max(ha, hb))) && strip.includes(String(Math.min(ha, hb))), `dots: the Sweetheart strip tells the heart race ("${strip}")`);
      await shot(pg, 'dots-light-390-heartstrip');
      await dotsPickClassic(pg);
      await leave(h, pg);
    });

    // ── Ultimate ──
    await section(`ultimate online (${scheme})`, async () => {
      await leave(h, h.a); await leave(h, h.b);
      await onlineGame(h, 'ultimate', scheme, (s, actor, i) => ULT_WIN[i], {
        midAt: 13,
        check: (before, after) => {
          const last = after.state.last;
          const want = after.state.big[last % 9] ? null : last % 9;
          if (!after.over && after.state.force !== want) throw new Error('FAIL: ultimate: send rule broken');
        },
      });
    });

    if (scheme !== 'light') return;

    // ── same phone + illegal moves + keys/mouse (light only) ──
    await section('four same-phone draw, full column, keys, mouse', async () => {
      await leave(h, h.a); await leave(h, h.b);
      await h.a.setViewportSize({ width: 390, height: 844 });
      await h.newLocalGame(h.a, 'four');
      const id = await localId(h.a);
      const pg = h.a;
      // keys: 4 + Enter drops in column 4; arrows move the lifted disc
      await pg.keyboard.press('4');
      ok(await pg.$eval('.g4-lift', (x) => x.classList.contains('on')), 'four: key 4 lifts a disc');
      await pg.keyboard.press('ArrowLeft');
      await pg.keyboard.press('ArrowLeft');
      await pg.keyboard.press('ArrowRight');
      await pg.keyboard.press('Enter');
      let e = await h.engine(pg, id);
      ok(e.state.cols[2].length === 1 && moveCount(e) === 1, 'four: arrows pick a column and Enter drops (column 3)');
      // mouse: hover previews, click drops at once
      await pg.hover(SEL.four(5));
      ok(await pg.$eval('.g4-lift', (x) => x.classList.contains('on')) && await pg.$eval('.g4-colhl', (x) => x.classList.contains('on')), 'four: mouse hover lifts the disc over the column');
      await pg.click(SEL.four(5));
      e = await h.engine(pg, id);
      ok(e.state.cols[5].length === 1, 'four: a mouse click drops right away');
      await pg.mouse.move(5, 5);
      await pg.tap(SEL.four(1));
      await pg.tap(SEL.four(6));
      ok(moveCount(await h.engine(pg, id)) === 2 && await pg.$eval(SEL.four(6), (x) => x.getAttribute('aria-pressed') === 'true'), 'four: tapping another column moves the lifted disc without dropping');
      await pg.tap(SEL.four(6));
      ok((await h.engine(pg, id)).state.cols[6].length === 1, 'four: a second tap on that column drops it there');
      await h.closeGame(pg);

      // scripted draw with taps; on the way, try dropping into a full column
      await h.newLocalGame(h.a, 'four');
      const id2 = await localId(pg);
      let triedFull = false;
      for (let i = 0; i < FOUR_DRAW.length; i++) {
        const s = (await h.engine(pg, id2)).state;
        const fullCol = s.cols.findIndex((c) => c.length === 6);
        if (fullCol >= 0 && !triedFull) {
          triedFull = true;
          await pg.tap(SEL.four(fullCol));
          ok(/full/i.test(await pg.textContent('.g4-plate')), 'four: lifting over a full column says it is full');
          await pg.tap(SEL.four(fullCol));
          ok(await toastSays(pg, /column is full/i), 'four: dropping into a full column shows "That column is full"');
          ok(moveCount(await h.engine(pg, id2)) === i, 'four: the full-column drop was not recorded');
        }
        await pg.tap(SEL.four(FOUR_DRAW[i]));
        await pg.tap(SEL.four(FOUR_DRAW[i]));
        if (i === 30) { await h.wait(500); await shot(pg, 'four-light-390-local-mid'); }
      }
      ok(triedFull, 'four: the full-column check ran');
      e = await h.engine(pg, id2);
      ok(e.over && e.result.winner === null, 'four: same-phone game fills the board and ends in a draw');
      await pg.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
      ok(/draw/i.test(await pg.textContent('#game-root .gm-end')), 'four: the end card says it is a draw');
      await seeBoard(pg);
      await shot(pg, 'four-light-390-draw');
      await h.closeGame(pg);
    });

    // ── Four: records, modes, keyboard, callouts (same phone, light only) ──
    await section('four: rivalry strip, Ghost Column, PopOut, keys, Blocked!, streaks', async () => {
      await leave(h, h.a); await leave(h, h.b);
      await h.a.setViewportSize({ width: 390, height: 844 });
      const pg = h.a;
      const tapTwice = async (c) => { await pg.tap(SEL.four(c)); await pg.tap(SEL.four(c)); };
      const eng = async (id) => h.engine(pg, id);
      // the draw played earlier is in the books and on the empty board
      let gd = h.docs['gamedata/four'] || {};
      ok(gd.draws_n === 1 && gd.games_n === 3 && gd.streak === 0 && gd.streak_who === '', `four: the draw was counted and ended the streak (${JSON.stringify(gd)})`);
      await h.newLocalGame(pg, 'four');
      ok(/Emerson \d+ · Sydney \d+ · 1 draw/.test(await pg.textContent('.g4-riv')), 'four: the rivalry strip shows the tally with the draw');
      await shot(pg, 'four-light-390-rivalry');
      // Ghost Column
      await pg.click('.g4-mc[data-mode="ghost"]');
      ok(await pg.$eval('.g4-mc[data-mode="ghost"]', (b) => b.getAttribute('aria-checked') === 'true') && /ghost/i.test(await pg.textContent('.g4-mdesc')), 'four: choosing a mode selects it and shows a one-line description');
      ok(/First game in Ghost Column/i.test(await pg.textContent('.g4-riv')) && await pg.$('.g4-capg .g4-cap'), 'four: the empty board previews the ghost cap and says it is a first');
      await h.settle();
      ok((h.docs['gamedata/four'] || {}).mode === 'ghost', 'four: the chosen mode is saved for rematches');
      let id = await localId(pg);
      await tapTwice(0); // any column: sends the setup move, then the disc
      let e = await eng(id);
      ok(e.state.v === 2 && e.state.mode === 'ghost' && e.lists.a.length + e.lists.b.length === 2 && moveCount(e) === 1 && !(await pg.isVisible('.g4-modes')) && /Ghost Column/.test(await pg.textContent('.g4-label')), 'four: tapping the board plays the chosen mode (setup, then the disc); the picker gives way to a label');
      const g = e.state.ghost;
      ok(g !== 3 && await pg.$eval('.g4-capg', (x) => !x.classList.contains('preview')) && /ghost/i.test(await pg.getAttribute(SEL.four(g), 'aria-label')), 'four: the cap is drawn on the seeded column');
      const free = g === 6 ? 5 : 6;
      const placed = e.state.cols[g].length;
      for (let i = placed; i < 3; i++) { await tapTwice(g); await tapTwice(free); }
      await pg.waitForTimeout(700);
      e = await eng(id);
      ok(e.state.cols[g].length === 3 || e.over, 'four: the capped column takes three discs');
      if (!e.over) {
        const cnt = moveCount(e);
        await pg.tap(SEL.four(g));
        ok(/ghost/i.test(await pg.textContent('.g4-plate')), 'four: lifting over the full capped column says the ghost has it');
        await pg.tap(SEL.four(g));
        ok(await toastSays(pg, /ghost has that column/i) && moveCount(await eng(id)) === cnt, 'four: dropping into it shows a friendly message and plays nothing');
        await shot(pg, 'four-light-390-ghost');
      }
      await h.closeGame(pg);
      // the mode is remembered; PopOut
      await h.newLocalGame(pg, 'four');
      ok(await pg.$eval('.g4-mc[data-mode="ghost"]', (b) => b.getAttribute('aria-checked') === 'true'), 'four: a new match starts on the mode you last chose');
      await pg.click('.g4-mc[data-mode="pop"]');
      id = await localId(pg);
      await tapTwice(1);
      e = await eng(id);
      const X = e.state.turn === 'a' ? 'b' : 'a'; // who just dropped
      ok(e.state.mode === 'pop' && e.state.cols[1][0] === X && await pg.isVisible('.g4-acts'), 'four: PopOut shows the Drop / Pop buttons');
      ok(await pg.$$eval('.g4-act', (bs) => bs.every((b) => b.getBoundingClientRect().height >= 44)), 'four: the Drop / Pop buttons are at least 44 px tall');
      await pg.click('.g4-act[data-act="pop"]');
      ok(await pg.$eval('.g4-act[data-act="pop"]', (b) => b.getAttribute('aria-pressed') === 'true'), 'four: Pop one out switches to popping');
      await pg.tap(SEL.four(1));
      await pg.tap(SEL.four(1));
      ok(await toastSays(pg, /own discs/i) && moveCount(await eng(id)) === 1, 'four: popping the other side’s disc is refused with a reason');
      await pg.keyboard.press('p');
      ok(await pg.$eval('.g4-act[data-act="drop"]', (b) => b.getAttribute('aria-pressed') === 'true'), 'four: the P key toggles popping');
      await tapTwice(2);
      await pg.waitForTimeout(500);
      await pg.keyboard.press('p');
      await pg.tap(SEL.four(1));
      ok(await pg.$$eval('.g4-popring.on', (xs) => xs.length) === 1 && await pg.$eval('.g4-popring.sel', (x) => !!x), 'four: popping marks your poppable bottom discs and the aimed one');
      await shot(pg, 'four-light-390-pop');
      await pg.tap(SEL.four(1));
      await pg.waitForTimeout(600);
      e = await eng(id);
      ok(e.state.cols[1].length === 0 && e.state.n === 3 && moveCount(e) === 3 && e.state.turn !== X && await pg.$eval('.g4-act[data-act="drop"]', (b) => b.getAttribute('aria-pressed') === 'true'), 'four: a pop removes your bottom disc, passes the turn and goes back to dropping');
      await h.closeGame(pg);
      // Blockers: three stones on the floor
      await h.newLocalGame(pg, 'four');
      await pg.click('.g4-mc[data-mode="blockers"]');
      ok(await pg.$$eval('.g4-capg .g4-st-body', (xs) => xs.length) === 3 && /stones/i.test(await pg.textContent('.g4-mdesc')), 'four: picking Blockers previews the three stones and describes the mode');
      id = await localId(pg);
      await tapTwice(3);
      await pg.waitForTimeout(500);
      e = await eng(id);
      ok(e.state.mode === 'blockers' && e.state.stones.length === 3 && await pg.$$eval('.g4-discs .g4-x', (xs) => xs.length) === 3 && /Blockers/.test(await pg.textContent('.g4-label')), 'four: the stones are on the board and the label says Blockers');
      await shot(pg, 'four-light-390-blockers');
      await h.closeGame(pg);
      // keyboard: Tab previews the focused column, Enter drops it, arrows start from it
      await h.newLocalGame(pg, 'four');
      await pg.click('.g4-mc[data-mode="classic"]');
      id = await localId(pg);
      let onCol = false; // the picker chip has focus; one step back is the single tab stop of the columns
      for (let t = 0; t < 6 && !onCol; t++) { await pg.keyboard.press('Shift+Tab'); onCol = await pg.evaluate(() => !!document.activeElement.closest('.g4-col')); }
      ok(onCol && await pg.$eval('.g4-lift', (x) => x.classList.contains('on')), 'four: Tab onto the columns previews a disc over the focused one');
      const tabbed = await pg.evaluate(() => Number(document.activeElement.dataset.col));
      ok(await pg.$$eval('.g4-col', (bs) => bs.filter((b) => b.tabIndex === 0).length) === 1, 'four: the columns are a single tab stop');
      await pg.keyboard.press('Enter');
      e = await eng(id);
      ok(e.state.cols[tabbed].length === 1 && moveCount(e) === 1, `four: Enter drops in the focused column (${tabbed + 1}), not column 4`);
      await pg.keyboard.press('ArrowRight');
      await pg.keyboard.press('ArrowRight');
      ok(await pg.evaluate(() => Number(document.activeElement.dataset.col)) === tabbed + 2, 'four: arrows move the focus and the disc from the focused column');
      await pg.keyboard.press('Enter');
      e = await eng(id);
      ok(e.state.cols[tabbed + 2].length === 1, 'four: Enter then drops where the arrows put it');
      await h.closeGame(pg);
      // Escape puts a lifted disc away first; with nothing lifted it leaves the game as before
      await h.newLocalGame(pg, 'four');
      await pg.keyboard.press('7');
      ok(await pg.$eval('.g4-lift', (x) => x.classList.contains('on')), 'four: key 7 lifts a disc');
      await pg.keyboard.press('Escape');
      ok(await pg.isVisible('#game-root .gm') && !(await pg.$eval('.g4-lift', (x) => x.classList.contains('on'))), 'four: Escape puts a lifted disc away and stays in the game');
      await pg.keyboard.press('Escape');
      await pg.waitForSelector('#game-root .gm', { state: 'hidden', timeout: 3000 });
      ok(!(await pg.isVisible('#game-root .gm')), 'four: Escape with nothing lifted closes the game');
      // Blocked!
      await h.newLocalGame(pg, 'four');
      id = await localId(pg);
      for (const c of [0, 1, 0, 1, 0]) await tapTwice(c);
      await tapTwice(0); // blocks the stack of three
      await pg.waitForSelector('.g4-stamp', { timeout: 3000 });
      ok(/blocked/i.test(await pg.textContent('.g4-stamp')) && (await eng(id)).state.bl, 'four: dropping into the hole the other side needed stamps "Blocked!"');
      await shot(pg, 'four-light-390-blocked');
      await h.closeGame(pg);
      // streaks: two quick local wins, then the strip
      const winners = [];
      for (let k = 0; k < 2; k++) {
        await h.newLocalGame(pg, 'four');
        id = await localId(pg);
        const fm = (await eng(id)).state.turn;
        for (const c of [0, 1, 0, 1, 0, 1, 0]) await tapTwice(c);
        e = await eng(id);
        winners.push(e.result.winner);
        ok(e.over && e.result.winner === fm, `four: same-phone quick win ${k + 1}`);
        await pg.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
        await h.settle();
        await h.closeGame(pg);
      }
      gd = h.docs['gamedata/four'] || {};
      const wantStreak = winners[0] === winners[1] ? 2 : 1;
      ok(gd.games_n === 5 && gd.streak === wantStreak && gd.streak_who === winners[1] && (gd.wins_a_n || 0) + (gd.wins_b_n || 0) + gd.draws_n === gd.games_n, `four: streaks and totals add up (${JSON.stringify(gd)})`);
      await h.newLocalGame(pg, 'four');
      const riv = await pg.textContent('.g4-riv');
      ok(/Emerson \d+ · Sydney \d+ · 1 draw/.test(riv), `four: the strip carries the all-time tally and the draw ("${riv}")`);
      await h.closeGame(pg);
    });

    await section('dots: a pile of moves at once replays only the latest turn', async () => {
      await leave(h, h.a); await leave(h, h.b);
      const id = await h.newOnlineGame(h.a, 'dots');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      const first = h.matches().find((m) => m.id === id).first;
      const keys = ['h-0-0', 'h-2-0', 'h-4-0', 'h-0-2', 'h-2-2', 'h-4-2', 'v-1-0', 'v-1-4']; // closes no box
      const lists = { a: [], b: [] };
      keys.forEach((k, i) => lists[i % 2 ? (first === 'a' ? 'b' : 'a') : first].push(dotMove(k)));
      // as after a reconnect: eight moves arrive in one snapshot
      await h.a.evaluate(([mid, L]) => globalThis.claude.use('db').then((db) => db.doc('matches/' + mid).update({ a: JSON.stringify(L.a), b: JSON.stringify(L.b) })), [id, lists]);
      await waitMoves(h, id, 8, [h.a, h.b]);
      await h.wait(100);
      for (const pg of [h.a, h.b]) {
        const fresh = await pg.$$eval('.g-dots .gd-ln.is-new', (xs) => xs.length);
        ok(fresh === 1, `dots: after eight moves land at once, only the latest turn animates (${fresh} line)`);
      }
      await h.closeGame(h.a); await h.closeGame(h.b);
    });

    await section('dots same-phone with mouse, already-drawn lines', async () => {
      await leave(h, h.a); await leave(h, h.b);
      await h.newLocalGame(h.a, 'dots');
      const pg = h.a;
      const id = await localId(pg);
      await pg.hover(SEL.dots('h-0-0'));
      ok(await pg.$eval('.gd-pg', (x) => x.classList.contains('is-hover')), 'dots: mouse hover previews the line');
      await pg.mouse.move(5, 5);
      await pg.tap(SEL.dots('v-3-4'));
      await pg.tap(SEL.dots('v-2-4'));
      ok(moveCount(await h.engine(pg, id)) === 0 && /again/i.test(await pg.textContent('.gd-plate')), 'dots: tapping another gap moves the selection without drawing');
      await pg.tap(SEL.dots('v-2-4'));
      ok((await h.engine(pg, id)).state.order[0] === 'v-2-4', 'dots: a second tap on the same gap draws it');
      for (const k of DOT_KEYS) {
        if (k === 'v-2-4') continue;
        await pg.click(SEL.dots(k));
        if (k === 'h-1-0') {
          await pg.click(SEL.dots('h-0-0'), { force: true });
          ok(await toastSays(pg, /already drawn/i), 'dots: clicking a drawn line is refused');
          await pg.tap(SEL.dots('h-0-0'), { force: true });
          ok(moveCount(await h.engine(pg, id)) === 6, 'dots: tapping a drawn line does not select or play it');
        }
        if (k === 'v-0-1') {
          const e = await h.engine(pg, id);
          ok(e.state.boxes[0] && e.acts[0] === e.state.boxes[0], 'dots: same phone, the box-closer goes again');
          ok(/again/i.test(await pg.textContent('.gd-plate')), 'dots: the plate says go again');
        }
      }
      const e = await h.engine(pg, id);
      ok(e.over && e.state.order.length === 40, 'dots: same-phone game played to the end with clicks');
      await pg.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
      await h.closeGame(pg);
    });

    await section('ultimate same-phone with keys and mouse, wrong board', async () => {
      await leave(h, h.a); await leave(h, h.b);
      await h.newLocalGame(h.a, 'ultimate');
      const pg = h.a;
      const id = await localId(pg);
      // keys: an arrow puts the cursor in the middle board, Enter places
      await pg.keyboard.press('ArrowUp');
      await pg.keyboard.press('ArrowLeft');
      await pg.keyboard.press('Enter');
      let e = await h.engine(pg, id);
      ok(moveCount(e) === 1, 'ultimate: arrows move a cursor and Enter places');
      const forced = e.state.force;
      ok(forced !== null && await pg.$eval(`.gu-sb[data-b="${forced}"]`, (x) => x.classList.contains('is-open')), 'ultimate: the board you are sent to is highlighted');
      const openCount = await pg.$$eval('.gu-sb.is-open', (xs) => xs.length);
      ok(openCount === 1, 'ultimate: only that board is highlighted');
      for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft']) await pg.keyboard.press(k);
      ok(await pg.$eval('.gu-c.is-cur', (x) => Number(x.dataset.b)) === forced, 'ultimate: the keyboard cursor stays inside the board you are sent to');
      const wrong = forced === 0 ? 8 : 0;
      await pg.click(SEL.ultimate([wrong, 4]));
      ok(await toastSays(pg, /have to play in the/i), 'ultimate: a click in the wrong board is refused with a reason');
      await pg.tap(SEL.ultimate([wrong, 5]));
      ok(moveCount(await h.engine(pg, id)) === 1 && !(await pg.$('.gu-c.is-sel')), 'ultimate: a tap in the wrong board neither selects nor plays');
      // mouse: hover shows a ghost and the board it sends to
      const free = e.state.cells.slice(forced * 9, forced * 9 + 9).findIndex((x) => !x);
      await pg.hover(SEL.ultimate([forced, free]));
      ok(await pg.$eval(SEL.ultimate([forced, free]), (x) => !!x.querySelector('.ghost')), 'ultimate: mouse hover shows a ghost mark');
      ok(/sends|anywhere/i.test(await pg.textContent('.gu-plate')), 'ultimate: the plate says where it sends your partner');
      await pg.mouse.move(5, 5);
      const free2 = e.state.cells.slice(forced * 9, forced * 9 + 9).map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
      await pg.tap(SEL.ultimate([forced, free2[0]]));
      await pg.tap(SEL.ultimate([forced, free2[1]]));
      ok(moveCount(await h.engine(pg, id)) === 1 && await pg.$eval(SEL.ultimate([forced, free2[1]]), (x) => x.classList.contains('is-sel')), 'ultimate: tapping another square moves the aim without placing');
      await pg.tap(SEL.ultimate([forced, free2[1]]));
      e = await h.engine(pg, id);
      ok(moveCount(e) === 2 && e.state.cells[forced * 9 + free2[1]], 'ultimate: a second tap on the same square places it');
      // play on with clicks: first legal square each turn, until the game ends
      for (let n = 0; n < 81 && !e.over; n++) {
        e = await h.engine(pg, id);
        if (e.over) break;
        const s = e.state;
        let pick = null;
        for (let b = 0; b < 9 && !pick; b++) {
          if (s.big[b] || (s.force !== null && s.force !== b)) continue;
          for (const i of [4, 0, 2, 6, 8, 1, 3, 5, 7]) if (!s.cells[b * 9 + i]) { pick = [b, i]; break; }
        }
        await pg.click(SEL.ultimate(pick));
        e = await h.engine(pg, id);
      }
      ok(e.over, `ultimate: same-phone game played to the end (${e.state.end.why}, ${e.result.winner || 'draw'})`);
      await pg.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
      await seeBoard(pg);
      await shot(pg, 'ultimate-light-390-local-end');
      await h.closeGame(pg);
    });

    // ── Ultimate v2 UI (light only) ──
    await section('ultimate v2 online: picker, setup + move, komi chip, hot stars, both phones agree', async () => {
      await leave(h, h.a); await leave(h, h.b);
      const id = await h.newOnlineGame(h.a, 'ultimate');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      const first = h.matches().find((m) => m.id === id).first;
      const pf = first === 'a' ? h.a : h.b;
      const ps = first === 'a' ? h.b : h.a;
      const second = first === 'a' ? 'b' : 'a';
      ok(await pf.isVisible('.gu-pick') && !(await ps.isVisible('.gu-pick')), 'ultimate: the mode picker shows to the first mover only');
      const secondName = second === 'a' ? 'Emerson' : 'Sydney';
      for (const pg2 of [pf, ps]) {
        const tie0 = (await pg2.textContent('.gu-tie')).replace(/\s+/g, ' ').trim();
        ok(await pg2.isVisible('.gu-tie') && tie0 === `Ties → ${secondName}` && await pg2.$eval('.gu-tie .gu-nm', (x) => x.classList.contains('gu-nm-' + (x.textContent === 'Emerson' ? 'a' : 'b'))), `ultimate: before the first move both phones show the komi chip "${tie0}" (the second mover)`);
      }
      const tab0 = await pf.evaluate(() => { const ks = [...document.querySelectorAll('.g-ult button, .g-ult [tabindex="0"]')].filter((x) => x.tabIndex >= 0 && !x.disabled); const ci = ks.findIndex((x) => x.classList.contains('gu-c')); const mi = ks.findIndex((x) => x.classList.contains('gu-mc')); return { ci, mi }; });
      ok(tab0.mi >= 0 && tab0.ci > tab0.mi, 'ultimate: for the first mover the mode chips come before the grid in tab order');
      const heights = await pf.$$eval('.gu-mc', (xs) => xs.map((x) => x.getBoundingClientRect().height));
      ok(heights.length === 3 && heights.every((x) => x >= 44), `ultimate: three mode chips, each at least 44px tall (${heights.map(Math.round).join('/')})`);
      ok(/picking a mode/i.test(await ps.textContent('.gu-plate')) && await ps.$$eval('.g-ult button', (bs) => bs.every((b) => b.disabled)), 'ultimate: the waiting partner sees "… is picking a mode…" and nothing is tappable');
      ok(await pf.$eval('.gu-mc[data-m="classic"]', (x) => x.classList.contains('is-hl')), 'ultimate: Classic is preselected');
      await pf.tap('.gu-mc[data-m="hot"]');
      ok(await pf.$eval('.gu-mc[data-m="hot"]', (x) => x.classList.contains('is-hl') && x.getAttribute('aria-checked') === 'true') && /facing boards/i.test(await pf.textContent('.gu-pick-d')), 'ultimate: choosing Hot Boards selects it and describes it in one line');
      ok(await pf.evaluate(() => { try { return JSON.parse(localStorage.getItem('ju.games.data.v1') || '{}').ultimate.mode === 'hot'; } catch { return false; } }), 'ultimate: the choice is remembered in the game data (rematches start with it)');
      ok(moveCount(await h.engine(pf, id)) === 0, 'ultimate: picking a mode sends nothing yet');
      await pf.tap(SEL.ultimate([4, 0]));
      await pf.tap(SEL.ultimate([4, 0]));
      const [ea, eb] = await waitMoves(h, id, 1, [h.a, h.b]);
      ok(JSON.stringify(ea.lists[first]) === JSON.stringify([{ setup: 2, mode: 'hot' }, { b: 4, i: 0 }]) && ea.lists[second].length === 0, 'ultimate: tapping the board sends the setup move, then the mark');
      ok(JSON.stringify(ea.state) === JSON.stringify(eb.state) && ea.state.v === 2 && ea.state.mode === 'hot' && ['0,8', '1,7', '2,6', '3,5'].includes(ea.state.hot.join()) && ea.acts[0] === second, 'ultimate: both phones agree on the state (mode hot, one opposite pair of hot boards)');
      for (const pg of [h.a, h.b]) ok(JSON.stringify(await pg.$$eval('.gu-sb.is-hot', (xs) => xs.map((x) => Number(x.dataset.b)))) === JSON.stringify(ea.state.hot) && await pg.$$eval('.gu-sb.is-hot', (xs) => xs.length) === 2 && await pg.$$eval('.gu-hot svg', (xs) => xs.filter((x) => x.getBoundingClientRect().width > 0).length) === 2, 'ultimate: two hot boards wear a star on each phone');
      ok(!(await pf.isVisible('.gu-pick')) && !(await ps.isVisible('.gu-pick')) && /Hot Boards/.test(await ps.textContent('.gu-info')), 'ultimate: once play starts the picker is gone and a small Hot Boards label stays');
      for (const pg2 of [pf, ps]) ok(await pg2.isVisible('.gu-tie') && /Ties → /.test(await pg2.textContent('.gu-tie')) && (await pg2.textContent('.gu-tie')).includes(secondName), 'ultimate: the komi chip stays on both phones once play starts, naming the second mover');
      ok(!(await pf.$('.gu-steal')) && !/take that mark/i.test(await ps.textContent('.g-ult')), 'ultimate: no steal button and no "take that mark" any more');
      await shot(pf, 'ultimate-light-hot-komi');
      await h.closeGame(h.a); await h.closeGame(h.b);

      // tapping the board without touching the picker plays the default (classic)
      const id2 = await h.newOnlineGame(h.a, 'ultimate');
      await h.openMatch(h.b, id2);
      await waitMoves(h, id2, 0, [h.a, h.b]);
      const f2 = h.matches().find((m) => m.id === id2).first;
      const p2 = f2 === 'a' ? h.a : h.b;
      await p2.tap(SEL.ultimate([2, 2]));
      await p2.tap(SEL.ultimate([2, 2]));
      const [da] = await waitMoves(h, id2, 1, [h.a, h.b]);
      const classicMode = da.lists[f2][0];
      ok(classicMode.setup === 2 && ['classic', 'hot', 'wild'].includes(classicMode.mode), `ultimate: tapping the board without the picker plays the remembered mode (${classicMode.mode}), no extra step`);
      await h.closeGame(h.a); await h.closeGame(h.b);
    });

    await section('ultimate v2 finale: moment line and records agree on both phones, counted once', async () => {
      await leave(h, h.a); await leave(h, h.b);
      const id = await h.newOnlineGame(h.a, 'ultimate');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      const first = h.matches().find((m) => m.id === id).first;
      const second = first === 'a' ? 'b' : 'a';
      const pg = { a: h.a, b: h.b };
      const before = (h.docs['gamedata/ultimate'] || {}).games_n | 0;
      // all but the last move arrive at once, then the last one is tapped
      const lists = { a: [], b: [] };
      lists[first].push({ setup: 2, mode: 'classic' });
      ULT_WIN.slice(0, -1).forEach(([b, i], n) => lists[n % 2 ? second : first].push({ b, i }));
      await h.a.evaluate(([mid, L]) => globalThis.claude.use('db').then((db) => db.doc('matches/' + mid).update({ a: JSON.stringify(L.a), b: JSON.stringify(L.b) })), [id, lists]);
      await waitMoves(h, id, ULT_WIN.length - 1, [h.a, h.b]);
      await h.wait(200);
      const last = ULT_WIN[ULT_WIN.length - 1];
      const mover = (await h.engine(h.a, id)).acts[0];
      await pg[mover].tap(SEL.ultimate(last));
      await pg[mover].tap(SEL.ultimate(last));
      await waitMoves(h, id, ULT_WIN.length, [h.a, h.b]);
      await h.a.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
      await h.b.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
      await seeBoard(h.a); await seeBoard(h.b);
      await h.settle();
      const ta = await h.a.textContent('.gu-moment');
      const tb = await h.b.textContent('.gu-moment');
      ok(ta && ta === tb && !(await h.a.$eval('.gu-moment', (x) => x.hidden)) && !/[{}]/.test(ta), `ultimate: both phones show the same moment line ("${ta}")`);
      const doc = h.docs['gamedata/ultimate'] || {};
      ok(doc.last_id === id && (doc.games_n | 0) === before + 1 && doc.streak >= 1 && /^[a-zA-Z]+\.\d+\.\d+$/.test(doc.last_moment), `ultimate: the match was counted once, by whichever phone saw it end (games_n ${before} → ${doc.games_n})`);
      await shot(h.a, 'ultimate-light-390-moment');
      for (const [w, hh] of [[844, 390], [667, 375]]) {
        await h.a.setViewportSize({ width: w, height: hh });
        await h.wait(500);
        const sc = await h.a.evaluate(() => { const gr = document.getElementById('game-root'); return [document.documentElement.scrollHeight, innerHeight, gr.scrollHeight, gr.clientHeight]; });
        ok(sc[0] <= sc[1] + 1 && sc[2] <= sc[3] + 1, `ultimate ${w}x${hh}: after "See the board" the page still does not scroll (${sc.join('/')})`);
        if (w === 844) await shot(h.a, 'ultimate-light-844x390-after-end');
      }
      await h.a.setViewportSize({ width: 390, height: 844 });
      await h.closeGame(h.a); await h.closeGame(h.b);
    });

    await section('ultimate v2 count finale: nothing scrolls after See the board on small phones, ledger stays', async () => {
      await leave(h, h.a); await leave(h, h.b);
      if (!ULT_COUNT) throw new Error('FAIL: no count-ending fixture from the rules tests');
      const id = await h.newOnlineGame(h.a, 'ultimate');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      const m = h.matches().find((x) => x.id === id);
      const flip = m.first !== ULT_COUNT.first;
      const L = flip ? { a: ULT_COUNT.pre.b, b: ULT_COUNT.pre.a } : ULT_COUNT.pre;
      await h.a.evaluate(([mid, X]) => globalThis.claude.use('db').then((db) => db.doc('matches/' + mid).update({ a: JSON.stringify(X.a), b: JSON.stringify(X.b) })), [id, L]);
      await waitMoves(h, id, ULT_COUNT.pre.a.length + ULT_COUNT.pre.b.length - 1, [h.a, h.b]);
      await h.wait(300);
      const mover = (await h.engine(h.a, id)).acts[0];
      const mpg = mover === 'a' ? h.a : h.b;
      await mpg.tap(SEL.ultimate([ULT_COUNT.last.b, ULT_COUNT.last.i])); await mpg.tap(SEL.ultimate([ULT_COUNT.last.b, ULT_COUNT.last.i]));
      await h.a.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
      const e = await h.engine(h.a, id);
      ok(e.over && e.state.end.why === 'count', `ultimate: the fixture finishes on the count (${e.state.end.a}–${e.state.end.b}${e.state.end.tie ? ', tie-break' : ''})`);
      await seeBoard(h.a);
      await h.settle();
      ok(!(await h.a.$eval('.gu-ledger', (x) => x.hidden)) && !(await h.a.isVisible('.gu-light')), 'ultimate: after a count ending the ledger is visible and the Last Light line is gone (the plate says how it ended)');
      for (const [w, hh] of [[360, 640], [375, 667], [390, 700], [360, 667], [1024, 600]]) {
        await h.a.setViewportSize({ width: w, height: hh });
        await h.wait(500);
        const sc = await h.a.evaluate(() => { const gr = document.getElementById('game-root'); return [document.documentElement.scrollHeight, innerHeight, gr.scrollHeight, gr.clientHeight, document.querySelector('.gu-ledger').getBoundingClientRect().bottom]; });
        ok(sc[0] <= sc[1] + 1 && sc[2] <= sc[3] + 1 && sc[4] <= hh, `ultimate ${w}x${hh}: a count finale after "See the board" does not scroll and the ledger is on screen (${sc.join('/')})`);
        if (w === 360 && hh === 640) await shot(h.a, 'ultimate-light-360x640-count-end');
      }
      await h.a.setViewportSize({ width: 390, height: 844 });
      await h.closeGame(h.a); await h.closeGame(h.b);
    });

    await section('ultimate v2 finale ledger: same series line on both phones, matching the shared data', async () => {
      await leave(h, h.a); await leave(h, h.b);
      const nameOfW = (w) => (w === 'a' ? 'Emerson' : 'Sydney');
      const expect = (d) => `Series: ${nameOfW('a')} ${d.wins_a_n | 0} · ${nameOfW('b')} ${d.wins_b_n | 0}${d.draws_n ? ` · ${d.draws_n} ${d.draws_n === 1 ? 'draw' : 'draws'}` : ''}${(d.streak | 0) >= 2 ? ` · ${nameOfW(d.streak_who)} on ${d.streak}` : ''}`;
      for (let round = 1; round <= 2; round++) {
        const id = await h.newOnlineGame(h.a, 'ultimate');
        await h.openMatch(h.b, id);
        await waitMoves(h, id, 0, [h.a, h.b]);
        const first = h.matches().find((m) => m.id === id).first;
        const second = first === 'a' ? 'b' : 'a';
        const lists = { a: [], b: [] };
        lists[first].push({ setup: 2, mode: 'classic' });
        ULT_WIN.slice(0, -1).forEach(([b, i], n) => lists[n % 2 ? second : first].push({ b, i }));
        await h.a.evaluate(([mid, L]) => globalThis.claude.use('db').then((db) => db.doc('matches/' + mid).update({ a: JSON.stringify(L.a), b: JSON.stringify(L.b) })), [id, lists]);
        await waitMoves(h, id, ULT_WIN.length - 1, [h.a, h.b]);
        await h.wait(200);
        const last = ULT_WIN[ULT_WIN.length - 1];
        const mover = (await h.engine(h.a, id)).acts[0];
        const mpg = mover === 'a' ? h.a : h.b;
        await mpg.tap(SEL.ultimate(last)); await mpg.tap(SEL.ultimate(last));
        await waitMoves(h, id, ULT_WIN.length, [h.a, h.b]);
        await h.a.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
        await h.b.waitForSelector('#game-root .gm-end', { state: 'visible', timeout: 6000 });
        await seeBoard(h.a); await seeBoard(h.b);
        await h.settle();
        const doc = h.docs['gamedata/ultimate'] || {};
        const la = (await h.a.textContent('.gu-ledger')).trim();
        const lb = (await h.b.textContent('.gu-ledger')).trim();
        ok(doc.last_id === id && la === lb && la === expect(doc) && !(await h.a.$eval('.gu-ledger', (x) => x.hidden)), `ultimate: finale ${round}: both phones show "${la}", exactly what the shared data says`);
        if (round === 2) { ok((doc.games_n | 0) >= 2 && (doc.wins_a_n | 0) + (doc.wins_b_n | 0) >= 2, 'ultimate: the ledger moved on after the second match'); await shot(h.a, 'ultimate-light-390-ledger'); }
        await h.closeGame(h.a); await h.closeGame(h.b);
      }
    });

    await section('ultimate: match point plate and the Denied! stamp, on both phones', async () => {
      await leave(h, h.a); await leave(h, h.b);
      if (!ULT_MP || !ULT_DENY) throw new Error('FAIL: no match point / denied fixtures from the rules tests');
      const nameOfW = (w) => (w === 'a' ? 'Emerson' : 'Sydney');
      const inject = async (id, fx, lists0) => {
        const m = h.matches().find((x) => x.id === id);
        const flip = m.first !== fx.first;
        const L = flip ? { a: lists0.b, b: lists0.a } : lists0;
        await h.a.evaluate(([mid, X]) => globalThis.claude.use('db').then((db) => db.doc('matches/' + mid).update({ a: JSON.stringify(X.a), b: JSON.stringify(X.b) })), [id, L]);
        return flip;
      };
      let id = await h.newOnlineGame(h.a, 'ultimate');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      let flip = await inject(id, ULT_MP, ULT_MP.lists);
      const total = ULT_MP.lists.a.length + ULT_MP.lists.b.length - 1;
      await waitMoves(h, id, total, [h.a, h.b]);
      await h.wait(300);
      const mover = (await h.engine(h.a, id)).acts[0];
      for (const pg of [h.a, h.b]) {
        const t = await pg.textContent('.gu-plate');
        ok(t.includes(`${nameOfW(mover)} is one board from the win`), `ultimate: the plate says "${t.trim()}" on both phones`);
      }
      await shot(h.a, 'ultimate-light-390-matchpoint');
      await h.closeGame(h.a); await h.closeGame(h.b);

      id = await h.newOnlineGame(h.a, 'ultimate');
      await h.openMatch(h.b, id);
      await waitMoves(h, id, 0, [h.a, h.b]);
      flip = await inject(id, ULT_DENY, ULT_DENY.pre);
      const pre = ULT_DENY.pre.a.length + ULT_DENY.pre.b.length - 1;
      await waitMoves(h, id, pre, [h.a, h.b]);
      await h.wait(300);
      ok(!(await h.a.isVisible('.gu-deny')) && !(await h.b.isVisible('.gu-deny')), 'ultimate: no Denied! stamp while nothing was denied (loading a game does not replay one)');
      const mv2 = ULT_DENY.last;
      const mp2 = (await h.engine(h.a, id)).acts[0] === 'a' ? h.a : h.b;
      await mp2.tap(SEL.ultimate([mv2.b, mv2.i])); await mp2.tap(SEL.ultimate([mv2.b, mv2.i]));
      const seenOn = [];
      for (const pg of [h.a, h.b]) { await pg.waitForSelector('.gu-deny', { state: 'visible', timeout: 4000 }).then(() => seenOn.push(true)).catch(() => seenOn.push(false)); }
      ok(seenOn.every(Boolean), 'ultimate: the Denied! stamp shows on both phones when a player takes the board the other needed for a line');
      ok((await h.a.textContent('.gu-deny')).trim() === 'Denied!', 'ultimate: and it says Denied!');
      await shot(h.a, 'ultimate-light-390-denied');
      await h.wait(2300);
      ok(!(await h.a.isVisible('.gu-deny')) && !(await h.b.isVisible('.gu-deny')), 'ultimate: the stamp goes away by itself after a moment');
      await h.closeGame(h.a); await h.closeGame(h.b);
    });

    await section('ultimate: Last Light names the lines left and draws them', async () => {
      await leave(h, h.a); await leave(h, h.b);
      if (!ULT_LL) throw new Error('FAIL: no Last Light log from the rules tests');
      const id = await h.newOnlineGame(h.a, 'ultimate');
      const m = h.matches().find((x) => x.id === id);
      const L = ULT_LL.lists;
      const flip = m.first !== ULT_LL.first; // the log is role-relative: swap sides when this match's first mover differs
      const lists = flip ? { a: L.b, b: L.a } : L;
      await h.a.evaluate(([mid, X, seed]) => globalThis.claude.use('db').then((db) => db.doc('matches/' + mid).update({ a: JSON.stringify(X.a), b: JSON.stringify(X.b) })), [id, lists]);
      await waitMoves(h, id, ULT_LL.lists.a.length + ULT_LL.lists.b.length - 1, [h.a]);
      await h.wait(250);
      const e = await h.engine(h.a, id);
      const txt = await h.a.textContent('.gu-light');
      ok(!(await h.a.$eval('.gu-light', (x) => x.hidden)) && /^Only the .+ can still win it( · .+)?$/.test(txt), `ultimate: the plate area says "${txt}"`);
      ok(await h.a.$$eval('.gu-lv', (xs) => xs.length) >= 1 && await h.a.$$eval('.gu-lv', (xs) => xs.length) <= 2, 'ultimate: the live big lines are drawn faintly on the board');
      await shot(h.a, 'ultimate-light-390-lastlight');
      await h.closeGame(h.a);
    });

    await section('ultimate v2 same phone: wildcard, bug fixes (ink colour, Tab + Enter, free-move ring, ghost, komi chip)', async () => {
      await leave(h, h.a); await leave(h, h.b);
      const pg = h.a;
      // who moves first on a same-phone match alternates between games, so read it
      const startLocal = async () => { await h.newLocalGame(pg, 'ultimate'); const id = await localId(pg); const F = (await h.engine(pg, id)).acts[0]; return { id, F, S: F === 'a' ? 'b' : 'a' }; };
      const nameOfW = (w) => (w === 'a' ? 'Emerson' : 'Sydney');
      const ink = (v) => pg.evaluate((c) => { const d = document.createElement('i'); d.style.color = `var(--p-${c})`; document.querySelector('.g-ult').appendChild(d); const r = getComputedStyle(d).color; d.remove(); return r; }, v);
      // ink: a first-mover mark inside a board lit for the second player keeps its own colour
      let { id, F, S } = await startLocal();
      ok(/^Ties → /.test((await pg.textContent('.gu-tie')).trim()) && (await pg.textContent('.gu-tie .gu-nm')) === nameOfW(S), `ultimate: the komi chip names the second mover (${nameOfW(S)}) before the first move`);
      await pg.tap(SEL.ultimate([0, 0])); await pg.tap(SEL.ultimate([0, 0]));
      await pg.waitForSelector(`.gu-sb[data-b="0"].is-open.gu-${S}`, { timeout: 4000 }).catch(() => {});
      ok(await pg.$eval('.gu-sb[data-b="0"]', (x, w) => x.classList.contains('is-open') && x.classList.contains('gu-' + w), S), `ultimate: board 0 is lit for ${nameOfW(S)}`);
      const stroke = await pg.$eval(`.gu-sb[data-b="0"] .gu-m.gu-${F} .gu-col`, (x) => getComputedStyle(x).stroke);
      ok(stroke === await ink(F) && stroke !== await ink(S), `ultimate: ${nameOfW(F)}'s mark inside a board lit for ${nameOfW(S)} is drawn in ${nameOfW(F)}'s own ink`);
      // the lit board is a ring, not nine
      ok(await pg.$$eval('.gu-sb.is-open', (xs) => xs.length) === 1 && await pg.$eval('.gu-sb[data-b="0"]', (x) => getComputedStyle(x, '::before').animationName !== 'none'), 'ultimate: a forced board gets the full breathing ring');
      // roving tabindex + Tab, Enter
      ok(await pg.$$eval('.gu-c[tabindex="0"]', (xs) => xs.length) === 1, 'ultimate: the grid is one tab stop (a single cell has tabindex 0)');
      await pg.focus('#game-root [data-g="close"]'); // start from the back button, above the grid
      let onCell = false;
      for (let t = 0; t < 20 && !onCell; t++) { await pg.keyboard.press('Tab'); onCell = await pg.evaluate(() => document.activeElement && document.activeElement.classList.contains('gu-c')); }
      ok(onCell, 'ultimate: Tab reaches the grid');
      const foc = await pg.evaluate(() => ({ b: Number(document.activeElement.dataset.b), i: Number(document.activeElement.dataset.i) }));
      ok(foc.b === 0, 'ultimate: Tab lands inside the board you were sent to');
      await pg.keyboard.press('Enter');
      let e = await h.engine(pg, id);
      ok(moveCount(e) === 2 && e.state.cells[foc.b * 9 + foc.i] === S, `ultimate: Tab then Enter places the focused cell (board ${foc.b}, square ${foc.i}), not some other default`);
      await pg.keyboard.press('ArrowRight');
      const moved = await pg.evaluate(() => ({ b: Number(document.activeElement.dataset.b), i: Number(document.activeElement.dataset.i), cur: document.activeElement.classList.contains('is-cur') }));
      ok(moved.b === e.state.force && moved.cur, 'ultimate: arrows keep working from the keyboard cursor (inside the board you are sent to)');
      const freeI = e.state.cells.slice(e.state.force * 9, e.state.force * 9 + 9).findIndex((x, i) => !x && i !== moved.i);
      await pg.focus(SEL.ultimate([e.state.force, freeI]));
      await pg.keyboard.press('Space');
      e = await h.engine(pg, id);
      ok(moveCount(e) === 3 && Math.floor(e.state.last / 9) === foc.i && e.state.last % 9 === freeI, 'ultimate: Space on a focused cell places that exact cell too');
      await h.closeGame(pg);

      // free-move highlight is a whisper
      ({ id, F, S } = await startLocal());
      ok(await pg.$$eval('.gu-sb.is-open.is-free', (xs) => xs.length) === 9 && await pg.$$eval('.gu-sb.is-open.is-free', (xs) => xs.every((x) => getComputedStyle(x, '::before').animationName === 'none')), 'ultimate: on a free move all nine boards get the quiet treatment (no breathing rings)');
      // ghost is outline only
      await pg.tap(SEL.ultimate([4, 4]));
      const gh = await pg.$eval(SEL.ultimate([4, 4]) + ' .ghost', (x) => ({ op: getComputedStyle(x).opacity, col: getComputedStyle(x.querySelector('.gu-col')).stroke }));
      ok(gh.op === '1' && gh.col !== await ink(F), 'ultimate: the ghost is a full-strength outline with a pale core, not a washed-out copy of the mark');
      await shot(pg, 'ultimate-light-390-ghost');
      await h.closeGame(pg);

      // Wildcards
      ({ id, F, S } = await startLocal());
      await pg.tap('.gu-mc[data-m="wild"]');
      await pg.tap(SEL.ultimate([4, 4])); await pg.tap(SEL.ultimate([4, 4])); // F plays; S is sent to board 4
      e = await h.engine(pg, id);
      ok(e.state.mode === 'wild' && e.state.force === 4 && await pg.$$eval('.gu-tok', (xs) => xs.filter((x) => !x.hidden).length) === 2, 'ultimate: Wildcards shows a wildcard token for each player');
      ok((await pg.$eval(`.gu-tok[data-w="${S}"]`, (x) => x.getBoundingClientRect().height)) >= 44 && await pg.$eval(`.gu-tok[data-w="${S}"]`, (x) => !x.disabled) && await pg.$eval(`.gu-tok[data-w="${F}"]`, (x) => x.disabled), 'ultimate: only the player to move can use theirs, and it is at least 44px tall');
      ok(/Ties → /.test(await pg.textContent('.gu-tie')), 'ultimate: the komi chip stays during a Wildcards game');
      await pg.tap(SEL.ultimate([4, 0])); await pg.tap(SEL.ultimate([4, 0])); // S obeys; F is sent to board 0
      ok((await pg.textContent('.gu-plate')).includes(`${nameOfW(S)} still holds a wildcard`), `ultimate: while ${nameOfW(S)}'s wildcard is unspent, the mover's plate says so`);
      await pg.tap(SEL.ultimate([0, 4])); await pg.tap(SEL.ultimate([0, 4])); // F obeys; S is sent to board 4
      await pg.tap(`.gu-tok[data-w="${S}"]`);
      ok(await pg.$eval(`.gu-tok[data-w="${S}"]`, (x) => x.classList.contains('is-armed')) && await pg.$$eval('.gu-sb.is-open', (xs) => xs.length) > 1, 'ultimate: arming the wildcard opens every board');
      await pg.tap(SEL.ultimate([7, 7])); await pg.tap(SEL.ultimate([7, 7]));
      e = await h.engine(pg, id);
      const lastMove = e.lists[S][e.lists[S].length - 1];
      ok(lastMove.wild === 1 && lastMove.b === 7 && e.state.cells[7 * 9 + 7] === S && e.state.wild[S] === 0 && e.state.force === 7, 'ultimate: a wildcard move is recorded and the send rule carries on from there');
      ok(!/still holds a wildcard/.test(await pg.textContent('.gu-plate')), 'ultimate: right after the wildcard is used the tell is gone');
      await pg.tap(SEL.ultimate([7, 0])); await pg.tap(SEL.ultimate([7, 0])); // F obeys; S sent to board 0
      await pg.tap(`.gu-tok[data-w="${S}"]`);
      ok(await toastSays(pg, /used your wildcard/i), 'ultimate: trying a second wildcard gets a friendly refusal');
      ok(!(await pg.$eval(`.gu-tok[data-w="${S}"]`, (x) => x.classList.contains('is-armed'))), 'ultimate: and it does not arm');
      // a used token stays readable: struck through at full strength (no opacity wash)
      ok(await pg.$eval(`.gu-tok[data-w="${S}"]`, (x) => x.classList.contains('is-used') && getComputedStyle(x).opacity === '1' && getComputedStyle(x.querySelector('span')).textDecorationLine.includes('line-through')), 'ultimate: a used wildcard token is struck through, not faded');
      await shot(pg, 'ultimate-light-390-wild');
      await h.closeGame(pg);
    });

    await section('ultimate landscape phone: board beside the plate, no scrolling', async () => {
      await leave(h, h.a); await leave(h, h.b);
      const pg = h.a;
      for (const [w, hh] of [[844, 390], [667, 375], [932, 430]]) {
        await pg.setViewportSize({ width: w, height: hh });
        await h.newLocalGame(pg, 'ultimate');
        await h.wait(300);
        const m = await pg.evaluate(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }; const gr = document.getElementById('game-root'); return { wrap: r('.gu-wrap'), plate: r('.gu-plate'), picker: r('.gu-pick'), sc: [document.documentElement.scrollHeight, innerHeight, gr.scrollHeight, gr.clientHeight, document.documentElement.scrollWidth, innerWidth] }; });
        ok(m.sc[0] <= m.sc[1] + 1 && m.sc[2] <= m.sc[3] + 1 && m.sc[4] <= m.sc[5] + 1, `ultimate ${w}x${hh}: the page does not scroll (${m.sc.join('/')})`);
        ok(m.wrap.w >= 215 && Math.abs(m.wrap.w - m.wrap.h) < 2 && m.wrap.b <= hh, `ultimate ${w}x${hh}: the board is ${Math.round(m.wrap.w)}px square and fits`);
        ok(m.plate.l >= m.wrap.r - 1 && m.plate.b <= hh && m.picker.b <= hh && m.picker.l >= m.wrap.r - 1, `ultimate ${w}x${hh}: the plate and mode picker sit beside the board, inside the screen`);
        if (w === 844) await shot(pg, 'ultimate-light-844x390');
        await pg.tap(SEL.ultimate([4, 4])); await pg.tap(SEL.ultimate([4, 4]));
        await h.wait(300);
        const m2 = await pg.evaluate(() => { const gr = document.getElementById('game-root'); return [document.documentElement.scrollHeight, innerHeight, gr.scrollHeight, gr.clientHeight, document.querySelector('.gu-plate').getBoundingClientRect().bottom]; });
        ok(m2[0] <= m2[1] + 1 && m2[2] <= m2[3] + 1 && m2[4] <= hh, `ultimate ${w}x${hh}: still no scrolling once playing`);
        if (w === 844) await shot(pg, 'ultimate-light-844x390-play');
        await h.closeGame(pg);
      }
      await pg.setViewportSize({ width: 390, height: 844 });
    });

    await section('reduced motion', async () => {
      await leave(h, h.a);
      const pg = h.a;
      await pg.emulateMedia({ reducedMotion: 'reduce' });
      await h.newLocalGame(pg, 'four');
      await pg.click(SEL.four(3));
      ok(await pg.$$eval('.g4-fall.is-falling', (xs) => xs.length) === 0 && (await h.engine(pg, await localId(pg))).state.cols[3].length === 1, 'four: with reduced motion the disc lands without the fall animation');
      await leave(h, pg);
      await h.newLocalGame(pg, 'dots');
      await pg.click(SEL.dots('h-0-0'));
      ok(await pg.$$eval('.gd-ln.is-new', (xs) => xs.length) === 0, 'dots: with reduced motion lines appear without the draw-in');
      await leave(h, pg);
      await h.newLocalGame(pg, 'ultimate');
      await pg.click(SEL.ultimate([4, 4]));
      ok(await pg.$$eval('.gu-m.is-new', (xs) => xs.length) === 0 && await pg.$$eval('.gu-sb.is-open', (xs) => xs.length) === 1, 'ultimate: with reduced motion marks appear without the pop, highlight still shows');
      await leave(h, pg);
      await pg.emulateMedia({ reducedMotion: 'no-preference' });
    });

    await section('laptop size', async () => {
      await leave(h, h.a); await leave(h, h.b);
      const pg = h.a;
      await pg.setViewportSize({ width: 1280, height: 800 });
      for (const g of GAMES) {
        await h.newLocalGame(pg, g);
        if (g === 'four') { await pg.click(SEL.four(3)); await pg.hover(SEL.four(4)); }
        if (g === 'dots') { await pg.click(SEL.dots('h-1-1')); await pg.hover(SEL.dots('v-1-2')); }
        if (g === 'ultimate') { await pg.click(SEL.ultimate([4, 2])); await pg.hover(SEL.ultimate([2, 6])); }
        await h.wait(450);
        const box = await pg.$eval(g === 'four' ? '.g4-wrap' : g === 'dots' ? '.gd-wrap' : '.gu-wrap', (x) => { const r = x.getBoundingClientRect(); return { w: r.width, bottom: r.bottom }; });
        const plate = await pg.$eval(`.g-${g === 'ultimate' ? 'ult' : g} [aria-live]`, (x) => x.getBoundingClientRect().bottom);
        ok(box.w >= 440 && plate <= 800, `${g}: scales up on a laptop (${Math.round(box.w)}px wide) and fits the screen`);
        await pg.screenshot({ path: path.join(SHOTS, `${g}-light-laptop.png`), scale: 'css' });
        await h.closeGame(pg);
      }
      await pg.setViewportSize({ width: 390, height: 844 });
    });

    await section('no horizontal overflow at 360', async () => {
      await leave(h, h.a); await leave(h, h.b);
      const pg = h.b;
      for (const g of GAMES) {
        await h.newLocalGame(pg, g);
        const over = await pg.evaluate(() => document.querySelector('#game-root').scrollWidth > window.innerWidth + 1);
        ok(!over, `${g}: no sideways scroll at 360px`);
        const small = await pg.evaluate((sel) => Math.min(...[...document.querySelectorAll(sel)].map((x) => Math.min(x.getBoundingClientRect().width, x.getBoundingClientRect().height))), g === 'four' ? '.g4-col' : g === 'dots' ? '.gd-hit' : '.gu-c');
        console.log(`   ${g}: smallest target ${small.toFixed(1)}px at 360`);
        await h.closeGame(pg);
      }
    });
  } finally {
    await section(`no page errors (${scheme})`, () => { h.assertNoErrors(); ok(true, `no page errors (${scheme})`); });
    await h.close();
  }
}

(async () => {
  await rulesTests();
  await uiTests('light', 8920);
  await uiTests('dark', 8921);
  console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? '\n' + failures.join('\n') : ''}`);
  console.log(`screenshots: ${SHOTS}`);
  if (failures.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
