// Tower Together + Knucklebones: rules unit tests, online and same-phone games through the real
// UI, WebGL context hygiene (no leaks, context loss + restore), the 2D fallback, and screenshots
// in light and dark at 390 and 360 wide.
//   SHOTS=/some/dir node tools/test/games/threed.test.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'just-us-shots', 'threed');
fs.mkdirSync(SHOTS, { recursive: true });
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const other = (w) => (w === 'a' ? 'b' : 'a');
const clone = (x) => JSON.parse(JSON.stringify(x));
const throws = (fn, re) => { try { fn(); } catch (e) { return re ? re.test(e.message) : true; } return false; };
const shot = (pg, name) => pg.screenshot({ path: path.join(SHOTS, name), scale: 'css' });

// ── (d) rules, in Node ────────────────────────────────────────────────
let TOWER;
let BONES;
let core;
async function unit() {
  core = await import(pathToFileURL(path.join(ROOT, 'js/games/core.js')).href);
  await import(pathToFileURL(path.join(ROOT, 'js/games/tower.js')).href);
  await import(pathToFileURL(path.join(ROOT, 'js/games/bones.js')).href);
  TOWER = core.gameById('tower');
  BONES = core.gameById('bones');
  const step = (def, s, who, mv) => def.apply(clone(s), who, mv);

  // tower
  const T = TOWER;
  const s0 = T.init({ first: 'a', seed: 1, opts: {} });
  ok(T.next(s0).join() === 'a' && s0.blocks.length === 1 && s0.blocks[0].w === 3, 'tower: base 3×3, first player starts');
  let s = step(T, s0, 'a', { o: 0.6 }); // level 1 slides along x
  let b = s.blocks[1];
  ok(b.x === 0.3 && b.w === 2.4 && b.z === 0 && b.d === 3 && b.who === 'a', 'tower: x-axis overlap keeps 2.4 centred at 0.3');
  ok(s.drop.cut.x === 1.8 && s.drop.cut.w === 0.6 && s.drop.cut.d === 3 && s.drop.axis === 'x', 'tower: x-axis slice is 0.6 wide at x 1.8');
  ok(throws(() => step(T, s, 'a', { o: 0 }), /turn/), 'tower: the same player can’t go twice');
  s = step(T, s, 'b', { o: -0.4 }); // level 2 slides along z
  b = s.blocks[2];
  ok(b.z === -0.2 && b.d === 2.6 && b.x === 0.3 && b.w === 2.4, 'tower: z-axis overlap keeps 2.6 centred at -0.2');
  ok(s.drop.cut.z === -1.7 && s.drop.cut.d === 0.4 && s.drop.cut.x === 0.3 && s.drop.cut.w === 2.4 && s.drop.axis === 'z', 'tower: z-axis slice is 0.4 deep at z -1.7');
  const left = step(T, step(T, s0, 'a', { o: -0.5 }), 'b', { o: 0.25 });
  ok(left.blocks[1].x === -0.25 && left.blocks[1].w === 2.5 && left.blocks[2].z === 0.125 && left.blocks[2].d === 2.75, 'tower: negative and positive offsets slice the right side');
  ok(step(T, s, 'a', { o: 0.1 }).drop.perfect && step(T, s, 'a', { o: -0.1 }).drop.perfect, 'tower: within 0.1 is a perfect');
  const snap = step(T, s, 'a', { o: 0.07 });
  ok(snap.blocks[3].x === 0.3 && snap.blocks[3].w === 2.4 && !snap.drop.cut, 'tower: a perfect snaps to the block below at full size');
  ok(step(T, s, 'a', { o: 0.1004 }).drop.perfect, 'tower: offsets round to 3 decimals before the check');
  const near = step(T, s, 'a', { o: 0.102 });
  ok(!near.drop.perfect && near.blocks[3].w === 2.298 && near.streak === 0, 'tower: just outside the tolerance gets sliced');
  ok(step(T, s0, 'a', { o: 0.12345 }).drop.o === 0.123, 'tower: the drop is stored to 3 decimals');
  let g = step(T, s, 'a', { o: 0.05 });
  g = step(T, g, 'b', { o: 0 });
  ok(g.streak === 2 && !g.drop.grew, 'tower: two perfects build a streak');
  g = step(T, g, 'a', { o: -0.08 });
  const top = g.blocks[g.blocks.length - 1];
  ok(g.streak === 3 && g.drop.grew && top.w === 2.6 && top.d === 2.8, 'tower: three perfects in a row grow the block back by 0.2');
  g = step(T, g, 'b', { o: 0.3 });
  ok(g.streak === 0 && g.blocks[6].d === 2.5, 'tower: a sliced drop resets the streak');
  const tiny = { ...clone(s0), blocks: [{ x: 0, z: 0, w: 0.3, d: 0.3, who: null }] };
  ok(!step(T, tiny, 'a', { o: 0.08 }).drop.perfect && step(T, tiny, 'a', { o: 0.06 }).drop.perfect, 'tower: the tolerance shrinks for tiny blocks (20% of size)');
  const miss = step(T, g, 'a', { o: 2.6 });
  ok(miss.over && miss.drop.miss && T.next(miss).length === 0 && miss.blocks.length === g.blocks.length, 'tower: a total miss (|o| ≥ size) ends the game');
  ok(!step(T, g, 'a', { o: 2.599 }).over, 'tower: a sliver of overlap still counts');
  ok(throws(() => step(T, miss, 'b', { o: 0 }), /toppled/), 'tower: no moves after the miss');
  const res = T.result(miss);
  ok(res.score === 6 && res.team && res.winner === null && /6 blocks high/.test(res.text) && res.sub, 'tower: score = height, with a fun line');
  ok(T.score(g).a === 3 && T.score(g).b === 3, 'tower: chips count each player’s blocks');
  ok(['x', NaN, Infinity, 99, null].every((o) => throws(() => step(T, s0, 'a', { o }))), 'tower: garbage offsets are rejected');
  const match = { first: 'a', seed: 42, lists: { a: [{ o: 0.6 }, { o: 0.05 }, { o: -0.08 }, { o: 5 }], b: [{ o: -0.4 }, { o: 0 }, { o: 0.3 }] } };
  const d1 = core.derive(T, match);
  const d2 = core.derive(T, clone(match));
  ok(JSON.stringify(d1.state) === JSON.stringify(d2.state) && d1.over && d1.result.score === 6 && !d1.rejected.length, 'tower: a replayed match is deterministic');

  // knucklebones
  const B = BONES;
  const sc = (cols) => B.score({ grids: { a: cols, b: [[], [], []] } }).a;
  ok(sc([[4, 4], [], []]) === 16 && sc([[4, 4, 4], [], []]) === 36 && sc([[3, 4], [], []]) === 7, 'bones: column score is value × count² (16, 36, 7)');
  ok(sc([[6, 6, 2], [1], [5, 5, 5]]) === 26 + 1 + 45 && sc([[], [], []]) === 0, 'bones: the total is the sum of the columns');
  const k0 = B.init({ first: 'b', seed: 99, opts: {} });
  ok(B.next(k0).join() === 'b' && k0.roll === core.randInt(6, 99, 'roll', 0) + 1, 'bones: the first roll is randInt(6, seed, roll, 0) + 1');
  let k = clone(k0);
  k.turn = 'a'; k.roll = 3;
  k.grids.a = [[3], [], []];
  k.grids.b = [[3, 3, 5], [3], []];
  const k1 = step(B, k, 'a', { col: 0 });
  ok(k1.grids.b[0].join() === '5' && k1.grids.b[1].join() === '3' && k1.last.destroyed === 2, 'bones: a die destroys matching dice only in the facing column');
  ok(k1.grids.a[0].join() === '3,3' && sc(k1.grids.a) === 12, 'bones: your own matching dice stay and combo');
  ok(k1.turn === 'b' && k1.roll === core.randInt(6, k.seed, 'roll', 1) + 1 && k1.n === 1, 'bones: the next roll is seeded by the turn number');
  ok(throws(() => step(B, k, 'b', { col: 0 }), /turn/), 'bones: out-of-turn moves are rejected');
  k.grids.a[1] = [1, 2, 3];
  ok(throws(() => step(B, k, 'a', { col: 1 }), /full/), 'bones: a full column is rejected');
  ok([{ col: 3 }, { col: -1 }, { col: '1' }, {}, null].every((mv) => throws(() => step(B, k, 'a', mv))), 'bones: bad columns are rejected');
  const fill = clone(k0);
  fill.turn = 'a'; fill.roll = 6;
  fill.grids.a = [[1, 2, 3], [1, 2, 3], [1, 2]];
  fill.grids.b = [[6], [], [6, 6]];
  const done = step(B, fill, 'a', { col: 2 });
  ok(done.over && B.next(done).length === 0 && done.grids.b[2].length === 0 && done.roll === null, 'bones: the game ends the moment a grid fills (after its smash)');
  const rb = B.result(done);
  ok(rb.winner === 'a' && sc(done.grids.a) === 12 + 1 + 2 + 6, 'bones: the higher total wins');
  const fillB = clone(k0);
  fillB.turn = 'b'; fillB.roll = 2;
  fillB.grids.b = [[1, 1, 1], [5, 5, 5], [3, 3]];
  ok(step(B, fillB, 'b', { col: 2 }).over, 'bones: either player filling up ends it');
  ok(B.result({ grids: { a: [[4], [], []], b: [[1, 1], [], []] } }).winner === null, 'bones: equal totals are a draw');
  const seen = new Set();
  for (let n = 0; n < 300; n++) seen.add(core.randInt(6, 12345, 'roll', n) + 1);
  ok(seen.size === 6 && [...seen].every((v) => v >= 1 && v <= 6), 'bones: rolls cover 1–6');
  const sim = simulateBones(B, 777, 'a');
  const bm = { first: 'a', seed: 777, lists: { a: sim.moves.filter((x) => x.who === 'a').map((x) => ({ col: x.col })), b: sim.moves.filter((x) => x.who === 'b').map((x) => ({ col: x.col })) } };
  const bd = core.derive(B, bm);
  ok(bd.over && JSON.stringify(bd.state) === JSON.stringify(sim.state) && !bd.rejected.length, 'bones: a replayed match is deterministic');
}

