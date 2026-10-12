// Knucklebones: the update's own tests. Rules in Node (old-log replay safety, twists, Last Word,
// records maths) and the phone UI through the real app (layout, full-column taps, finale timing,
// tap-to-skip, picker, previews, records, celebrations).
//   node tools/test/games/threed-bones.test.js            (PORT=8904 uses 8904 and 8905)
//   node tools/test/games/threed-bones.test.js --balance  prints first-player win rates (Last Word on/off)
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'just-us-shots', 'threed');
const PORT = Number(process.env.PORT) || 8900;
fs.mkdirSync(SHOTS, { recursive: true });

const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const other = (w) => (w === 'a' ? 'b' : 'a');
const clone = (x) => JSON.parse(JSON.stringify(x));
const throws = (fn, re) => { try { fn(); } catch (e) { return re ? re.test(e.message) : true; } return false; };
const shot = (pg, name) => pg.screenshot({ path: path.join(SHOTS, name), scale: 'css' });

// ── the ORIGINAL rules, copied from the commit before the update (js/games/bones.js @ 6e9fee4) ──
// Old match logs ({ col } moves, no setup move) must keep replaying to exactly these results.
const REF = (() => {
  const ROWS = 3; const COLS = 3;
  let randInt;
  const oth = (w) => (w === 'a' ? 'b' : 'a');
  const rollFor = (seed, n) => randInt(6, seed, 'roll', n) + 1;
  function colScore(col) {
    const c = {};
    for (const v of col) c[v] = (c[v] || 0) + 1;
    let t = 0;
    for (const v of Object.keys(c)) t += Number(v) * c[v] * c[v];
    return t;
  }
  const gridScore = (g) => g.reduce((t, col) => t + colScore(col), 0);
  const gridFull = (g) => g.every((col) => col.length >= ROWS);
  return {
    bind(ri) { randInt = ri; },
    init({ first, seed }) {
      return { seed, turn: first === 'b' ? 'b' : 'a', n: 0, roll: rollFor(seed, 0), grids: { a: [[], [], []], b: [[], [], []] }, last: null, over: false };
    },
    next(s) { return s.over ? [] : [s.turn]; },
    apply(s, who, mv) {
      if (s.over) throw new Error('The game is over.');
      if (who !== s.turn) throw new Error('Hold on, it’s not your turn.');
      const col = mv ? mv.col : undefined;
      if (!Number.isInteger(col) || col < 0 || col >= COLS) throw new Error('Pick one of your three columns.');
      const mine = s.grids[who][col];
      if (mine.length >= ROWS) throw new Error('That column is full. Pick another one.');
      const value = s.roll;
      mine.push(value);
      const opp = oth(who);
      const before = s.grids[opp][col];
      const after = before.filter((v) => v !== value);
      s.grids[opp][col] = after;
      s.last = { who, col, value, n: s.n, oppBefore: before.slice(), destroyed: before.length - after.length };
      s.n += 1;
      if (gridFull(s.grids.a) || gridFull(s.grids.b)) { s.over = true; s.roll = null; } else { s.turn = opp; s.roll = rollFor(s.seed, s.n); }
      return s;
    },
    result(s) {
      const a = gridScore(s.grids.a); const b = gridScore(s.grids.b);
      if (a === b) return { winner: null, text: 'Dead even', sub: `${a} apiece. Rematch?` };
      return { winner: a > b ? 'a' : 'b', sub: `${Math.max(a, b)} to ${Math.min(a, b)}.` };
    },
    score(s) { return { a: gridScore(s.grids.a), b: gridScore(s.grids.b) }; },
  };
})();

// recorded by running the original rules (git show 6e9fee4:js/games/bones.js)
const PIN = { score: { a: 22, b: 79 }, moves: 26 };
const FIXED_SCORES = { 777: { a: 30, b: 34, n: 21 }, 31415: { a: 20, b: 38, n: 21 } };

let B; let core;
const step = (s, who, mv) => B.apply(clone(s), who, mv);
// Smash when you can, otherwise fill the emptiest column (same strategy the other bones tests use).
function pickSmash(s, who) {
  const op = other(who);
  const free = [0, 1, 2].filter((c) => s.grids[who][c].length < 3);
  const smash = free.find((c) => s.grids[op][c].includes(s.roll));
  if (smash !== undefined) return smash;
  return free.slice().sort((x, y) => s.grids[who][x].length - s.grids[who][y].length || x - y)[0];
}
const pickRandom = (rnd) => (s, who) => {
  const free = [0, 1, 2].filter((c) => s.grids[who][c].length < 3);
  return free[Math.floor(rnd() * free.length)];
};
const lcg = (seed) => { let r = seed; return () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); };
/** Play a whole game with the live rules. `setup` = an optional first setup move, e.g. { tw: 'golden' }. */
function playGame(def, seed, first, pick, setup, onMove) {
  let s = def.init({ first, seed, opts: {} });
  const moves = [];
  if (setup) { s = def.apply(clone(s), s.turn, setup); moves.push({ who: first, mv: setup }); }
  while (def.next(s).length) {
    const who = s.turn;
    const mv = { col: pick(s, who) };
    s = def.apply(clone(s), who, mv);
    moves.push({ who, mv });
    if (onMove) onMove(s, who);
  }
  return { s, moves };
}
const listsOf = (moves) => ({ a: moves.filter((m) => m.who === 'a').map((m) => m.mv), b: moves.filter((m) => m.who === 'b').map((m) => m.mv) });
// a match as the engine stores it: two per-player lists replayed together
const matchOf = (first, seed, moves) => ({ first, seed, opts: {}, lists: listsOf(moves) });

// ── rules, in Node ────────────────────────────────────────────────────
async function unit() {
  core = await import(pathToFileURL(path.join(ROOT, 'js/games/core.js')).href);
  await import(pathToFileURL(path.join(ROOT, 'js/games/bones.js')).href);
  B = core.gameById('bones');
  REF.bind(core.randInt);
  const KEYS = ['seed', 'turn', 'n', 'roll', 'grids', 'over'];
  const same = (s, r) => KEYS.every((k) => JSON.stringify(s[k]) === JSON.stringify(r[k]))
    && JSON.stringify(s.last && ['who', 'col', 'value', 'n', 'oppBefore', 'destroyed'].map((k) => s.last[k])) === JSON.stringify(r.last && ['who', 'col', 'value', 'n', 'oppBefore', 'destroyed'].map((k) => r.last[k]));

  // 1. Old logs replay identically: 60 games from the original rules, compared after EVERY move.
  let checked = 0;
  for (let g = 0; g < 60; g++) {
    const first = g % 2 ? 'a' : 'b';
    const seed = 5000 + g * 37;
    const pick = g % 3 === 0 ? pickSmash : pickRandom(lcg(900 + g));
    let ref = REF.init({ first, seed });
    let cur = B.init({ first, seed, opts: {} });
    if (!same(cur, ref)) throw new Error(`FAIL: bones: init differs from the original rules (game ${g})`);
    while (REF.next(ref).length) {
      const who = ref.turn;
      if (JSON.stringify(B.next(cur)) !== JSON.stringify(REF.next(ref))) throw new Error(`FAIL: bones: next() differs (game ${g})`);
      const mv = { col: pick(ref, who) };
      ref = REF.apply(clone(ref), who, mv);
      cur = B.apply(clone(cur), who, mv);
      checked++;
      if (!same(cur, ref)) throw new Error(`FAIL: bones: state differs from the original rules (game ${g}, move ${ref.n})`);
    }
    const rr = REF.result(ref); const cr = B.result(cur);
    if (rr.winner !== cr.winner || JSON.stringify(REF.score(ref)) !== JSON.stringify(B.score(cur))) throw new Error(`FAIL: bones: result differs (game ${g})`);
    if (!cr.sub) throw new Error(`FAIL: bones: result has no sub line (game ${g})`);
  }
  ok(checked > 800, `bones: 60 old-style games replay field-for-field like the original rules (${checked} moves checked)`);

  // 2. Fixed literal logs through the engine's derive(): the final scores were recorded from the original code.
  const FIXED = [
    { first: 'a', seed: 777, lists: { a: [{ col: 0 }, { col: 1 }, { col: 2 }, { col: 0 }, { col: 1 }, { col: 2 }, { col: 0 }, { col: 1 }, { col: 2 }, { col: 0 }, { col: 1 }, { col: 2 }], b: [{ col: 0 }, { col: 0 }, { col: 1 }, { col: 1 }, { col: 2 }, { col: 2 }, { col: 0 }, { col: 1 }, { col: 2 }, { col: 1 }, { col: 0 }] } },
    { first: 'b', seed: 31415, lists: { a: [{ col: 2 }, { col: 2 }, { col: 1 }, { col: 0 }, { col: 0 }, { col: 1 }, { col: 2 }, { col: 1 }, { col: 0 }, { col: 2 }, { col: 1 }, { col: 0 }], b: [{ col: 1 }, { col: 0 }, { col: 2 }, { col: 2 }, { col: 1 }, { col: 0 }, { col: 0 }, { col: 1 }, { col: 2 }, { col: 1 }, { col: 2 }, { col: 0 }] } },
  ];
  for (const m of FIXED) {
    const d = core.derive(B, clone(m));
    // the same log through a bare copy of the original rules
    let ref = REF.init({ first: m.first, seed: m.seed });
    const used = { a: 0, b: 0 };
    while (REF.next(ref).length) {
      const who = REF.next(ref)[0];
      if (used[who] >= m.lists[who].length) break;
      try { ref = REF.apply(clone(ref), who, m.lists[who][used[who]]); used[who]++; } catch { used[who]++; }
    }
    ok(JSON.stringify(d.state.grids) === JSON.stringify(ref.grids) && d.state.n === ref.n && d.over === ref.over, `bones: fixed old log (seed ${m.seed}) derives to the original grids (${d.count} moves, over: ${d.over})`);
    const fx = FIXED_SCORES[m.seed];
    ok(d.over && d.count === fx.n && d.result.winner === REF.result(ref).winner && JSON.stringify(B.score(d.state)) === JSON.stringify(REF.score(ref)) && B.score(d.state).a === fx.a && B.score(d.state).b === fx.b, `bones: …and the original winner and score (${B.score(d.state).a}–${B.score(d.state).b}, as recorded from the old rules)`);
  }
  // a snapshot of one whole game, pinned so a rules drift shows up even if the reference copy were edited
  const pin = playGame(B, 2468, 'a', pickSmash);
  ok(JSON.stringify(B.score(pin.s)) === JSON.stringify(PIN.score) && pin.moves.length === PIN.moves && pin.s.n === PIN.moves, `bones: pinned game (seed 2468) is still ${PIN.score.a}–${PIN.score.b} in ${PIN.moves} dice`);
  ok(!('tw' in pin.s) || pin.s.tw === undefined, 'bones: a game with no setup move carries no twist');
  await twistRules();
  recordTests();
}

