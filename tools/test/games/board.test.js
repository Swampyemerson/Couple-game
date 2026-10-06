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
const FOUR_DIAG = [0, 1, 1, 2, 3, 2, 2, 3, 6, 3, 3]; // first mover wins on the ↗ diagonal
const ULT_WIN = [[1, 3], [3, 1], [1, 6], [6, 1], [1, 0], [0, 6], [6, 6], [6, 2], [2, 6], [6, 3], [3, 6], [6, 7], [7, 3], [3, 7], [7, 0], [0, 4], [4, 4], [4, 7], [7, 6], [6, 4], [4, 5], [5, 1], [4, 3]];
const DOT_KEYS = [];
for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) DOT_KEYS.push(`h-${r}-${c}`);
for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) DOT_KEYS.push(`v-${r}-${c}`);
const dotMove = (k) => { const [l, r, c] = k.split('-'); return { l, r: Number(r), c: Number(c) }; };

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
    const d = core.derive(four, { first: 'a', seed: 1, lists: { a: cols([0, 0, 0, 0, 1]), b: cols([0, 0, 0]) } });
    ok(d.rejected.length === 1 && d.rejected[0].error === 'That column is full' && d.count === 6, 'engine replay drops a move into a full column');
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
    const d = core.derive(ult, { first: 'a', seed: 1, lists: { a: [{ b: 4, i: 0 }], b: [{ b: 5, i: 5 }, { b: 0, i: 4 }] } });
    ok(d.rejected.length === 1 && /top-left/.test(d.rejected[0].error), 'engine replay drops a move in the wrong board');
  });
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── UI helpers ─────────────────────────────────────────────────────────
const SEL = {
  four: (col) => `.g-four .g4-col[data-col="${col}"]`,
  dots: (k) => `.g-dots .gd-hit[data-k="${k}"]`,
  ultimate: ([b, i]) => `.g-ult .gu-c[data-b="${b}"][data-i="${i}"]`,
};
const moveCount = (e) => e.lists.a.length + e.lists.b.length;
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
const visibleToast = async (pg) => pg.$$eval('.toast', (ts) => ts.length);

async function uiTests(scheme, port) {
  const h = await launch({ port, only: GAMES, colorScheme: scheme });
  try {
    await h.b.setViewportSize({ width: 360, height: 760 });

    // ── Four in a Row ──
    await section(`four online (${scheme})`, async () => {
      await onlineGame(h, 'four', scheme, (s, actor, i) => FOUR_DIAG[i], {
        midAt: 6,
        check: (before, after) => { if (after.state.n !== before.state.n + 1) throw new Error('FAIL: four: one disc per move'); },
      });
    });

    // ── Dots & Boxes ──
    await section(`dots online (${scheme})`, async () => {
      const rnd = lcg(scheme === 'dark' ? 5 : 3);
      const order = [...DOT_KEYS];
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      let extras = 0;
      let doubles = 0;
      const { final } = await onlineGame(h, 'dots', scheme, (s) => order.find((k) => !s.order.includes(k)), {
        midAt: 22,
        check: (before, after, actor) => {
          const closed = after.state.boxes.filter(Boolean).length - before.state.boxes.filter(Boolean).length;
          if (closed && !after.over) { extras++; if (after.acts[0] !== actor) throw new Error('FAIL: dots: closing a box must give another turn'); }
          if (!closed && !after.over && after.acts[0] === actor) throw new Error('FAIL: dots: turn must pass when no box closes');
          if (closed === 2) doubles++;
        },
      });
      ok(extras > 0, `dots (${scheme}): ${extras} extra turns after closing boxes, all correct${doubles ? ` (${doubles} double)` : ''}`);
      const sc = final.state.boxes.reduce((m, w) => ({ ...m, [w]: m[w] + 1 }), { a: 0, b: 0 });
      ok(sc.a + sc.b === 16 && final.state.order.length === 40, `dots (${scheme}): ends with every line drawn, ${sc.a}–${sc.b}`);
    });

    // ── Ultimate ──
    await section(`ultimate online (${scheme})`, async () => {
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

    await section('dots same-phone with mouse, already-drawn lines', async () => {
      await h.newLocalGame(h.a, 'dots');
      const pg = h.a;
      const id = await localId(pg);
      await pg.hover(SEL.dots('h-0-0'));
      ok(await pg.$eval('.gd-pl', (x) => x.classList.contains('is-hover')), 'dots: mouse hover previews the line');
      for (const k of DOT_KEYS) {
        await pg.click(SEL.dots(k));
        if (k === 'h-1-0') {
          await pg.click(SEL.dots('h-0-0'));
          ok(await toastSays(pg, /already drawn/i), 'dots: clicking a drawn line is refused');
          await pg.tap(SEL.dots('h-0-0'));
          ok(moveCount(await h.engine(pg, id)) === 5, 'dots: tapping a drawn line does not select or play it');
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

    await section('laptop size', async () => {
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
  await uiTests('light', 8810);
  await uiTests('dark', 8811);
  console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? '\n' + failures.join('\n') : ''}`);
  console.log(`screenshots: ${SHOTS}`);
  if (failures.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