// A deterministic strategy: smash when you can, otherwise fill the emptiest column.
function bonesPick(s, who) {
  const op = other(who);
  const free = [0, 1, 2].filter((c) => s.grids[who][c].length < 3);
  const smash = free.find((c) => s.grids[op][c].includes(s.roll));
  if (smash !== undefined) return smash;
  return free.slice().sort((x, y) => s.grids[who][x].length - s.grids[who][y].length || x - y)[0];
}
function simulateBones(B, seed, first) {
  let s = B.init({ first, seed, opts: {} });
  const moves = [];
  let smashes = 0;
  while (B.next(s).length) {
    const who = s.turn;
    const col = bonesPick(s, who);
    s = B.apply(clone(s), who, { col });
    if (s.last.destroyed) smashes++;
    moves.push({ who, col });
  }
  return { state: s, moves, smashes };
}
// Pick a Math.random value for match creation whose seed gives an interesting game.
function bonesRandom() {
  for (let i = 1; i < 200; i++) {
    const r = (i * 0.0377) % 1;
    const first = r < 0.5 ? 'a' : 'b';
    const sim = simulateBones(BONES, Math.floor(r * 2147483647), first);
    if (sim.smashes >= 3 && sim.moves.length >= 16 && sim.moves.length <= 26) return { r, sim };
  }
  throw new Error('no good seed');
}