// ── twists, Last Word, facts, commentary ──────────────────────────────
async function twistRules() {
  const sc = (s) => B.score(s);
  const k0 = B.init({ first: 'b', seed: 99, opts: {} });
  // the setup move
  const g = step(k0, 'b', { tw: 'golden' });
  ok(g.tw === 'golden' && g.turn === 'b' && g.n === 0 && g.roll === k0.roll && g.last === null && B.next(g).join() === 'b', 'bones twist: the setup move doesn’t pass the turn, spend a die or change the first roll');
  ok(g.gold === core.randInt(3, 99, 'gold') && g.gold >= 0 && g.gold <= 2, 'bones twist: the golden column is seeded');
  ok(throws(() => step(k0, 'a', { tw: 'golden' }), /turn/), 'bones twist: only the starter can pick a twist');
  const afterDie = step(k0, 'b', { col: 0 });
  ok(throws(() => step(afterDie, 'a', { tw: 'golden' }), /before the first die/) && throws(() => step(afterDie, 'b', { tw: 'golden' })), 'bones twist: once a die is placed the match is classic and a late setup move is refused');
  ok(throws(() => step(g, 'b', { tw: 'mirror' }), /before the first die/), 'bones twist: you can’t pick twice');
  ok(['chaos', 7, null, '', 'Golden', {}].every((tw) => throws(() => step(k0, 'b', { tw }), /twist|version/i)), 'bones twist: unknown twists are refused with a friendly message');
  const cl = step(k0, 'b', { tw: 'classic' });
  ok(cl.tw === 'classic' && cl.gold === undefined && !twisted(cl), 'bones twist: "classic" is accepted and plays the original rules');
  ok(JSON.stringify(step(cl, 'b', { col: 1 }).grids) === JSON.stringify(step(k0, 'b', { col: 1 }).grids), 'bones twist: …with the same dice as a plain match');
  ok(step(k0, 'b', { col: 0, tw: 'golden' }).tw === undefined, 'bones twist: a die with a stray tw field is just a die');

  // golden
  const gs = clone(g); gs.gold = 1; gs.grids.a = [[2, 2], [4, 4], []]; gs.grids.b = [[1], [3, 3, 3], [5]];
  ok(sc(gs).a === 8 + 2 * 16 && sc(gs).b === 1 + 2 * 27 + 5, 'bones golden: the gilded column counts double for both players');
  gs.turn = 'a'; gs.roll = 3;
  const gp = step(gs, 'a', { col: 1 });
  ok(gp.grids.b[1].length === 0 && gp.last.pts === 54 && gp.last.destroyed === 3 && gp.last.wipe && gp.big.pts === 54 && gp.big.who === 'a', 'bones golden: wiping a gilded triple removes 54 points (and counts as a wipe)');
  ok(gp.last.gain === 2 * (colScoreOf([4, 4, 3]) - colScoreOf([4, 4])) && gp.wipes.a === 1, 'bones golden: the gain counts double too');

  // mirror
  const m0 = step(B.init({ first: 'a', seed: 4242, opts: {} }), 'a', { tw: 'mirror' });
  let ms = m0; const rolls = [];
  for (let i = 0; i < 16; i++) { rolls.push(ms.roll); ms = step(ms, ms.turn, { col: i % 3 }); }
  const rf = (k) => core.randInt(6, 4242, 'roll', k) + 1;
  // a round is five dice each: the starter takes them in order, the other player starts two places along
  const slot = (i) => { const j = (i >> 1) % 5; return Math.floor(i / 10) * 5 + (i % 2 ? (j + 2) % 5 : j); };
  ok(rolls.every((v, i) => v === rf(slot(i))) && rolls[0] === rf(0) && m0.roll === rf(0), 'bones mirror: the starter takes a round’s five dice in order and the other player starts two places along');
  ok([0, 1].every((rd) => [0, 2, 4, 6, 8].map((i) => slot(10 * rd + i)).sort().join() === [1, 3, 5, 7, 9].map((i) => slot(10 * rd + i)).sort().join()), 'bones mirror: …so over a round both players get exactly the same five dice');
  ok(Array.from({ length: 80 }, (_, i) => slot(i) !== slot(i + 1)).every(Boolean), 'bones mirror: …and nobody is ever handed the very same slot straight after it was played');
  ok(new Set(rolls).size > 2, 'bones mirror: …and the dice still vary');
  // how often the die you get is the twin of the one just played against you: chance (1 in 6), not the 37% of the old X Y / Y X
  let twins = 0; let pairs = 0;
  for (let g = 0; g < 300; g++) {
    let x = step(B.init({ first: g % 2 ? 'a' : 'b', seed: 91000 + g, opts: {} }), g % 2 ? 'a' : 'b', { tw: 'mirror' }); let prev = null;
    for (let i = 0; i < 16; i++) { if (prev !== null) { pairs++; if (prev === x.roll) twins++; } prev = x.roll; x = step(x, x.turn, { col: i % 3 }); }
  }
  ok(twins / pairs < 0.22, `bones mirror: the next die matches the one just played ${(100 * twins / pairs).toFixed(1)}% of the time (chance is 16.7%)`);

  // blind
  const bl = step(B.init({ first: 'a', seed: 4242, opts: {} }), 'a', { tw: 'blind' });
  ok(bl.roll === core.randInt(6, 4242, 'blind', 0) + 1 && step(bl, 'a', { col: 0 }).roll === core.randInt(6, 4242, 'roll', 1) + 1, 'bones blind: a fresh unseen first die, then the normal rolls');

  // oracle: identical to classic apart from the view
  const or = step(B.init({ first: 'a', seed: 4242, opts: {} }), 'a', { tw: 'oracle' });
  const cs = B.init({ first: 'a', seed: 4242, opts: {} });
  let o1 = or; let c1 = cs;
  for (let i = 0; i < 10; i++) { const col = i % 3; o1 = step(o1, o1.turn, { col }); c1 = step(c1, c1.turn, { col }); }
  ok(JSON.stringify(o1.grids) === JSON.stringify(c1.grids) && o1.roll === c1.roll, 'bones oracle: the rules are exactly the classic ones (rolls are a function of the turn number)');

  // Last Word
  const lw = (tw) => { const x = step(B.init({ first: 'a', seed: 1, opts: {} }), 'a', { tw }); x.grids.a = [[1, 2, 3], [1, 2, 3], [1, 2]]; x.grids.b = [[6, 5], [6], [5, 5]]; x.turn = 'a'; x.roll = 4; x.n = 16; return x; };
  const w1 = step(lw('golden'), 'a', { col: 2 });
  ok(!w1.over && w1.final === true && w1.turn === 'b' && B.next(w1).join() === 'b' && w1.roll === core.randInt(6, 1, 'roll', 17) + 1, 'bones last word: when the starter fills up first, the other player gets one more die');
  const w2 = step(w1, 'b', { col: 0 });
  ok(w2.over && B.next(w2).length === 0 && w2.roll === null && w2.n === 18, 'bones last word: …and then the game ends, with both having placed the same number of dice');
  const w1c = lw('classic'); w1c.tw = undefined; delete w1c.tw;
  ok(step(w1c, 'a', { col: 2 }).over, 'bones last word: classic matches (and old logs) still end the instant a grid fills');
  const wb = lw('golden'); wb.turn = 'b'; wb.first = 'a'; wb.grids.b = [[1, 2, 3], [1, 2, 3], [1, 2]]; wb.grids.a = [[6], [], []]; wb.roll = 4;
  ok(step(wb, 'b', { col: 2 }).over, 'bones last word: if the second player fills up first it just ends (they have placed as many dice as the starter)');
  // the last word can smash the starter's dice: still over
  const ws = lw('blind'); ws.grids.b = [[4], [], []]; // b's last word: placing a 6 in column 2 smashes a's 6s? use value matching
  const w3 = step(ws, 'a', { col: 2 }); const w3b = clone(w3); w3b.roll = 4;
  const w4 = step(w3b, 'b', { col: 2 });
  ok(w4.over && w4.last.destroyed === 0 && gridFullOf(w4.grids.a) && w4.grids.a[2].join() === '1,2,4', 'bones last word: the last die lands softly: it doesn’t smash, so a finished grid stays finished');
  const wm = lw('mirror'); wm.grids.b = [[4], [], []]; const wm1 = step(wm, 'a', { col: 2 }); wm1.roll = 4; const wm2 = step(wm1, 'b', { col: 2 });
  ok(wm2.over && wm2.last.destroyed === 1 && !gridFullOf(wm2.grids.a), 'bones last word: in Mirror Dice the last die is a normal one (it can smash, and the game is still over)');

  // random games under every twist: invariants and Last Word's equal dice
  const rnd = lcg(31337);
  for (const tw of TW) {
    let longest = 0; let lwGames = 0;
    for (let i = 0; i < 300; i++) {
      const first = i % 2 ? 'a' : 'b';
      let st = B.init({ first, seed: 70000 + i, opts: {} });
      st = B.apply(clone(st), st.turn, { tw });
      let moves = 0;
      while (B.next(st).length) {
        const who = st.turn;
        const free = [0, 1, 2].filter((c) => st.grids[who][c].length < 3);
        if (!free.length || moves > 400) throw new Error(`FAIL: bones ${tw}: stuck in game ${i}`);
        st = B.apply(clone(st), who, { col: free[Math.floor(rnd() * free.length)] });
        moves++;
        if (['a', 'b'].some((w) => st.grids[w].some((col) => col.length > 3 || col.some((v) => !(v >= 1 && v <= 6))))) throw new Error(`FAIL: bones ${tw}: bad grid in game ${i}`);
      }
      if (st.n % 2 !== 0) throw new Error(`FAIL: bones ${tw}: game ${i} ended with an uneven number of dice (${st.n})`);
      if (st.final) lwGames++;
      const t = B.score(st); const r = B.result(st);
      if (r.winner !== (t.a === t.b ? null : t.a > t.b ? 'a' : 'b')) throw new Error(`FAIL: bones ${tw}: wrong winner in game ${i}`);
      longest = Math.max(longest, moves);
    }
    ok(lwGames > 20 && lwGames < 300, `bones ${tw}: 300 random games end with equal dice placed (${lwGames} needed a last word, longest ${longest} dice)`);
  }

  // a twist match through the engine's derive(): setup move first in the starter's list
  const sim = playGame(B, 8080, 'a', pickSmash, { tw: 'golden' });
  const dm = core.derive(B, matchOf('a', 8080, sim.moves));
  ok(dm.over && !dm.rejected.length && JSON.stringify(dm.state) === JSON.stringify(sim.s) && dm.state.tw === 'golden' && dm.count === sim.moves.length, 'bones twist: a twist match replays identically through the engine');
  const classicLog = playGame(B, 8080, 'a', pickSmash);
  const late = matchOf('a', 8080, classicLog.moves);
  late.lists.a.splice(2, 0, { tw: 'golden' }); // a late setup move in the starter’s list
  const dl = core.derive(B, late);
  ok(dl.rejected.length === 1 && /before the first die/.test(dl.rejected[0].error) && JSON.stringify(dl.state.grids) === JSON.stringify(classicLog.s.grids) && dl.state.tw === undefined, 'bones twist: a late setup move in a log is rejected and the match stays classic');
  const early = matchOf('a', 8080, classicLog.moves);
  early.lists.b.unshift({ tw: 'golden' }); // the non-starter can’t pick either
  ok(core.derive(B, early).rejected.length === 1 && core.derive(B, early).state.tw === undefined, 'bones twist: a setup move from the other player is rejected');

  // facts: deficit, wipes, triples, comeback
  const f = step(B.init({ first: 'a', seed: 5, opts: {} }), 'a', { col: 0 });
  ok(f.big.pts === 0 && f.deficit.b === f.last.value && f.deficit.a === 0 && f.wipes.a === 0, 'bones facts: a quiet first die records no smash; the other player is simply that far behind');
  const cb = B.init({ first: 'a', seed: 5, opts: {} });
  cb.grids.a = [[1], [2], []]; cb.grids.b = [[6, 6, 5], [6], [4, 4]]; cb.turn = 'a'; cb.roll = 5; cb.deficit = { a: 16, b: 0 };
  const cbs = step(cb, 'a', { col: 0 });
  ok(cbs.last.destroyed === 1 && cbs.last.pts === 5, 'bones facts: a smash records the points removed');
  const cb2 = clone(cb); cb2.grids.a = [[6, 6], [6], [4]]; cb2.grids.b = [[1], [2], []]; cb2.deficit = { a: 22, b: 0 }; cb2.grids.a = [[5, 5], [6], [4]]; cb2.grids.b = [[6, 6, 6], [6, 5], [4, 4]]; cb2.roll = 6;
  const flipped = step(cb2, 'a', { col: 0 });
  ok(flipped.last.wipe && flipped.last.pts === 54 && flipped.big.pts === 54 && flipped.wipes.a === 1, 'bones facts: wiping a triple stack of 6s is a 54-point wipe');
  ok(flipped.last.comeback === true && flipped.cb.a === 1, 'bones facts: taking the lead after being 15+ down is flagged once as a comeback');
  const trip = clone(k0); trip.turn = 'a'; trip.roll = 5; trip.grids.a = [[5, 5], [], []];
  const tr = step(trip, 'a', { col: 0 });
  ok(tr.last.triple && tr.trips.a === 1 && tr.last.gain === 45 - 20, 'bones facts: three alike in a column is a triple stack (45 for 5s)');

  // commentary lines, and the winner never changes
  const rs = (a, b, extra) => { const x = clone(k0); x.grids.a = a; x.grids.b = b; return B.result(Object.assign(x, extra || {})); };
  ok(/So close/.test(rs([[4], [], []], [[3], [], []]).sub) && /^Won by 1!/.test(rs([[4], [], []], [[3], [], []]).sub) && /So close/.test(rs([[6], [], []], [[3], [], []]).sub), 'bones result: a win by 3 or less says "So close — rematch?" (and "Won by 1!")');
  ok(/Comeback from 22 down/.test(rs([[6, 6], [6, 6], [6]], [[1], [], []], { deficit: { a: 0, b: 22 } }).sub.replace('b', 'b')) === false, 'bones result: the comeback line belongs to the winner’s own deficit');
  ok(/Comeback from 22 down/.test(rs([[6, 6], [6, 6], [6]], [[1], [], []], { deficit: { a: 22, b: 0 } }).sub), 'bones result: "Comeback from 22 down"');
  ok(/Wiped 54 in one go/.test(rs([[6, 6], [6, 6], [6]], [[1], [], []], { big: { pts: 54, who: 'a', n: 3 } }).sub), 'bones result: "Wiped 54 in one go"');
  ok(/triple/i.test(rs([[6, 6], [6, 6], [6]], [[1], [], []], { trips: { a: 1, b: 0 } }).sub) && rs([[6, 6], [6, 6], [6]], [[1], [], []]).sub === '54 to 1.', 'bones result: a triple gets a nod, otherwise just the score');
  ok(rs([[4], [], []], [[4], [], []]).winner === null && B.result({ grids: { a: [[4], [], []], b: [[1, 1], [], []] } }).winner === null, 'bones result: draws and bare states still work');
}

// ── records maths (pure) ──────────────────────────────────────────────
function recordTests() {
  const RF = B._test.recordsFor;
  const game = (seed, first, tw) => playGame(B, seed, first, pickSmash, tw ? { tw } : null).s;
  // pick games with known outcomes
  const wins = { a: [], b: [] };
  for (let i = 0; i < 400 && (wins.a.length < 4 || wins.b.length < 2); i++) {
    const s = game(9000 + i, i % 2 ? 'a' : 'b');
    const r = B.result(s);
    if (r.winner) wins[r.winner].push({ s, r, i });
  }
  const A1 = wins.a[0]; const A2 = wins.a[1]; const B1 = wins.b[0];
  let d = {};
  const apply = (rec) => { if (rec.patch) d = { ...d, ...rec.patch }; return rec; };
  const r1 = apply(RF(d, A1.s, A1.r, 'm1'));
  ok(d.games_n === 1 && d.last_id === 'm1' && d.streak_who === 'a' && d.streak_len === 1 && d.form === 'a' && d.best_a_best === B.score(A1.s).a && d.best_b_best === B.score(A1.s).b, 'bones records: the first game sets the baselines');
  ok(r1.flags === '' && d.tw_classic_n === 1 && d.tw_classic_a_n === 1, 'bones records: …with no NEW BEST stamp on a first game, and per-twist counts');
  const r1b = RF(d, A1.s, A1.r, 'm1');
  ok(r1b.patch === null && r1b.streak.len === 1 && r1b.form === 'a', 'bones records: the same match twice writes nothing (last_id), and reads back the streak');
  const r2 = apply(RF(d, A2.s, A2.r, 'm2'));
  ok(d.games_n === 2 && d.streak_len === 2 && d.streak_len_best === 2 && d.form === 'aa' && r2.streak.len === 2, 'bones records: winning again builds the streak');
  const r3 = apply(RF(d, B1.s, B1.r, 'm3'));
  ok(d.streak_who === 'b' && d.streak_len === 1 && d.streak_len_best === 2 && d.form === 'aab', 'bones records: the other player winning resets the streak (best streak stays)');
  const tie = clone(A1.s); tie.grids.a = [[4], [], []]; tie.grids.b = [[4], [], []];
  apply(RF(d, tie, B.result(tie), 'm4'));
  ok(d.streak_who === '-' && d.streak_len === 0 && d.form === 'aab-' && d.draw_n === 1, 'bones records: a draw ends the streak and shows as a dash in the form');
  for (let i = 0; i < 4; i++) apply(RF(d, A1.s, A1.r, `x${i}`));
  ok(d.form === '-aaaa' && d.games_n === 8, 'bones records: the form strip keeps the last five');
  // flags need an earlier record to beat
  const big = clone(A1.s); big.big = { pts: 30, who: 'a', n: 5 }; big.deficit = { a: 14, b: 0 };
  const bigR = B.result(big);
  const rf = RF({ ...d, smash_best: 12, comeback_best: 5, best_a_best: 5, best_b_best: 5 }, big, { winner: 'a' }, 'z');
  ok(rf.flags.split(',').includes('smash') && rf.flags.split(',').includes('comeback') && rf.patch.smash_best === 30 && rf.patch.smash_who === 'a' && rf.patch.comeback_best === 14 && rf.patch.comeback_who === 'a' && rf.flags.includes('pb_a'), 'bones records: a bigger smash, comeback or score than the record gets a flag and moves the record');
  // monotonic keys never go down, values are plain, keys are legal
  const keysOk = Object.entries(d).every(([k, v]) => /^[a-zA-Z0-9_.-]{1,60}$/.test(k) && ['number', 'string', 'boolean'].includes(typeof v));
  ok(keysOk, 'bones records: every key is a legal flat key with a number or string value');
  const low = RF({ ...d, best_a_best: 999, smash_best: 999, comeback_best: 999, games_n: 50, wipe_n: 9, streak_len_best: 9 }, A1.s, A1.r, 'low');
  ok(low.patch.best_a_best === undefined && low.patch.smash_best === undefined && low.patch.comeback_best === undefined && low.patch.streak_len_best === undefined && low.patch.games_n === 51, 'bones records: *_best keys are only written when beaten; *_n keys count up');
  const twg = game(9100, 'a', 'golden'); const gr = B.result(twg);
  const rg = RF({}, twg, gr, 'g1');
  ok(rg.patch['tw_golden_n'] === 1 && (!gr.winner || rg.patch[`tw_golden_${gr.winner}_n`] === 1), 'bones records: wins are counted per twist');
  const noData = RF({}, A1.s, A1.r, 'n1');
  ok(noData.patch.games_n === 1 && RF(undefined || {}, A1.s, A1.r, 'n2').patch.last_id === 'n2', 'bones records: no data yet is fine');
  return { wins };
}
const TW = ['golden', 'mirror', 'blind', 'oracle'];
const twisted = (s) => !!s.tw && s.tw !== 'classic';
const colScoreOf = (c) => B.score({ grids: { a: [c, [], []], b: [[], [], []] } }).a;
const gridFullOf = (g) => g.every((c) => c.length >= 3);

// ── browser helpers ───────────────────────────────────────────────────
const waitMoves = (pg, id, n, timeout = 12000) => pg.waitForFunction(([mid, k]) => {
  const d = window.__gamesDebug(mid);
  return d && d.lists.a.length + d.lists.b.length >= k;
}, [id, n], { timeout });
const movesOf = (h, pg, id) => h.engine(pg, id).then((e) => (e ? e.lists.a.length + e.lists.b.length : -1));
const endCard = (pg, timeout = 12000) => pg.waitForSelector('#game-root .gm-end:not([hidden]) .gm-end-card', { timeout });
async function withRandom(pg, r, fn) {
  await pg.evaluate((v) => { window.__realRandom = Math.random; Math.random = () => v; }, r);
  try { return await fn(); } finally { await pg.evaluate(() => { Math.random = window.__realRandom; }); }
}
/** Find a Math.random value whose match (first, seed) satisfies `pred(first, seed)`. */
function findR(pred, from = 1) {
  for (let i = from; i < 4000; i++) {
    const r = (i * 0.0377) % 1;
    const first = r < 0.5 ? 'a' : 'b';
    const seed = Math.floor(r * 2147483647);
    if (pred(first, seed)) return { r, first, seed };
  }
  throw new Error('no seed found');
}
/** The starter alternates between matches of a game, so a same-phone match can't be steered by the random value alone:
 *  predict who starts, pick a seed, and if the engine disagrees, drop that match and try again. */
const lastFirstOf = new WeakMap();
async function newLocalSim(h, pg, want, from = 1) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const prev = lastFirstOf.get(pg);
    const expect = prev ? other(prev) : null;
    const f = findR((first, seed) => want(expect || first, seed), from);
    await withRandom(pg, f.r, () => h.newLocalGame(pg, 'bones'));
    const id = await pg.evaluate(() => window.__lastMatchId);
    const first = (await h.engine(pg, id)).first;
    lastFirstOf.set(pg, first);
    if (want(first, f.seed)) return { id, first, seed: f.seed, r: f.r };
    await h.closeGame(pg);
    from = Math.round(f.r / 0.0377) + 1;
  }
  throw new Error('FAIL: could not steer a same-phone match to a wanted seed');
}
const hook = (pg) => pg.evaluate(() => { window.__bonesTest = { log: [], at: [] }; });
const logOf = (pg) => pg.evaluate(() => window.__bonesTest.log.slice());