// ── browser helpers ───────────────────────────────────────────────────
const movesOf = (h, pg, id) => h.engine(pg, id).then((e) => (e ? e.lists.a.length + e.lists.b.length : -1));
const waitMoves = (pg, id, n, timeout = 12000) => pg.waitForFunction(([mid, k]) => {
  const d = window.__gamesDebug(mid);
  return d && d.lists.a.length + d.lists.b.length >= k;
}, [id, n], { timeout });
const endCard = (pg, timeout = 8000) => pg.waitForSelector('#game-root .gm-end:not([hidden]) .gm-end-card', { timeout });
async function withRandom(pg, r, fn) {
  await pg.evaluate((v) => { window.__realRandom = Math.random; Math.random = () => v; }, r);
  try { return await fn(); } finally { await pg.evaluate(() => { Math.random = window.__realRandom; }); }
}
const nameOf = (pg, w) => pg.evaluate((x) => document.querySelector(`#game-root .gm-p-${x} .gm-p-name`).textContent, w);

// ── (a)(b) tower online ───────────────────────────────────────────────
async function towerOnline(h) {
  const { a, b } = h;
  const pageOf = { a, b };
  for (const p of [a, b]) {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => { window.__towerTest = { log: [] }; });
  }
  const id = await withRandom(a, 0.3, () => h.newOnlineGame(a, 'tower'));
  await h.openMatch(b, id);
  const first = (await h.engine(a, id)).first;
  ok(first === 'a', 'tower online: Emerson goes first');
  const plan = [0.6, -0.4, 0.05, 0, -0.08, 0.3, 'miss'];
  for (let n = 0; n < plan.length; n++) {
    const e = await h.engine(a, id);
    const who = e.acts[0];
    ok(who === (n % 2 ? other(first) : first), `tower online: turn ${n + 1} belongs to ${who}`);
    const me = pageOf[who];
    const them = pageOf[other(who)];
    let closed = false;
    if (n === 3) { // async: the partner is away while this drop happens, then opens the game
      await h.closeGame(them);
      closed = true;
    }
    await me.waitForSelector('.gt-view[data-phase="slide"]', { timeout: 12000 });
    if (!closed) {
      await them.waitForSelector('.gt-view[data-phase="wait"]', { timeout: 12000 });
      const pill = await them.textContent('.gt-turn');
      ok(pill.includes(`${await nameOf(them, who)}’s turn`), `tower online: the other phone says “${pill}”`);
    }
    if (n === 0) {
      await them.click('.gt-view');
      await h.wait(200);
      ok(await movesOf(h, a, id) === 0, 'tower online: tapping on the waiting phone does nothing');
    }
    let o = plan[n];
    if (o === 'miss') {
      const tb = e.state.blocks[e.state.blocks.length - 1];
      o = (e.state.blocks.length % 2 ? tb.w : tb.d) + 0.2;
    }
    await me.evaluate((v) => { window.__towerTest.next = v; }, o);
    await me.click('.gt-view');
    await waitMoves(a, id, n + 1);
    await waitMoves(b, id, n + 1);
    if (plan[n] === 0.05) {
      await me.waitForSelector('.gt-stamp.show', { timeout: 3000 });
      ok(true, 'tower online: a perfect drop shows the Perfect stamp');
    }
    if (!closed && n < plan.length - 1) {
      await them.waitForFunction(() => window.__towerTest.log.includes('replay'), null, { timeout: 5000 });
      await them.evaluate(() => { window.__towerTest.log = []; });
    }
    if (closed) {
      await them.evaluate(() => { window.__towerTest.log = []; });
      await h.openMatch(them, id);
      await them.waitForSelector('.gt-view[data-phase="slide"]', { timeout: 12000 });
      const log = await them.evaluate(() => window.__towerTest.log);
      ok(log.includes('intro') && log.includes('replay') && log.indexOf('intro') < log.indexOf('replay'), 'tower online: reopening eases up the tower, then replays the partner’s drop');
    }
    if (n === 4) {
      const g = await h.engine(a, id);
      ok(g.state.streak === 3 && g.state.drop.grew, 'tower online: three perfects in a row grew the block');
      await a.waitForSelector('.gt-view[data-phase="slide"], .gt-view[data-phase="wait"]');
      await h.wait(900);
      await shot(a, 'tower-light-390-mid.png');
      await b.setViewportSize({ width: 360, height: 740 });
      await h.wait(900);
      await shot(b, 'tower-light-360-mid.png');
    }
  }
  await endCard(a);
  await endCard(b);
  const ea = await h.engine(a, id);
  const eb = await h.engine(b, id);
  ok(ea.over && eb.over && JSON.stringify(ea.state) === JSON.stringify(eb.state), 'tower online: both phones agree on the final tower');
  ok(ea.result.score === 6 && ea.result.text === '6 blocks high', 'tower online: score = 6 blocks high');
  await h.settle();
  const rec = h.results().filter((r) => r.game === 'tower');
  ok(rec.length === 1 && rec[0].winner === 'team' && rec[0].score === 6, 'tower online: one team result recorded');
  await shot(a, 'tower-light-390-end.png');
  await shot(b, 'tower-light-360-end.png');
  await a.click('#game-root [data-g="end-look"]');
  await h.wait(400);
  await shot(a, 'tower-light-390-board.png');
  await h.closeGame(a);
  await h.closeGame(b);
}

// ── (a)(b) knucklebones online ────────────────────────────────────────
async function bonesOnline(h) {
  const { a, b } = h;
  const pageOf = { a, b };
  for (const p of [a, b]) {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => { window.__bonesTest = { log: [] }; });
  }
  const { r, sim } = bonesRandom();
  const id = await withRandom(a, r, () => h.newOnlineGame(a, 'bones'));
  await h.openMatch(b, id);
  let n = 0;
  let smashes = 0;
  let sawCrack = false;
  let usedKey = false;
  let sameRoll = true;
  for (;;) {
    const e = await h.engine(a, id);
    if (e.over) break;
    const who = e.acts[0];
    const me = pageOf[who];
    const them = pageOf[other(who)];
    const closed = n === 6;
    if (closed) await h.closeGame(them);
    await me.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
    const eb = await h.engine(b, id);
    sameRoll = sameRoll && eb.state.roll === e.state.roll;
    await me.waitForSelector(`.gb-band[data-roll="${e.state.roll}"]`, { timeout: 5000 });
    if (!closed) await them.waitForSelector(`.gb-band[data-roll="${e.state.roll}"]`, { timeout: 8000 });
    const free = e.state.grids[who].filter((c) => c.length < 3).length;
    const lit = await me.$$eval(`.gb-tray[data-who="${who}"].is-picking .gb-col.can`, (x) => x.length);
    const litThem = closed ? 0 : await them.$$eval('.gb-tray.is-picking', (x) => x.length);
    if (n < 3) ok(lit === free && litThem === 0, `bones online: ${free} column picks light up only for the roller (turn ${n + 1})`);
    else if (lit !== free || litThem) throw new Error(`FAIL: picks wrong on turn ${n + 1}`);
    const col = bonesPick(e.state, who);
    if (col !== sim.moves[n].col) throw new Error(`FAIL: bones online: turn ${n + 1} diverged from the Node simulation`);
    if (!usedKey && n >= 2) { await me.keyboard.press(String(col + 1)); usedKey = true; } else await me.click(`.gb-tray[data-who="${who}"] .gb-col[data-col="${col}"]`);
    n++;
    const after = await h.engine(me, id);
    if (after.state.last && after.state.last.n === n - 1 && after.state.last.destroyed) {
      smashes++;
      if (!sawCrack) {
        await me.waitForSelector('.gb-die.crack, .gb-die.pop', { timeout: 4000 });
        sawCrack = true;
        await h.wait(120);
        await shot(me, 'bones-light-390-smash.png');
      }
    }
    await waitMoves(a, id, n);
    await waitMoves(b, id, n);
    if (closed) {
      await them.evaluate(() => { window.__bonesTest.log = []; });
      await h.openMatch(them, id);
      await them.waitForFunction(() => window.__bonesTest.log.includes('place'), null, { timeout: 8000 });
      const log = await them.evaluate(() => window.__bonesTest.log);
      ok(log[0].startsWith('roll:') && log.includes('place'), `bones online: reopening replays the partner’s last roll and placement (${log.join(' ')})`);
    }
    if (n === 9) {
      await a.waitForSelector('.g-bones[data-phase="pick"], .g-bones[data-phase="wait"]', { timeout: 10000 });
      await h.wait(300);
      await shot(a, 'bones-light-390-mid.png');
      await b.setViewportSize({ width: 360, height: 740 });
      await h.wait(500);
      await shot(b, 'bones-light-360-mid.png');
    }
  }
  ok(usedKey, 'bones online: a number key places a die');
  ok(sameRoll, 'bones online: both phones always had the same roll');
  ok(smashes === sim.smashes && smashes > 0 && sawCrack, `bones online: ${smashes} smashes happened and the dice cracked`);
  await endCard(a);
  await endCard(b);
  const ea = await h.engine(a, id);
  const eb = await h.engine(b, id);
  ok(JSON.stringify(ea.state) === JSON.stringify(eb.state) && JSON.stringify(ea.state.grids) === JSON.stringify(sim.state.grids), 'bones online: both phones agree, and match the Node simulation');
  const tot = BONES.score(ea.state);
  const want = tot.a === tot.b ? null : tot.a > tot.b ? 'a' : 'b';
  ok(ea.result.winner === want && eb.result.winner === want, `bones online: ${tot.a}–${tot.b}, winner ${want || 'none'}`);
  await h.settle();
  const rec = h.results().filter((x) => x.game === 'bones');
  ok(rec.length === 1 && rec[0].winner === (want || 'draw'), 'bones online: one result recorded');
  await shot(a, 'bones-light-390-end.png');
  await shot(b, 'bones-light-360-end.png');
  await a.click('#game-root [data-g="end-look"]');
  await h.wait(300);
  await shot(a, 'bones-light-390-board.png');
  await h.closeGame(a);
  await h.closeGame(b);
}