// ── layout at every size ──────────────────────────────────────────────
const VIEWPORTS = [[320, 568], [360, 740], [390, 664], [430, 932], [844, 390], [667, 375]];
/** Everything written in the band (both labels and every line in them) lies inside the band's box, nothing is cut off
 *  by an ellipsis, and the two labels don't run into each other. */
async function bandFit(pg, what) {
  const m = await pg.evaluate(() => {
    const band = document.querySelector('.gb-band');
    const B = band.getBoundingClientRect();
    const inside = (r) => r.left >= B.left - 0.5 && r.right <= B.right + 0.5 && r.top >= B.top - 0.5 && r.bottom <= B.bottom + 0.5;
    const bad = [];
    const labs = [...band.querySelectorAll('.gb-lab')];
    const boxes = [];
    for (const l of labs) {
      const r = l.getBoundingClientRect();
      if (r.width && r.height) boxes.push(r);
      if (r.width && !inside(r)) bad.push(`label box ${Math.round(r.left - B.left)},${Math.round(r.top - B.top)} ${Math.round(r.width)}x${Math.round(r.height)} in a ${Math.round(B.width)}x${Math.round(B.height)} band`);
      for (const e of l.querySelectorAll('*')) {
        const q = e.getBoundingClientRect();
        if (q.width && q.height && !inside(q)) bad.push(`"${(e.textContent || '').trim().slice(0, 24)}" (${e.className}) spills out of the band`);
        if (getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) bad.push(`"${(e.textContent || '').trim().slice(0, 24)}" is cut off`);
      }
    }
    if (boxes.length === 2 && !(boxes[0].right <= boxes[1].left || boxes[1].right <= boxes[0].left || boxes[0].bottom <= boxes[1].top || boxes[1].bottom <= boxes[0].top)) bad.push('the two labels overlap');
    return { bad, text: band.innerText.replace(/\s+/g, ' ').trim(), size: `${Math.round(B.width)}x${Math.round(B.height)}` };
  });
  ok(!m.bad.length, `bones band fits (${what}, band ${m.size}): "${m.text.slice(0, 60)}"${m.bad.length ? ' PROBLEMS: ' + m.bad.join('; ') : ''}`);
}
async function layoutTests(h, pg, tag) {
  for (const [w, hh] of VIEWPORTS) {
    await pg.setViewportSize({ width: w, height: hh });
    await h.newLocalGame(pg, 'bones');
    await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
    await h.wait(350);
    const m = await pg.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const rt = q('#game-root');
      const cols = [...document.querySelectorAll('.gb-col')].map(r);
      return {
        vw: innerWidth, vh: innerHeight, top: r(q('.gb-top .gb-tray')), bot: r(q('.gb-bot .gb-tray')), band: r(q('.gb-band')),
        scrolls: rt.scrollHeight > rt.clientHeight + 1, colW: Math.min(...cols.map((c) => c.w)), colH: Math.min(...cols.map((c) => c.h)),
        die: parseFloat(getComputedStyle(q('.g-bones')).getPropertyValue('--gb-die')), land: q('.g-bones').classList.contains('is-land'),
        scores: [...document.querySelectorAll('.gb-scores')].map(r), canTap: document.querySelectorAll('.gb-col.can').length,
      };
    });
    const inside = (b) => b.x >= -0.5 && b.y >= -0.5 && b.r <= m.vw + 0.5 && b.b <= m.vh + 0.5;
    const label = `${w}×${hh}${m.land ? ' landscape' : ''}`;
    ok(inside(m.top) && inside(m.bot) && inside(m.band) && m.scores.every(inside), `bones layout ${label} (${tag}): both trays, the band and the column totals are inside the screen`);
    ok(!m.scrolls, `bones layout ${label} (${tag}): the room doesn't need to scroll`);
    ok(m.colW >= 44 && m.colH >= 44 && m.canTap === 3, `bones layout ${label} (${tag}): column buttons are ${Math.round(m.colW)}×${Math.round(m.colH)} px (≥ 44), die ${m.die}px`);
    if ((w === 844 && hh === 390) || (w === 320 && hh === 568)) ok((w === 844) === m.land, `bones layout ${label}: ${m.land ? 'landscape layout' : 'portrait layout'}`);
    if (w === 844 || w === 320 || w === 390) await shot(pg, `bones-layout-${tag}-${w}x${hh}.png`);
    // the very last die of a column is reachable by touch where it sits
    const tap = await pg.evaluate(() => {
      const b = document.querySelector('.gb-tray.is-picking .gb-col.can').getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height - 4);
      return !!(hit && hit.closest('.gb-col.can'));
    });
    ok(tap, `bones layout ${label}: the bottom of a column is not covered by anything`);
    await bandFit(pg, `${label} ${tag}, first roll`);
    await h.closeGame(pg);
  }
}

// ── full column: a tap says why nothing happened ──────────────────────
async function fullColumn(h, pg) {
  await pg.setViewportSize({ width: 390, height: 844 });
  await hook(pg);
  await h.newLocalGame(pg, 'bones');
  const id = await pg.evaluate(() => window.__lastMatchId);
  // whoever starts stacks column 0 three times; the other one stays out of column 0 so nothing is smashed there
  let first = null;
  for (let t = 0; t < 6; t++) {
    const e = await h.engine(pg, id);
    const who = e.acts[0];
    if (!first) first = who;
    await pg.waitForSelector(`.gb-tray[data-who="${who}"].is-picking`, { timeout: 15000 });
    const col = who === first ? 0 : 1 + (t % 2);
    await pg.tap(`.gb-tray[data-who="${who}"] .gb-col[data-col="${col}"]`);
    await waitMoves(pg, id, t + 1);
  }
  await pg.waitForSelector(`.gb-tray[data-who="${first}"].is-picking`, { timeout: 15000 });
  const before = await movesOf(h, pg, id);
  await pg.evaluate(() => { window.__bonesTest.log = []; });
  await pg.tap(`.gb-tray[data-who="${first}"] .gb-col[data-col="0"]`, { force: true }); // playwright counts aria-disabled as "not enabled"; a real finger doesn't
  await pg.waitForSelector('.toast', { timeout: 2000 });
  const toast = await pg.$$eval('.toast', (x) => x.map((t) => t.textContent).join('|'));
  ok(/column is full/i.test(toast), `bones: tapping a full column on a phone says so ("${toast.trim()}")`);
  const log = await logOf(pg);
  ok(log.includes('sfx:bad') && log.includes('full'), 'bones: …with the "bad" sound');
  ok(await pg.$eval(`.gb-tray[data-who="${first}"] .gb-col[data-col="0"]`, (b) => b.classList.contains('nope') && b.getAttribute('aria-disabled') === 'true' && !b.disabled), 'bones: …and a little shake (aria-disabled, so the tap arrives)');
  ok((await movesOf(h, pg, id)) === before, 'bones: …and no move was made');
  await h.closeGame(pg);
}

// ── tap-to-skip ───────────────────────────────────────────────────────
async function tapToSkip(h, pg) {
  await pg.setViewportSize({ width: 390, height: 844 });
  await hook(pg);
  await h.newLocalGame(pg, 'bones');
  const id = await pg.evaluate(() => window.__lastMatchId);
  let e = await h.engine(pg, id);
  let who = e.acts[0];
  await pg.waitForSelector(`.gb-tray[data-who="${who}"].is-picking`, { timeout: 15000 });
  // a tap on the band while nothing is animating does nothing at all
  await pg.tap('.gb-band');
  await h.wait(100);
  ok(!(await logOf(pg)).includes('skip') && (await movesOf(h, pg, id)) === 0, 'bones: tapping the band while it is your turn does nothing');
  await pg.tap(`.gb-tray[data-who="${who}"] .gb-col[data-col="0"]`);
  await waitMoves(pg, id, 1);
  await h.wait(120);
  const t0 = Date.now();
  await pg.tap('.gb-band');
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 6000 });
  const dt = Date.now() - t0;
  const log = await logOf(pg);
  ok(log.includes('skip') && dt < 1000, `bones: a tap on the band fast-forwards the roll and placement (back to picking in ${dt} ms)`);
  ok((await movesOf(h, pg, id)) === 1, 'bones: …and it never placed a die');
  e = await h.engine(pg, id);
  who = e.acts[0];
  ok(await pg.$eval(`.gb-tray[data-who="${who}"]`, (t) => t.classList.contains('is-picking')) && (await pg.$eval('.gb-band', (b) => b.dataset.roll)) === String(e.state.roll), 'bones: …the die shows the right roll and the next player can pick');
  // outside the trays, e.g. on the page margin
  await pg.tap(`.gb-tray[data-who="${who}"] .gb-col[data-col="1"]`);
  await waitMoves(pg, id, 2);
  await h.wait(120);
  await pg.mouse.click(4, 400); // far left margin of the stage
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 6000 });
  ok((await movesOf(h, pg, id)) === 2, 'bones: a tap on the margin skips too, with no extra move');
  await h.closeGame(pg);
}

// ── the end card waits for the final smash ────────────────────────────
async function finaleTiming(h, pg) {
  await pg.setViewportSize({ width: 390, height: 844 });
  await hook(pg);
  await pg.evaluate(() => {
    window.__snap = null;
    new MutationObserver(() => {
      const e = document.querySelector('#game-root .gm-end');
      if (e && !e.hidden && !window.__snap) {
        window.__snap = {
          t: performance.now(), log: window.__bonesTest.log.slice(), at: window.__bonesTest.at.slice(),
          busy: document.querySelectorAll('.g-bones .gb-die.crack, .g-bones .gb-die.pop, .g-bones .gb-shard, .g-bones .gb-die.is-new, .g-bones .gb-die.shift').length,
        };
      }
    }).observe(document.getElementById('game-root'), { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  });
  const sim = await newLocalSim(h, pg, (first, seed) => {
    const x = playGame(B, seed, first, pickSmash);
    return x.s.last.destroyed >= 1 && x.moves.length >= 12 && x.moves.length <= 24;
  });
  const id = sim.id;
  const g = playGame(B, sim.seed, sim.first, pickSmash);
  let n = 0;
  for (;;) {
    const e = await h.engine(pg, id);
    if (e.over) break;
    const who = e.acts[0];
    await pg.waitForSelector(`.gb-tray[data-who="${who}"].is-picking`, { timeout: 15000 });
    await pg.tap(`.gb-tray[data-who="${who}"] .gb-col[data-col="${g.moves[n].mv.col}"]`);
    n++;
    await waitMoves(pg, id, n);
  }
  await endCard(pg, 12000);
  const snap = await pg.evaluate(() => window.__snap);
  const iFin = snap.log.indexOf('finale');
  const lastPlace = snap.log.lastIndexOf('place');
  ok(iFin > lastPlace && lastPlace >= 0, 'bones: the finale runs after the last placement');
  ok(snap.busy === 0, 'bones: the end card appears after the final smash has finished (no die still cracking, popping or dropping)');
  const crack = snap.log.lastIndexOf('crack');
  ok(crack > snap.log.lastIndexOf('roll:' + g.s.last.value) - 1 && crack >= 0, 'bones: the final move was a smash (cracked and popped before the card)');
  const msAfter = snap.t - snap.at[iFin];
  ok(msAfter >= 1500 && msAfter < 6500, `bones: the end card follows the finale banner by ${Math.round(msAfter)} ms (long enough to read the recap, well inside core’s 8 s net)`);
  await h.closeGame(pg);
}

// ── helpers for whole-game flows ──────────────────────────────────────
/** Which special things happen in a simulated game, and at which move. */
function flagsOf(seed, first, setup) {
  const at = { triple: -1, wipe: -1, comeback: -1 };
  let i = setup ? 0 : -1;
  const g = playGame(B, seed, first, pickSmash, setup, (s) => {
    i++;
    const L = s.last;
    if (L.triple && !L.wipe && at.triple < 0) at.triple = i;
    if (L.wipe && at.wipe < 0) at.wipe = i;
    if (L.comeback && at.comeback < 0) at.comeback = i;
  });
  return { g, at };
}
/** Play the first `upTo` moves of a simulated game on a same-phone match (setup moves by tapping the chip). */
async function playSim(h, pg, id, moves, upTo = moves.length) {
  for (let i = 0; i < upTo; i++) {
    const m = moves[i];
    await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 20000 });
    if (m.mv.tw) await pg.tap(`.gb-pk[data-tw="${m.mv.tw}"]`);
    else await pg.tap(`.gb-tray[data-who="${m.who}"].is-picking .gb-col[data-col="${m.mv.col}"]`);
    await waitMoves(pg, id, i + 1);
  }
}
const dataOf = (pg) => pg.evaluate(() => { try { return (JSON.parse(localStorage.getItem('ju.games.data.v1')) || {}).bones || {}; } catch { return {}; } });