// ── (c) same phone ────────────────────────────────────────────────────
async function towerLocal(h, pg, { shots = null } = {}) {
  await pg.evaluate(() => { window.__towerTest = { log: [] }; });
  await h.newLocalGame(pg, 'tower');
  const id = await pg.evaluate(() => window.__lastMatchId);
  let n = 0;
  for (; n < 12; n++) {
    const e = await h.engine(pg, id);
    if (e.over) break;
    await pg.waitForSelector('.gt-view[data-phase="slide"]', { timeout: 12000 });
    const pill = await pg.textContent('.gt-turn');
    if (n < 2) ok(pill.startsWith(await nameOf(pg, e.acts[0])), `tower local: the pill names the player (“${pill}”)`);
    if (shots) {
      const plan = [0.5, -0.3, 0.02, 0.01, 0.4, -0.2, 0.15, 0.05];
      if (n < plan.length) await pg.evaluate((v) => { window.__towerTest.next = v; }, plan[n]);
      else await pg.evaluate((v) => { window.__towerTest.next = v; }, 9);
      if (n === 6) { await h.wait(700); await shot(pg, `${shots}-mid.png`); }
    } else if (n >= 5) await pg.evaluate(() => { window.__towerTest.next = 9; });
    else await h.wait(150 + ((n * 337) % 700)); // natural timing
    if (n === 1 && !shots) await pg.keyboard.press('Space');
    else await pg.click('.gt-view');
    await waitMoves(pg, id, n + 1);
    const after = await h.engine(pg, id);
    const tapped = await pg.evaluate(() => window.__towerTest.tapped);
    const mine = after.lists[e.acts[0]];
    if (mine[mine.length - 1].o !== tapped) throw new Error('FAIL: tower local: the recorded drop differs from where the block was');
  }
  ok(n >= 1, `tower local: ${n} drops, each recorded exactly where the block stopped (one by Space)`);
  await endCard(pg);
  const e = await h.engine(pg, id);
  ok(e.over && e.result.score === e.state.blocks.length - 1, `tower local: the game ended at ${e.result.score} high`);
  if (shots) {
    await shot(pg, `${shots}-end.png`);
    await pg.click('#game-root [data-g="end-look"]');
    await h.wait(300);
    await shot(pg, `${shots}-board.png`);
  }
  await h.closeGame(pg);
  return id;
}

async function bonesLocal(h, pg, { shots = null } = {}) {
  await pg.evaluate(() => { window.__bonesTest = { log: [] }; });
  await h.newLocalGame(pg, 'bones');
  const id = await pg.evaluate(() => window.__lastMatchId);
  let n = 0;
  for (;;) {
    const e = await h.engine(pg, id);
    if (e.over) break;
    const who = e.acts[0];
    await pg.waitForSelector(`.gb-tray[data-who="${who}"].is-picking`, { timeout: 15000 });
    if (shots && n === 9) { await h.wait(250); await shot(pg, `${shots}-mid.png`); }
    const col = bonesPick(e.state, who);
    await pg.click(`.gb-tray[data-who="${who}"] .gb-col[data-col="${col}"]`);
    n++;
    await waitMoves(pg, id, n);
  }
  await endCard(pg);
  const e = await h.engine(pg, id);
  ok(e.over && n >= 9, `bones local: same-phone game played to the end (${n} dice)`);
  if (shots) {
    await shot(pg, `${shots}-end.png`);
    await pg.click('#game-root [data-g="end-look"]');
    await h.wait(300);
    await shot(pg, `${shots}-board.png`);
  }
  await h.closeGame(pg);
  return id;
}

// ── (e) WebGL contexts: no leaks across reopenings; loss + restore ─────
async function glHygiene(h, pg) {
  await pg.evaluate(() => {
    const live = (window.__glCtx = []);
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const ctx = orig.call(this, type, ...rest);
      if (ctx && /webgl/i.test(type) && !live.includes(ctx)) live.push(ctx);
      return ctx;
    };
    window.__glLive = () => window.__glCtx.filter((c) => !c.isContextLost()).length;
  });
  const ids = {};
  await pg.evaluate(() => { window.__towerTest = { log: [] }; window.__bonesTest = { log: [] }; });
  for (const [game, ready] of [['tower', '.gt-view[data-gl="ok"]'], ['bones', '.gb-band[data-gl="ok"]']]) {
    const made0 = await pg.evaluate(() => window.__glCtx.length);
    await h.newLocalGame(pg, game);
    ids[game] = await pg.evaluate(() => window.__lastMatchId);
    await pg.waitForSelector(ready, { timeout: 10000 });
    await h.closeGame(pg);
    for (let i = 0; i < 5; i++) {
      await h.openMatch(pg, ids[game]);
      await pg.waitForSelector(ready, { timeout: 10000 });
      if (i === 0) ok(await pg.evaluate(() => window.__glLive()) === 1, `${game}: one live WebGL context while open`);
      await h.wait(150);
      await h.closeGame(pg);
    }
    await h.wait(200);
    const all = await pg.evaluate(() => window.__glCtx.length) - made0;
    const live = await pg.evaluate(() => window.__glLive());
    ok(all === 6 && live === 0, `${game}: no WebGL contexts leak after closing and reopening 5 times (${all} made, ${live} live)`);
  }

  // context loss mid-game: pause, then rebuild from state and keep playing
  await h.openMatch(pg, ids.tower);
  await pg.waitForSelector('.gt-view[data-phase="slide"]', { timeout: 10000 });
  await pg.evaluate(() => { window.__lose = document.querySelector('.gt-canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
  await pg.waitForSelector('.gt-view[data-gl="lost"]', { timeout: 4000 });
  const f0 = await pg.evaluate(() => window.__towerTest.frames || 0);
  await h.wait(400);
  ok(await pg.evaluate(() => window.__towerTest.frames || 0) === f0, 'tower: rendering pauses while the WebGL context is lost');
  await pg.evaluate(() => window.__lose.restoreContext());
  await pg.waitForFunction(() => window.__towerTest.log.includes('restored'), null, { timeout: 4000 });
  const m0 = await movesOf(h, pg, ids.tower);
  await pg.waitForSelector('.gt-view[data-phase="slide"]');
  await pg.evaluate(() => { window.__towerTest.next = 0.2; });
  await pg.click('.gt-view');
  await waitMoves(pg, ids.tower, m0 + 1);
  await h.wait(900);
  ok(await pg.evaluate(() => window.__towerTest.frames || 0) > f0 + 10, 'tower: after the context comes back it renders and plays on');
  await shot(pg, 'tower-after-context-restore.png');
  await h.closeGame(pg);

  await h.openMatch(pg, ids.bones);
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 12000 });
  await pg.evaluate(() => { window.__lose = document.querySelector('.gb-band canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
  await pg.waitForSelector('.gb-band[data-gl="lost"]', { timeout: 4000 });
  await pg.evaluate(() => window.__lose.restoreContext());
  await pg.waitForFunction(() => window.__bonesTest.log.includes('restored'), null, { timeout: 4000 });
  const e = await h.engine(pg, ids.bones);
  const who = e.acts[0];
  const f1 = await pg.evaluate(() => window.__bonesTest.frames || 0);
  await pg.click(`.gb-tray[data-who="${who}"] .gb-col[data-col="${bonesPick(e.state, who)}"]`);
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 12000 });
  ok(await pg.evaluate(() => window.__bonesTest.frames || 0) > f1 + 10, 'bones: after the context comes back the next die still tumbles');
  await shot(pg, 'bones-after-context-restore.png');
  await h.closeGame(pg);
  ok(await pg.evaluate(() => window.__glLive()) === 0, 'no WebGL contexts left after all of that');
}

// ── 2D fallback when WebGL can't start ────────────────────────────────
async function fallback2D(h, pg) {
  await pg.evaluate(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    window.__realGetContext = orig;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : orig.call(this, type, ...rest); };
    window.__towerTest = { log: [] };
  });
  await h.newLocalGame(pg, 'tower');
  await pg.waitForSelector('.gt-view[data-gl="2d"][data-phase="slide"]', { timeout: 8000 });
  const id = await pg.evaluate(() => window.__lastMatchId);
  ok(await pg.isVisible('.gt-note'), 'tower: without WebGL it says so and draws a flat version');
  await pg.evaluate(() => { window.__towerTest.next = 0.3; });
  await pg.click('.gt-view');
  await waitMoves(pg, id, 1);
  await pg.waitForSelector('.gt-view[data-phase="slide"]');
  await h.wait(600);
  await shot(pg, 'tower-fallback-2d.png');
  await h.closeGame(pg);
  await h.newLocalGame(pg, 'bones');
  await pg.waitForSelector('.gb-band[data-gl="2d"]', { timeout: 8000 });
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 8000 });
  const bid = await pg.evaluate(() => window.__lastMatchId);
  const e = await h.engine(pg, bid);
  ok(await pg.$eval('.gb-die2d .gb-die', (d) => Number(d.dataset.v)) === e.state.roll, 'bones: without WebGL a flat die lands on the roll');
  await pg.click(`.gb-tray[data-who="${e.acts[0]}"] .gb-col[data-col="0"]`);
  await waitMoves(pg, bid, 1);
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 8000 });
  await shot(pg, 'bones-fallback-2d.png');
  await h.closeGame(pg);
  await pg.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.__realGetContext; });
  // three.js logs one console.error per failed context; those are expected here.
  for (let i = h.errors.length - 1; i >= 0; i--) if (/Error creating WebGL context/.test(h.errors[i])) h.errors.splice(i, 1);
}