// ── celebrations: triple stack, three-dice wipe, comeback ─────────────
async function celebrations(h, pg) {
  await pg.setViewportSize({ width: 390, height: 844 });
  for (const kind of ['triple', 'wipe', 'comeback']) {
    await hook(pg);
    const sim = await newLocalSim(h, pg, (first, seed) => flagsOf(seed, first, null).at[kind] >= 0, kind === 'wipe' ? 50 : kind === 'comeback' ? 400 : 1);
    const { g, at } = flagsOf(sim.seed, sim.first, null);
    const idx = at[kind];
    const id = sim.id;
    await playSim(h, pg, id, g.moves, idx + 1);
    const want = { triple: /^Triple \d+s · \d+$/, wipe: /^Wiped out$/, comeback: /^Comeback!$/ }[kind];
    await pg.waitForFunction((k) => window.__bonesTest.log.includes(k), kind, { timeout: 8000 });
    const stamp = (await logOf(pg)).filter((x) => x.startsWith('stamp:')).reverse().find((x) => want.test(x.slice(6)));
    ok(!!stamp, `bones celebration: a ${kind} stamps "${(stamp || '').slice(6)}"`);
    const shown = await pg.$eval(kind === 'comeback' ? '.gb-stamp.sm' : '.gb-stamp:not(.sm)', (e) => { const r = e.getBoundingClientRect(); return { cls: e.className, text: e.textContent, op: Number(getComputedStyle(e).opacity), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.width > 40 }; });
    ok(shown.cls.includes('show') && shown.text === stamp.slice(6) && shown.inside, `bones celebration: …the stamp is on the board (${kind}, opacity ${shown.op})`);
    await shot(pg, `bones-light-390-${kind}.png`);
    await pg.waitForTimeout(120);
    const vis = await pg.$eval(kind === 'comeback' ? '.gb-stamp.sm' : '.gb-stamp:not(.sm)', (e) => ({ op: Number(getComputedStyle(e).opacity), an: getComputedStyle(e).animationName, dur: getComputedStyle(e).animationDuration, cls: e.className }));
    ok(vis.op > 0.3, `bones celebration: …and it is visible (${kind}: ${JSON.stringify(vis)})`);
    ok((await logOf(pg)).includes('sfx:win') || kind === 'comeback', `bones celebration: …with its sound`);
    if (kind !== 'comeback') {
      // the stamp sits over the band: its text steps aside while the stamp shows, and comes back after
      const during = await pg.evaluate(() => ({ cls: document.querySelector('.gb-band').classList.contains('is-stamped'), ops: [...document.querySelectorAll('.gb-lab')].map((e) => Number(getComputedStyle(e).opacity)) }));
      ok(during.cls && during.ops.every((o) => o < 0.1), `bones celebration: …and the band text steps aside while the ${kind} stamp covers it (${during.ops.join('/')})`);
      await pg.waitForFunction(() => !document.querySelector('.gb-band').classList.contains('is-stamped'), null, { timeout: 4000 });
      await pg.waitForTimeout(250);
      ok((await pg.$$eval('.gb-lab', (x) => x.map((e) => Number(getComputedStyle(e).opacity)))).every((o) => o === 1), 'bones celebration: …and it is back once the stamp is gone');
    }
    await h.closeGame(pg);
  }
}

// ── Last Word ─────────────────────────────────────────────────────────
async function lastWord(h, pg, w = 390, hh = 844) {
  await pg.setViewportSize({ width: w, height: hh });
  await hook(pg);
  const sim = await newLocalSim(h, pg, (first, seed) => { const x = flagsOf(seed, first, { tw: 'golden' }).g.s; return x.final === true && x.n >= 14 && x.n <= 26; }, 77);
  const { g } = flagsOf(sim.seed, sim.first, { tw: 'golden' });
  const found = { first: sim.first };
  // the move that filled the starter's grid is the last-but-one
  const n = g.moves.length;
  const id = sim.id;
  await playSim(h, pg, id, g.moves, n - 1);
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 20000 });
  const mid = await h.engine(pg, id);
  ok(mid.state.final === true && !mid.over && mid.state.grids[found.first].every((c) => c.length === 3), 'bones last word: the starter filled their grid and the game is still on');
  ok(/last word/i.test(await pg.textContent('.gb-lab-l')), 'bones last word: the band says “Last word”');
  ok(/no smash/i.test(await pg.textContent('.gb-lab-r')), 'bones last word: …and explains it (“Last die, no smash”), so a soft die doesn’t look broken');
  await bandFit(pg, `${w}×${hh} Last Word`);
  ok((await logOf(pg)).includes('toast:Golden Column: One column scores double.') && !(await logOf(pg)).some((x) => /picked/.test(x) && x.startsWith('toast:')), 'bones twist: on one phone the toast is just the rule (nobody is told what they picked themselves)');
  ok(!(await pg.$('.gb-die.threat')), 'bones last word: and no threat outlines (the last die lands softly)');
  ok((await pg.$$eval('.gb-tray.is-picking .gb-pv.dn', (x) => x.length)) === 0, 'bones last word: …and no −M preview chips');
  if (w === 390 && hh === 844) await shot(pg, 'bones-light-390-lastword.png');
  await pg.tap(`.gb-tray[data-who="${g.moves[n - 1].who}"].is-picking .gb-col[data-col="${g.moves[n - 1].mv.col}"]`); // the last word
  await endCard(pg, 12000);
  const e = await h.engine(pg, id);
  ok(e.over && e.state.n % 2 === 0 && e.state.tw === 'golden', `bones last word: both players placed ${e.state.n / 2} dice each, then it ended`);
  await h.closeGame(pg);
}

// ── records, streak, form, NEW BEST over several games ────────────────
async function recordsFlow(h, pg) {
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.evaluate(() => { try { localStorage.removeItem('ju.games.data.v1'); } catch { /* */ } });
  // three games Emerson (a) wins with a rising score, then one Sydney wins
  const states = [];
  let minA = 0;
  for (let i = 0; i < 4; i++) {
    const wantFn = i < 3
      ? (first, seed) => { const g = flagsOf(seed, first, null).g.s; return B.result(g).winner === 'a' && B.score(g).a > minA && g.n <= 26; }
      : (first, seed) => { const g = flagsOf(seed, first, null).g.s; return B.result(g).winner === 'b' && g.n <= 26; };
    await hook(pg);
    const sim = await newLocalSim(h, pg, wantFn, 1 + i * 500);
    const p = { g: flagsOf(sim.seed, sim.first, null).g };
    if (i < 3) minA = B.score(p.g.s).a;
    const id = sim.id;
    await playSim(h, pg, id, p.g.moves);
    await endCard(pg, 12000);
    const log = await logOf(pg);
    const band = await pg.textContent('.gb-band');
    const rec = await dataOf(pg);
    states.push({ log, band, rec, id });
    if (i === 0) ok(rec.games_n === 1 && rec.last_id === id && rec.form === 'a' && !log.some((x) => x.startsWith('stamp:New best')), `bones records: game 1 recorded, no NEW BEST stamp on the baseline (${JSON.stringify(rec).slice(0, 200)} id ${id} ${log.filter((x) => /stamp|records|finale/.test(x)).join(' ')})`);
    if (i === 1) {
      ok(rec.games_n === 2 && rec.streak_len === 2 && rec.form === 'aa', 'bones records: game 2: streak 2, form “aa”');
      ok(/Emerson has won 2 straight/.test(band), `bones records: the band says “Emerson has won 2 straight”`);
      ok(log.some((x) => /^stamp:New best: \d+/.test(x)), `bones records: a higher score stamps NEW BEST (${log.find((x) => x.startsWith('stamp:'))})`);
      ok((await pg.$$eval('.gb-fd', (x) => x.length)) === 2 && (await pg.$$eval('.gb-fd.a', (x) => x.length)) === 2, 'bones records: the form strip shows two blue dots');
      await shot(pg, 'bones-light-390-recap.png');
    }
    if (i === 2) ok(rec.streak_len === 3 && rec.streak_len_best === 3 && /has won 3 straight/.test(band) && rec.best_a_best === B.score(p.g.s).a, 'bones records: game 3: three straight, new best score kept');
    if (i === 3) ok(rec.streak_who === 'b' && rec.streak_len === 1 && rec.streak_len_best === 3 && rec.form === 'aaab' && rec.games_n === 4, 'bones records: Sydney’s win resets the streak but keeps the best (form “aaab”)');
    await h.closeGame(pg);
  }
  const rec = await dataOf(pg);
  ok(rec.games_n === 4, 'bones records: four games counted');
  const keys = Object.keys(rec);
  ok(keys.every((k) => /^[a-zA-Z0-9_.-]{1,60}$/.test(k)), `bones records: ${keys.length} flat keys saved (${keys.slice(0, 6).join(', ')}…)`);
}