// ── run ───────────────────────────────────────────────────────────────
(async () => {
  let failed = false;
  try {
    await unit();
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
    return;
  }
  const h = await launch({ port: 8860, only: ['tower', 'bones'] });
  try {
    await towerOnline(h);
    await bonesOnline(h);
    await h.a.setViewportSize({ width: 390, height: 844 });
    const before = h.results().length;
    await towerLocal(h, h.a);
    await bonesLocal(h, h.a);
    await h.settle();
    ok(h.results().length === before + 2, 'same-phone results recorded');
    await glHygiene(h, h.b);
    await fallback2D(h, h.b);
    h.assertNoErrors();
    ok(true, 'no page errors (light run)');
  } catch (e) {
    failed = true;
    console.error(e.message);
    await shot(h.a, 'FAIL-a.png').catch(() => {});
    await shot(h.b, 'FAIL-b.png').catch(() => {});
    console.error('errors:', h.errors);
  } finally {
    await h.close();
  }
  if (!failed) {
    const d = await launch({ port: 8861, only: ['tower', 'bones'], colorScheme: 'dark' });
    try {
      await d.a.setViewportSize({ width: 390, height: 844 });
      await d.b.setViewportSize({ width: 360, height: 740 });
      await Promise.all([towerLocal(d, d.a, { shots: 'tower-dark-390' }), towerLocal(d, d.b, { shots: 'tower-dark-360' })]);
      await Promise.all([bonesLocal(d, d.a, { shots: 'bones-dark-390' }), bonesLocal(d, d.b, { shots: 'bones-dark-360' })]);
      d.assertNoErrors();
      ok(true, 'no page errors (dark run)');
    } catch (e) {
      failed = true;
      console.error(e.message);
      await shot(d.a, 'FAIL-dark-a.png').catch(() => {});
      await shot(d.b, 'FAIL-dark-b.png').catch(() => {});
      console.error('errors:', d.errors);
    } finally {
      await d.close();
    }
  }
  console.log(failed ? '\nFAILED' : `\nALL GOOD (screenshots in ${SHOTS})`);
  if (failed) process.exitCode = 1;
})();