// ── records on two phones: written once, and never again when a finished match is reopened ──
async function onlineRecords(h) {
  const P = { a: h.a, b: h.b };
  for (const p of [h.a, h.b]) { await p.setViewportSize({ width: 390, height: 844 }); await hook(p); }
  const id = await h.newOnlineGame(h.a, 'bones');
  await h.openMatch(h.b, id);
  const e0 = await h.engine(h.a, id);
  const sim = playGame(B, e0.state.seed, e0.first, pickSmash, { tw: 'oracle' });
  for (let i = 0; i < sim.moves.length; i++) {
    const m = sim.moves[i];
    const pg = P[m.who];
    await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 20000 });
    if (m.mv.tw) await pg.tap(`.gb-pk[data-tw="${m.mv.tw}"]`);
    else await pg.tap(`.gb-tray[data-who="${m.who}"] .gb-col[data-col="${m.mv.col}"]`);
    await waitMoves(h.a, id, i + 1); await waitMoves(h.b, id, i + 1);
  }
  await endCard(h.a, 15000); await endCard(h.b, 15000);
  await h.settle();
  const da = await dataOf(h.a); const db = await dataOf(h.b);
  const doc = h.docs['gamedata/bones'] || {};
  ok(da.games_n === 1 && db.games_n === 1 && doc.games_n === 1 && da.last_id === id && db.last_id === id && doc.last_id === id, 'bones records online: both phones recorded the match exactly once (shared doc, last_id)');
  ok(da.form === db.form && da.streak_len === db.streak_len && da.streak_who === db.streak_who && da.tw_oracle_n === 1 && db.tw_oracle_n === 1, 'bones records online: and they agree on the streak, form and twist counts');
  const bands = [await h.a.textContent('.gb-band'), await h.b.textContent('.gb-band')];
  ok(bands.every((t) => /Final/.test(t) && /by\s*\d+|apiece/.test(t)), 'bones records online: both phones show the final banner');
  // the partner reopens the finished match: the finale replays, nothing is recorded
  await h.closeGame(h.b);
  // (the hub only lists a finished match until its end card has been seen: make it look unseen, as if Sydney had been away)
  await h.b.evaluate(() => localStorage.setItem('ju.games.seenEnd.v1', '{}'));
  await h.b.reload();
  await h.b.waitForSelector('.tabbar', { timeout: 15000 });
  await h.wait(500);
  await hook(h.b);
  await h.openMatch(h.b, id);
  await h.b.waitForFunction(() => window.__bonesTest.log.includes('finale'), null, { timeout: 12000 });
  const lb = await logOf(h.b);
  ok(!lb.some((x) => x.startsWith('records:')), 'bones records online: a finished match opened again is never recorded twice');
  await h.settle();
  ok((await dataOf(h.b)).games_n === 1 && (h.docs['gamedata/bones'] || {}).games_n === 1, 'bones records online: …games_n is still 1');
  await h.closeGame(h.a); await h.closeGame(h.b);
}

// ── online: picker, partner view, twists on both phones ───────────────
async function onlineTwists(h) {
  const P = { a: h.a, b: h.b };
  const nm = (w) => (w === 'a' ? 'Emerson' : 'Sydney');
  for (const p of [h.a, h.b]) {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => { window.__bonesTest = { log: [] }; try { localStorage.removeItem('ju.bones.twist'); } catch { /* */ } });
  }
  let seq = 1;
  // a fresh match; the starter alternates between rematches, so work out who it is
  const start = async () => {
    const f = findR(() => true, seq); seq = Math.round(f.r / 0.0377) + 1;
    const id = await withRandom(h.a, f.r, () => h.newOnlineGame(h.a, 'bones'));
    await h.openMatch(h.b, id);
    const sw = (await h.engine(h.a, id)).first;
    const S = P[sw]; const O = P[other(sw)];
    await S.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
    await O.waitForSelector('.g-bones[data-phase="wait"]', { timeout: 15000 });
    for (const p of [h.a, h.b]) await p.evaluate(() => { window.__bonesTest.log = []; });
    return { id, sw, S, O };
  };
  const stateOf = async (id) => (await h.engine(h.a, id)).state;
  const both = async (id, n) => { await waitMoves(h.a, id, n); await waitMoves(h.b, id, n); };
  const expPreview = (s, who) => {
    const colPts = B._test.colPts;
    const gain = [0, 1, 2].map((c) => (s.grids[who][c].length < 3 ? colPts(s.grids[who][c].concat(s.roll), c, s.gold) - colPts(s.grids[who][c], c, s.gold) : 0));
    const op = other(who);
    const soft = s.final && s.tw !== 'mirror';
    const loss = [0, 1, 2].map((c) => (s.grids[who][c].length < 3 && !soft ? colPts(s.grids[op][c], c, s.gold) - colPts(s.grids[op][c].filter((v) => v !== s.roll), c, s.gold) : 0));
    return { gain, loss };
  };
  const previewsOn = (pg, who) => pg.evaluate((w) => {
    const read = (tray) => [...tray.closest('.gb-half').querySelectorAll('.gb-scores .gb-cs')].map((c) => (c.querySelector('.gb-pv') || {}).textContent || '');
    return { gain: read(document.querySelector(`.gb-tray[data-who="${w}"]`)), loss: read(document.querySelector(`.gb-tray[data-who="${w === 'a' ? 'b' : 'a'}"]`)) };
  }, who);

  // 1. golden: the picker, the partner's view, the badge, the gilded column, previews
  let { id, sw, S, O } = await start();
  let s = await stateOf(id);
  ok(s.first === sw && s.n === 0 && s.tw === undefined, `bones twist: a fresh match, ${nm(sw)} starts`);
  const pk = await S.$$eval('.gb-picker:not([hidden]) .gb-pk', (x) => x.map((e) => ({ h: e.getBoundingClientRect().height, t: e.textContent })));
  ok(pk.length === 4 && pk.every((x) => x.h >= 44), `bones twist: the starter sees four twist chips, each ≥ 44 px tall (${pk.map((x) => Math.round(x.h)).join(', ')})`);
  ok(pk.every((x) => /\./.test(x.t) && x.t.length > 18), 'bones twist: …each with a label and a one-line hint');
  ok((await S.$eval('.gb-picker:not([hidden])', (e) => e.closest('.gb-half').dataset.who)) === other(sw), 'bones twist: the picker covers the opponent’s empty half, not the starter’s own tray');
  ok((await O.$$eval('.gb-picker:not([hidden])', (x) => x.length)) === 0, 'bones twist: the partner sees no picker');
  ok(/Picking a twist/i.test(await O.textContent('.gb-band')) && new RegExp(nm(sw)).test(await O.textContent('.gb-band')), `bones twist: …and is told “${nm(sw)}” is “Picking a twist…” (one short line, so it fits the band)`);
  const pkFit = await S.$$eval('.gb-picker:not([hidden]) .gb-pk', (x) => x.map((e) => ({ fs: parseFloat(getComputedStyle(e.querySelector('span')).fontSize), over: e.scrollHeight > e.clientHeight + 1, out: e.getBoundingClientRect().bottom > innerHeight })));
  ok(pkFit.every((x) => x.fs >= 11.19 && !x.over && !x.out), `bones twist: the chip hints are at least 0.7rem (${pkFit[0].fs}px) and nothing spills out of a chip`);
  ok((await S.$$eval('.gb-pk.is-last', (x) => x.length)) === 0, 'bones twist: nothing is preselected on a first match');
  await shot(S, 'bones-light-390-picker.png');
  await S.tap('.gb-pk[data-tw="golden"]');
  await both(id, 1);
  s = await stateOf(id);
  ok(s.tw === 'golden' && s.n === 0 && s.turn === sw && s.gold >= 0 && s.gold <= 2, 'bones twist: tapping a chip sent the setup move and kept the turn');
  for (const w of ['a', 'b']) {
    await P[w].waitForSelector('.gb-badge:not([hidden])', { timeout: 6000 });
    ok(/Golden Column/.test(await P[w].textContent('.gb-badge')), `bones twist: ${nm(w)}’s phone shows the Golden Column badge`);
  }
  await O.waitForFunction(() => window.__bonesTest.log.includes('picked:golden'), null, { timeout: 5000 });
  ok((await O.evaluate(() => window.__bonesTest.log)).includes(`toast:${nm(sw)} picked Golden Column. One column scores double.`) && !(await S.evaluate(() => window.__bonesTest.log)).some((x) => x.startsWith('toast:')), `bones twist: the partner is told “${nm(sw)} picked Golden Column. One column scores double.” so they know the rule (the picker isn’t told anything)`);
  ok((await S.$$eval('.gb-picker:not([hidden])', (x) => x.length)) === 0, 'bones twist: the picker is gone once a twist is chosen');
  for (const w of ['a', 'b']) {
    const gold = await P[w].$$eval('.gb-col.gold', (x) => x.map((e) => e.dataset.col));
    ok(gold.length === 2 && gold.every((c) => Number(c) === s.gold), `bones golden: ${nm(w)} sees column ${s.gold + 1} gilded in both trays`);
    ok((await P[w].$$eval('.gb-cs.gold .gb-x2', (x) => x.length)) === 2, 'bones golden: …with ×2 on its totals');
  }
  await S.waitForSelector('.g-bones[data-phase="pick"]');
  // play dice, checking the +N / −M previews on every pick
  let seen = 0;
  for (let t = 0; t < 9 && !(t >= 4 && seen >= 1); t++) {
    const e = await h.engine(h.a, id);
    const who = e.acts[0];
    await P[who].waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
    await P[who].waitForSelector(`.gb-band[data-roll="${e.state.roll}"]`, { timeout: 8000 });
    const pv = await previewsOn(P[who], who);
    const ex = expPreview(e.state, who);
    const fmtG = ex.gain.map((x) => (x ? `+${x}` : ''));
    const fmtL = ex.loss.map((x) => (x ? `−${x}` : ''));
    ok(JSON.stringify(pv.gain) === JSON.stringify(fmtG) && JSON.stringify(pv.loss) === JSON.stringify(fmtL), `bones previews: turn ${t + 1} shows ${fmtG.join('/')} for you and ${fmtL.map((x) => x || '0').join('/')} for them`);
    if (ex.loss.some((x) => x)) seen++;
    await P[who].tap(`.gb-tray[data-who="${who}"] .gb-col[data-col="${pickSmash(e.state, who)}"]`);
    await both(id, 2 + t);
  }
  ok(seen >= 1, `bones previews: −M chips matched the real smash on ${seen} picks, and +N on every pick`);
  await shot(S, 'bones-light-390-golden.png');
  await h.closeGame(h.a); await h.closeGame(h.b);

  // 2. the last twist is preselected next time (for the same player); a plain die skips the picker for good
  ({ id, sw, S, O } = await start());
  const had = await S.$$eval('.gb-pk.is-last', (x) => x.map((e) => e.dataset.tw));
  const first1 = sw;
  ok(had.length === 0 || had[0] === 'golden', 'bones twist: the chip you picked last time is marked (only on your own phone), never auto-sent');
  if (had.length) {
    const lastChip = await S.$eval('.gb-pk.is-last', (e) => ({ tag: getComputedStyle(e, '::after').content, bg: getComputedStyle(e).backgroundColor, other: getComputedStyle(e.parentElement.querySelector('.gb-pk:not(.is-last)')).backgroundColor }));
    ok(/Last time/.test(lastChip.tag) && lastChip.bg === lastChip.other, 'bones twist: …with a “Last time” tag, not a solid plate that looks selected');
  }
  s = await stateOf(id);
  ok(s.n === 0 && s.tw === undefined, 'bones twist: …nothing was sent');
  await S.tap(`.gb-tray[data-who="${sw}"] .gb-col[data-col="1"]`);
  await both(id, 1);
  s = await stateOf(id);
  ok(s.n === 1 && s.tw === undefined && (await S.$$eval('.gb-badge:not([hidden])', (x) => x.length)) === 0, 'bones twist: just placing a die keeps the match classic (no badge)');
  await O.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
  ok((await O.$$eval('.gb-picker:not([hidden])', (x) => x.length)) === 0 && (await S.$$eval('.gb-picker:not([hidden])', (x) => x.length)) === 0, 'bones twist: …and nobody sees a picker any more');
  await h.closeGame(h.a); await h.closeGame(h.b);

  // 3. blind: nobody sees the die until it lands
  ({ id, sw, S, O } = await start());
  const preselected = await S.$$eval('.gb-pk.is-last', (x) => x.map((e) => e.dataset.tw));
  ok(preselected.length <= 1, `bones twist: at most one chip is highlighted (${preselected.join() || 'none'})`);
  await S.tap('.gb-pk[data-tw="blind"]');
  await both(id, 1);
  s = await stateOf(id);
  ok(s.tw === 'blind', 'bones blind: Blind Draw picked');
  await S.waitForSelector('.g-bones[data-phase="pick"]');
  for (const w of ['a', 'b']) {
    await P[w].waitForSelector('.gb-q:not([hidden])', { timeout: 6000 });
    ok((await P[w].$eval('.gb-band', (e) => e.dataset.roll)) === '' && !/Rolled \d/.test(await P[w].textContent('.gb-band')), `bones blind: ${nm(w)}’s phone shows a mystery die, not the roll`);
  }
  ok((await S.$$eval('.gb-tray.is-picking .gb-die.ghost .gb-qm', (x) => x.length)) === 3 && (await S.$$eval('.gb-pv', (x) => x.length)) === 0, 'bones blind: the ghost dice are “?” and there are no previews');
  await shot(S, 'bones-light-390-blind.png');
  const e0 = await h.engine(h.a, id);
  await S.tap(`.gb-tray[data-who="${sw}"] .gb-col[data-col="0"]`);
  await both(id, 2);
  const e1 = await h.engine(h.a, id);
  for (const w of ['a', 'b']) await P[w].waitForFunction((v) => window.__bonesTest.log.includes(`roll:${v}`), e1.state.last.value, { timeout: 8000 });
  ok(e1.state.last.value === e0.state.roll && e0.state.roll !== undefined, `bones blind: the die was revealed as it landed (${e1.state.last.value}) on both phones`);
  await O.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
  ok((await O.$$eval('.gb-q:not([hidden])', (x) => x.length)) === 1, 'bones blind: …and the next player picks blind again');
  await h.closeGame(h.a); await h.closeGame(h.b);

  // 4. oracle: the next two rolls
  ({ id, sw, S, O } = await start());
  await S.tap('.gb-pk[data-tw="oracle"]');
  await both(id, 1);
  await S.waitForSelector('.g-bones[data-phase="pick"]');
  s = await stateOf(id);
  for (const w of ['a', 'b']) {
    await P[w].waitForSelector('.gb-nx .gb-die', { timeout: 6000 });
    const dice = await P[w].$$eval('.gb-nx .gb-die', (x) => x.map((e) => Number(e.dataset.v)));
    ok(dice.length === 2 && dice[0] === B._test.rollAt(s, s.n + 1) && dice[1] === B._test.rollAt(s, s.n + 2), `bones oracle: ${nm(w)} sees the next two rolls (${dice.join(', ')})`);
  }
  await S.tap(`.gb-tray[data-who="${sw}"] .gb-col[data-col="2"]`);
  await both(id, 2);
  await O.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
  const s2 = await stateOf(id);
  const dice2 = await O.$$eval('.gb-nx .gb-die', (x) => x.map((e) => Number(e.dataset.v)));
  ok(dice2[0] === B._test.rollAt(s2, s2.n + 1) && dice2[1] === B._test.rollAt(s2, s2.n + 2), 'bones oracle: the queue moves on after each die');
  await h.closeGame(h.a); await h.closeGame(h.b);

  // 5. mirror: just the badge and the dice rule (rules are tested in Node)
  ({ id, sw, S, O } = await start());
  await S.tap('.gb-pk[data-tw="mirror"]');
  await both(id, 1);
  await O.waitForSelector('.gb-badge:not([hidden])');
  ok(/Mirror Dice/.test(await O.textContent('.gb-badge')), `bones mirror: ${nm(other(sw))}’s phone shows the Mirror Dice badge`);
  // the starter's chip for this twist is remembered on their own phone
  await h.closeGame(h.a); await h.closeGame(h.b);
  void first1;
}
function bonesPickFor(s, who) { return pickSmash(s, who); }

// ── screenshots: picker, a twist mid-game and the recap, in the sizes the director checks ──
async function tour(h, pg, w, hh, tag) {
  await pg.setViewportSize({ width: w, height: hh });
  await hook(pg);
  const sim = await newLocalSim(h, pg, (first, seed) => { const g = flagsOf(seed, first, { tw: 'golden' }).g; return g.s.n >= 14 && g.s.n <= 22; }, 11);
  const { g } = flagsOf(sim.seed, sim.first, { tw: 'golden' });
  const id = sim.id;
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
  await h.wait(300);
  await shot(pg, `bones-${tag}-picker.png`);
  await playSim(h, pg, id, g.moves, 7);
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
  await h.wait(400);
  await shot(pg, `bones-${tag}-golden.png`);
  for (let i = 7; i < g.moves.length; i++) {
    await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 20000 });
    const m = g.moves[i];
    await pg.tap(`.gb-tray[data-who="${m.who}"].is-picking .gb-col[data-col="${m.mv.col}"]`);
    await waitMoves(pg, id, i + 1);
  }
  await endCard(pg, 15000);
  await h.wait(500);
  await shot(pg, `bones-${tag}-end.png`);
  await pg.click('#game-root [data-g="end-look"]');
  await h.wait(400);
  await shot(pg, `bones-${tag}-board.png`);
  await h.closeGame(pg);
  ok(true, `bones: screenshots for ${tag}`);
}

// ── the band's text fits in every state, on every screen ──────────────
// Online, so the partner's "waiting" copy is on screen too: the partner waiting for the twist, an Oracle queue, a Blind pick.
async function bandStates(h) {
  const P = { a: h.a, b: h.b };
  for (const p of [h.a, h.b]) await hook(p);
  let seq = 1;
  const both = async (id, n) => { await waitMoves(h.a, id, n); await waitMoves(h.b, id, n); };
  for (const [w, hh] of VIEWPORTS) {
    const tag = `${w}×${hh}`;
    for (const p of [h.a, h.b]) await p.setViewportSize({ width: w, height: hh });
    for (const tw of ['oracle', 'blind']) {
      const f = findR(() => true, seq); seq = Math.round(f.r / 0.0377) + 1;
      const id = await withRandom(h.a, f.r, () => h.newOnlineGame(h.a, 'bones'));
      await h.openMatch(h.b, id);
      const sw = (await h.engine(h.a, id)).first;
      const S = P[sw]; const O = P[other(sw)];
      await S.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
      await O.waitForSelector('.g-bones[data-phase="wait"]', { timeout: 15000 });
      await h.wait(350);
      if (tw === 'oracle') {
        await bandFit(O, `${tag} partner waiting on the twist`);
        await bandFit(S, `${tag} starter, picker open`);
        const chips = await S.$$eval('.gb-picker:not([hidden]) .gb-pk', (x) => { const pr = document.querySelector('.gb-picker:not([hidden])').getBoundingClientRect(); return x.map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, over: e.scrollHeight > e.clientHeight + 1 || [...e.children].some((c) => c.getBoundingClientRect().bottom > r.bottom + 0.5 || c.getBoundingClientRect().top < r.top - 0.5), outside: r.bottom > pr.bottom + 0.5 || r.right > pr.right + 0.5 || r.bottom > innerHeight }; }); });
        ok(chips.length === 4 && chips.every((c) => c.h >= 44 && !c.over && !c.outside), `bones picker ${tag}: four chips, each ≥ 44 px, with their text inside (${chips.map((c) => Math.round(c.h)).join(', ')})`);
        if ((w === 390 && hh === 664) || (w === 320 && hh === 568)) { await shot(O, `bones-wait-twist-${w}x${hh}.png`); await shot(S, `bones-picker-${w}x${hh}.png`); }
      }
      await S.tap(`.gb-pk[data-tw="${tw}"]`);
      await both(id, 1);
      await S.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
      await O.waitForSelector('.g-bones[data-phase="wait"]', { timeout: 15000 });
      await h.wait(500);
      await bandFit(S, `${tag} ${tw}: starter picks a column`);
      await bandFit(O, `${tag} ${tw}: partner waits`);
      if (tw === 'oracle' && ((w === 390 && hh === 664) || (w === 320 && hh === 568))) await shot(O, `bones-oracle-wait-${w}x${hh}.png`);
      const e = await h.engine(h.a, id);
      await S.tap(`.gb-tray[data-who="${sw}"] .gb-col[data-col="${pickSmash(e.state, sw)}"]`);
      await both(id, 2);
      await O.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
      await S.waitForSelector('.g-bones[data-phase="wait"]', { timeout: 15000 });
      await h.wait(400);
      await bandFit(O, `${tag} ${tw}: second player picks`);
      await bandFit(S, `${tag} ${tw}: starter waits`);
      await h.closeGame(h.a); await h.closeGame(h.b);
    }
  }
}

// ── the finale: recap in the band fits, stamps stay off it, the card waits ──
async function finaleFit(h, pg) {
  for (const [w, hh] of VIEWPORTS) {
    const tag = `${w}×${hh}`;
    // a record to beat and a winning streak to extend (the data is read at load, so reload after seeding)
    const seed = { games_n: 6, best_a_best: 5, best_b_best: 500, smash_best: 5, comeback_best: 500, streak_who: 'a', streak_len: 3, streak_len_best: 3, form: 'aabaa', last_id: 'seeded' };
    h.docs['gamedata/bones'] = { ...seed }; // the shared copy too, or the first snapshot would put the earlier games back
    await pg.evaluate((d) => { try { localStorage.setItem('ju.games.data.v1', JSON.stringify({ bones: d })); } catch { /* */ } }, seed);
    await pg.reload();
    await pg.waitForSelector('.tabbar', { timeout: 15000 });
    await pg.setViewportSize({ width: w, height: hh });
    await hook(pg);
    const sim = await newLocalSim(h, pg, (first, seed) => { const x = playGame(B, seed, first, pickSmash).s; return B.result(x).winner === 'a' && x.big.pts >= 10 && x.n <= 22; }, 1 + VIEWPORTS.findIndex((v) => v[0] === w && v[1] === hh) * 300);
    const g = playGame(B, sim.seed, sim.first, pickSmash);
    await playSim(h, pg, sim.id, g.moves);
    await pg.waitForSelector('.gb-band.is-final', { timeout: 12000 });
    await bandFit(pg, `${tag} finale, just in`);
    await pg.waitForFunction(() => window.__bonesTest.log.some((x) => x.startsWith('stamp:')), null, { timeout: 8000 });
    await h.wait(300);
    const st = await pg.evaluate(() => {
      const B = document.querySelector('.gb-band').getBoundingClientRect();
      return [...document.querySelectorAll('.gb-stamp')].filter((e) => e.classList.contains('show')).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent, hit: !(r.right <= B.left || r.left >= B.right || r.bottom <= B.top || r.top >= B.bottom), op: Number(getComputedStyle(e).opacity), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
    });
    ok(st.length >= 1 && st.every((x) => !x.hit && x.inside), `bones finale ${tag}: the record stamps (${st.map((x) => x.t).join(' / ')}) sit on the trays, clear of the band text`);
    await bandFit(pg, `${tag} finale, while stamping`);
    const txt = await pg.textContent('.gb-band');
    ok(/won 4 straight/.test(txt) && /(wins|win)/.test(txt) && (await pg.$$eval('.gb-form .gb-fd', (x) => x.length)) === 5, `bones finale ${tag}: the band carries the winner, “Emerson has won 4 straight” and the form strip (${txt.replace(/\s+/g, ' ').trim().slice(0, 70)})`);
    if ((w === 390 && hh === 664) || (w === 320 && hh === 568) || (w === 844 && hh === 390)) await shot(pg, `bones-finale-${tag}.png`);
    await endCard(pg, 12000);
    await pg.click('#game-root [data-g="end-look"]');
    await h.wait(300);
    await bandFit(pg, `${tag} finale, “See the board”`);
    await h.closeGame(pg);
  }
}

// ── the match is recorded even if the last mover leaves at once ───────
async function leaveAtTheEnd(h, pg) {
  await pg.setViewportSize({ width: 390, height: 844 });
  await hook(pg);
  const before = (await dataOf(pg)).games_n || 0;
  const sim = await newLocalSim(h, pg, (first, seed) => { const x = playGame(B, seed, first, pickSmash).s; return x.n >= 12 && x.n <= 22; }, 900);
  const g = playGame(B, sim.seed, sim.first, pickSmash);
  await playSim(h, pg, sim.id, g.moves, g.moves.length - 1);
  const m = g.moves[g.moves.length - 1];
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 20000 });
  await pg.tap(`.gb-tray[data-who="${m.who}"].is-picking .gb-col[data-col="${m.mv.col}"]`);
  await pg.click('#game-root [data-g="close"]'); // the winning move, then straight back: no finale
  const rec = await dataOf(pg);
  // (games_n only goes up, so it can't be put back by a late sync of the previous game; last_id can)
  ok(rec.games_n === before + 1 && (await logOf(pg)).some((x) => x.startsWith('records:')), `bones records: leaving right after the last move still records the match (games ${before} → ${rec.games_n})`);
}

// ── a lost WebGL context that never comes back must not freeze the game ──
async function lostContext(h, pg) {
  await pg.setViewportSize({ width: 390, height: 844 });
  await hook(pg);
  await h.newLocalGame(pg, 'bones');
  const id = await pg.evaluate(() => window.__lastMatchId);
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 15000 });
  await pg.evaluate(() => { const c = document.querySelector('.gb-band canvas'); window.__lose = (c.getContext('webgl2') || c.getContext('webgl')).getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
  await pg.waitForSelector('.gb-band[data-gl="lost"]', { timeout: 4000 });
  let e = await h.engine(pg, id);
  await pg.tap(`.gb-tray[data-who="${e.acts[0]}"] .gb-col[data-col="0"]`); // the next die has nothing to tumble on
  await waitMoves(pg, id, 1);
  const t0 = Date.now();
  await pg.waitForSelector('.gb-band[data-gl="2d"]', { timeout: 7000 });
  ok(Date.now() - t0 > 1000, `bones context lost: waits for the browser to restore it (${Date.now() - t0} ms of grace) before giving up on 3D`);
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 8000 });
  e = await h.engine(pg, id);
  const die = await pg.$eval('.gb-die2d .gb-die', (d) => Number(d.dataset.v)).catch(() => 0);
  ok(die === e.state.roll && (await pg.isVisible('.gb-die2d')) && !(await pg.isVisible('.gb-band canvas')), `bones context lost: play continues with flat dice, showing the current roll (${die})`);
  for (let k = 2; k <= 4; k++) {
    e = await h.engine(pg, id);
    await pg.tap(`.gb-tray[data-who="${e.acts[0]}"] .gb-col[data-col="${k % 3}"]`);
    await waitMoves(pg, id, k);
    await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 8000 });
  }
  e = await h.engine(pg, id);
  ok((await pg.$eval('.gb-die2d .gb-die', (d) => Number(d.dataset.v))) === e.state.roll, 'bones context lost: …and each new die still shows on the flat view');
  await shot(pg, 'bones-gl-lost-flat.png');
  await pg.evaluate(() => window.__lose.restoreContext());
  await pg.waitForFunction(() => window.__bonesTest.log.includes('restored'), null, { timeout: 5000 });
  ok((await pg.getAttribute('.gb-band', 'data-gl')) === 'ok' && (await pg.isVisible('.gb-band canvas')) && !(await pg.isVisible('.gb-die2d')), 'bones context lost: when the context comes back the 3D view is back too');
  const f0 = await pg.evaluate(() => window.__bonesTest.frames || 0);
  e = await h.engine(pg, id);
  await pg.tap(`.gb-tray[data-who="${e.acts[0]}"] .gb-col[data-col="0"]`);
  await waitMoves(pg, id, 5);
  await pg.waitForSelector('.g-bones[data-phase="pick"]', { timeout: 8000 });
  ok((await pg.evaluate(() => window.__bonesTest.frames || 0)) > f0 + 10, 'bones context lost: …and the next die tumbles in 3D again');
  await h.closeGame(pg);
}

// ── main ──────────────────────────────────────────────────────────────
// Bot self-play: how often does whoever goes first win? (Last Word on / off)
async function balance() {
  core = await import(pathToFileURL(path.join(ROOT, 'js/games/core.js')).href);
  await import(pathToFileURL(path.join(ROOT, 'js/games/bones.js')).href);
  B = core.gameById('bones');
  const N = Number(process.env.N) || 4000;
  const tot = (g, gold) => B.score({ grids: g, gold });
  const greedy = (s, who) => {
    const op = other(who);
    let best = -1e9; let bc = 0;
    for (const c of [0, 1, 2]) {
      if (s.grids[who][c].length >= 3) continue;
      const n = B.apply(clone(s), who, { col: c });
      const sc0 = B.score(s); const sc1 = B.score(n);
      const v = (sc1[who] - sc0[who]) + (sc0[op] - sc1[op]);
      if (v > best) { best = v; bc = c; }
    }
    return bc;
  };
  const rows = [];
  const run = (label, tw, lw, botName, bot) => {
    let first = 0; let second = 0; let draw = 0; let dice = 0;
    for (let i = 0; i < N; i++) {
      const st0 = i % 2 ? 'a' : 'b';
      const rnd = lcg(1 + i * 7919);
      let s = B.init({ first: st0, seed: 300000 + i, opts: {} });
      if (tw) { s = B.apply(clone(s), s.turn, { tw }); if (!lw) s.lw = false; }
      const pick = bot === 'random' ? pickRandom(rnd) : greedy;
      while (B.next(s).length) s = B.apply(clone(s), s.turn, { col: pick(s, s.turn) });
      const r = B.result(s);
      dice += s.n;
      if (r.winner === null) draw++; else if (r.winner === st0) first++; else second++;
    }
    const pc = (x) => (100 * x / N).toFixed(1) + '%';
    rows.push({ label, bot: botName, lw: tw ? (lw ? 'on' : 'off') : '-', first: pc(first), second: pc(second), draw: pc(draw), dice: (dice / N).toFixed(1) });
    console.log(`${label.padEnd(14)} ${botName.padEnd(7)} Last Word ${(tw ? (lw ? 'on ' : 'off') : ' - ')}  starter wins ${pc(first).padStart(6)}  other ${pc(second).padStart(6)}  draws ${pc(draw).padStart(5)}  dice/game ${(dice / N).toFixed(1)}`);
  };
  console.log(`first-player win rates over ${N} bot games per row (the starter alternates seats)`);
  for (const bot of ['random', 'greedy']) {
    run('classic', null, false, bot, bot);
    for (const tw of ['golden', 'mirror', 'oracle']) { run(tw, tw, false, bot, bot); run(tw, tw, true, bot, bot); }
  }
  run('blind', 'blind', false, 'random', 'random'); run('blind', 'blind', true, 'random', 'random'); // nobody can plan around a die they can't see
  if (process.env.BALANCE_JSON) fs.writeFileSync(process.env.BALANCE_JSON, JSON.stringify(rows, null, 1));
}

(async () => {
  if (process.argv.includes('--balance')) { await balance(); return; }
  try { await unit(); } catch (e) { console.error(e.message); process.exitCode = 1; return; }
  if (process.argv.includes('--unit')) { console.log('\nRULES OK'); return; }
  // ONLY=light,reduced,records,online-records,dark runs just those groups (default: all)
  const want = (g) => !process.env.ONLY || process.env.ONLY.split(',').includes(g);
  const group = async (name, opts, fn) => {
    if (!want(name)) return false;
    const h = await launch({ only: ['bones'], coarse: true, device: 'iPhone 13', ...opts });
    try {
      await fn(h);
      h.assertNoErrors();
      ok(true, `no page errors (${name} run)`);
      return false;
    } catch (e) {
      console.error(e.message);
      await shot(h.a, `FAIL-bones-${name}.png`).catch(() => {});
      console.error('errors:', h.errors);
      return true;
    } finally {
      await h.close();
    }
  };
  let failed = await group('light', { port: PORT }, async (h) => {
    await layoutTests(h, h.a, 'light');
    await fullColumn(h, h.a);
    await tapToSkip(h, h.a);
    await finaleTiming(h, h.a);
    await lostContext(h, h.a);
    await onlineTwists(h);
    await bandStates(h);
  });
  // long flows with reduced motion, so a whole game takes seconds
  if (!failed) {
    failed = await group('reduced', { port: PORT + 2, reducedMotion: 'reduce' }, async (q) => {
      await celebrations(q, q.a);
      await lastWord(q, q.a);
      await lastWord(q, q.a, 320, 568);
      await lastWord(q, q.a, 390, 664);
      await lastWord(q, q.a, 844, 390);
      await finaleFit(q, q.a);
      await tour(q, q.a, 844, 390, 'light-844x390');
      await tour(q, q.a, 390, 844, 'light-390x844');
    });
  }
  if (!failed) failed = await group('records', { port: PORT + 3, reducedMotion: 'reduce' }, async (r) => { await recordsFlow(r, r.a); await leaveAtTheEnd(r, r.a); });
  if (!failed) failed = await group('online-records', { port: PORT + 4, reducedMotion: 'reduce' }, async (r) => { await onlineRecords(r); });
  if (!failed) {
    failed = await group('dark', { port: PORT + 1, colorScheme: 'dark', reducedMotion: 'reduce' }, async (d) => {
      await layoutTests(d, d.a, 'dark');
      await tour(d, d.a, 360, 740, 'dark-360x740');
      await tour(d, d.a, 844, 390, 'dark-844x390');
    });
  }
  console.log(failed ? '\nFAILED' : `\nALL GOOD (screenshots in ${SHOTS})`);
  if (failed) process.exitCode = 1;
})();
