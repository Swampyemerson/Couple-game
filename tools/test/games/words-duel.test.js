// Word Duel v2: rules unit tests (replay equivalence with the frozen v1 rules, every v2 option,
// records), then the full UI on two simulated phones and one phone, in light and dark.
//   node tools/test/games/words-duel.test.js            (everything)
//   UNIT=1 node tools/test/games/words-duel.test.js     (rules only, no browser)
//   SHOTS=/some/dir node tools/test/games/words-duel.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'words-duel-shots');
fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => JSON.parse(JSON.stringify(x));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const throws = (fn, re, msg) => { let e = null; try { fn(); } catch (x) { e = x; } assert(e && re.test(e.message), `${msg} (${e ? e.message : 'no error'})`); };

// small deterministic PRNG for the random logs
function prng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function unitTests() {
  const R = await imp('js/games/wordduel/rules.js');
  const Rec = await imp('js/games/wordduel/records.js');
  const { makeV1 } = await imp('tools/test/games/fixtures/wordduel-v1.mjs');
  const { common, valid, love } = R.lists();
  const V1 = makeV1(valid, common);
  const NEW = { init: R.init, next: R.next, apply: R.apply, result: R.result };

  // ── replay equivalence: legacy logs (no setup move) behave exactly as before ──
  const junk = [undefined, null, 5, 'crane', {}, { secret: 12 }, { secret: 'qqqqq' }, { secret: 'cat' }, { secret: 'ab1de' }, { guess: 'zzzzz' }, { guess: 'a' }, { secret: 'crane', guess: 'slate' }, { word: 'crane' }, { guess: null }, [], { secret: '  CRANE ' }];
  let logs = 0;
  let steps = 0;
  let solved = 0;
  let rejectedN = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = prng(seed * 7919);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const first = rnd() < 0.5 ? 'a' : 'b';
    const setup = { first, seed: seed * 31 };
    let s1 = V1.init(clone(setup)); s1.seed = setup.seed;
    let s2 = NEW.init(clone(setup)); s2.seed = setup.seed;
    assert_eq(s1, s2, 'init');
    const pool = rnd() < 0.5 ? common : [...valid];
    for (let step = 0; step < 90; step++) {
      const acts = V1.next(s1);
      if (!eq(NEW.next(s2), acts)) throw new Error(`FAIL: next() differs at seed ${seed} step ${step}`);
      if (!acts.length) break;
      // sometimes a player who isn't listed tries to move
      const who = rnd() < 0.08 ? (rnd() < 0.5 ? 'a' : 'b') : pick(acts);
      let mv;
      const r = rnd();
      const inGuess = s1.secret.a && s1.secret.b;
      if (r < 0.1) mv = pick(junk);
      else if (!s1.secret[who] || r < 0.15) mv = { secret: rnd() < 0.8 ? pick(pool) : pick(['abbey', 'crane', 'slate', 'plumb']) };
      else if (inGuess && r < 0.45) mv = { guess: s1.secret[who === 'a' ? 'b' : 'a'] }; // the right answer
      else if (r < 0.55 && s1.guesses[who].length) mv = { guess: pick(s1.guesses[who]) }; // a repeat
      else mv = { guess: rnd() < 0.9 ? pick(pool) : 'qzxjv' };
      let e1 = null; let e2 = null; let n1; let n2;
      try { n1 = V1.apply(clone(s1), who, clone(mv)); } catch (x) { e1 = x.message; }
      try { n2 = NEW.apply(clone(s2), who, clone(mv)); } catch (x) { e2 = x.message; }
      if (e1 !== e2) throw new Error(`FAIL: v1 replay errors differ at seed ${seed} step ${step}: ${e1} vs ${e2} for ${JSON.stringify(mv)}`);
      if (e1) { rejectedN++; continue; }
      s1 = n1; s2 = n2; steps++;
      assert_eq(s1, s2, `state at seed ${seed} step ${step}`);
    }
    if (!eq(V1.next(s1), [])) { /* an unfinished log is fine too */ } else {
      logs++;
      assert_eq(V1.result(s1), NEW.result(s2), `result at seed ${seed}`);
      if (V1.result(s1).winner) solved++;
    }
  }
  function assert_eq(a, b, what) { if (!eq(a, b)) throw new Error(`FAIL: v1 replay differs (${what})\n${JSON.stringify(a)}\n${JSON.stringify(b)}`); }
  assert(logs >= 100 && steps > 2000 && rejectedN > 300, `v1 replay equivalence: 400 random legacy logs (${logs} finished, ${solved} decisive, ${steps} moves, ${rejectedN} rejected) identical in state, next() and result()`);
  // the engine's own derive() agrees too (rejected moves are skipped, order follows next())
  const core = await imp('js/games/core.js');
  const mini = (rules) => ({ ...rules, id: 'x', kind: 'turns', secret: true, title: 'x', blurb: '', howTo: [], css: '' });
  const lists3 = { a: [{ secret: 'abbey' }, { guess: 'crane' }, { guess: 'slate' }], b: [{ secret: 'crane' }, { guess: 'abbey' }, { guess: 'zzzzz' }, { guess: 'slate' }] };
  const dA = core.derive(mini(V1), { first: 'a', seed: 3, opts: {}, lists: lists3 });
  const dB = core.derive(mini(NEW), { first: 'a', seed: 3, opts: {}, lists: lists3 });
  assert(eq(dA.state, dB.state) && eq(dA.result, dB.result) && eq(dA.rejected, dB.rejected), 'core.derive() gives the same legacy match with either rules');

  // ── setup ──
  const run = (moves, setup = { first: 'a', seed: 7 }) => {
    let s = R.init(clone(setup));
    s.seed = setup.seed;
    for (const [w, m] of moves) s = R.apply(clone(s), w, clone(m));
    return s;
  };
  const S = (o = {}) => ({ setup: { v: 2, ...o } });
  let s = run([['a', S({})]]);
  assert(s.v === 2 && eq(s.opts, { pool: 'fair', hard: false, dealt: false, bo3: false }), 'setup: defaults are fair / no hard / no dealt / no bo3');
  assert(eq(R.next(s), ['a', 'b']), 'setup: both still pick secrets at once');
  assert(eq(run([['b', S({ pool: 'love', hard: true })]]).opts, { pool: 'love', hard: true, dealt: false, bo3: false }), 'setup: either player may send it');
  throws(() => run([['a', S({})], ['b', S({ hard: true })]]), /already set/, 'setup: a second setup is refused (first one wins)');
  throws(() => run([['a', { secret: 'abbey' }], ['b', S({})]]), /locked|already set/, 'setup: refused after a secret is placed');
  throws(() => run([['a', S({})], ['a', { secret: 'abbey' }], ['b', S({ hard: true })]]), /already set|locked/, 'setup: refused after setup and a secret');
  for (const bad of [{ v: 1 }, {}, { v: 3 }, { v: 2, pool: 'nope' }, { v: 2, hard: 'yes' }, { v: 2, extra: 1 }, { v: 2, dealt: 1 }, null, 'x', [], { v: 2, bo3: null }]) throws(() => run([['a', { setup: bad }]]), /didn’t make sense/, `setup: rejects ${JSON.stringify(bad)}`);
  assert(R.parseSetup({ v: 2, pool: 'any' }).pool === 'any', 'setup: parse accepts a partial');
  const r1 = R.init({ first: 'a', seed: 1 });
  assert(eq(Object.keys(r1), ['secret', 'guesses']), 'the pristine state keeps its v1 shape');

  // a v2 secret that replays before the rules move (seat a is replayed first) is parked, not made legacy
  s = run([['a', { secret: 'grape', v: 2 }]]);
  assert(s.pend && s.pend.a === 'grape' && !s.secret.a && !s.v, 'parking: a v2 secret ahead of the rules is held back');
  assert(eq(R.next(s), ['b']), 'parking: the parked player is not listed until the rules arrive, so their later moves wait their turn');
  { const core2 = await imp('js/games/core.js'); const mk = (r) => ({ ...r, id: 'x', kind: 'turns', secret: true, title: 'x', blurb: '', howTo: [], css: '' }); const d = core2.derive(mk(NEW), { first: 'b', seed: 5, opts: {}, lists: { a: [{ secret: 'grape', v: 2 }, { guess: 'plumb' }], b: [{ setup: { v: 2, pool: 'fair' } }, { secret: 'plumb', v: 2 }] } }); assert(d.state.v === 2 && d.state.secret.a === 'grape' && d.state.secret.b === 'plumb' && d.state.guesses.a.length === 1 && !d.rejected.length, 'parking: derive() with seat a replayed first still ends up with the rules, both secrets and the guess'); }
  s = R.apply(clone(s), 'b', S({ pool: 'fair', hard: true }));
  assert(s.v === 2 && s.secret.a === 'grape' && !s.pend && s.opts.hard, 'parking: the rules move places it');
  s = run([['a', { secret: 'grape', v: 2 }], ['b', S({ pool: 'love' })], ['b', { secret: 'heart', v: 2 }]]);
  assert(s.secret.a === null && s.secret.b === 'heart', 'parking: a parked word that breaks the pool is dropped, so that player picks again');
  s = run([['a', { secret: 'grape', v: 2 }], ['b', S({ dealt: true })], ['b', { secret: 'crane', v: 2 }]]);
  assert(s.secret.a === 'grape' && s.secret.b === 'crane' && s.guesses.a.length === 1, 'parking: with a dealt opener the opener lands once both words are in');
  assert(run([['a', S({})], ['a', { secret: 'grape', v: 2 }]]).secret.a === 'grape', 'a v2 secret after the rules is just a secret');

  // hardening: a parked secret can never end the match without rules
  {
    const core3 = await imp('js/games/core.js');
    const mk = (r) => ({ ...r, id: 'x', kind: 'turns', secret: true, title: 'x', blurb: '', howTo: [], css: '' });
    const dv = (lists) => core3.derive(mk(NEW), { first: 'b', seed: 5, opts: {}, lists });
    // a v2 secret first, then the other seat plays a plain legacy secret: the match is classic
    let d = dv({ a: [{ secret: 'grape', v: 2 }, { guess: 'plumb' }], b: [{ secret: 'plumb' }, { guess: 'grape' }] });
    assert(!d.state.v && !d.state.pend && d.state.secret.a === 'grape' && d.state.secret.b === 'plumb' && d.over && d.result.winner === null && d.rejected.length === 0, `parking: a legacy secret turns the parked one into a plain secret, classic rules, nobody stuck (${JSON.stringify(d.rejected)})`);
    d = dv({ a: [{ secret: 'grape', v: 2 }], b: [{ secret: 'slate' }] });
    assert(!d.over && !d.state.v && d.state.secret.a === 'grape' && d.state.secret.b === 'slate' && eq(R.next(d.state), ['a', 'b']), 'parking: a parked secret plus a legacy secret is a classic match in progress (repro 1)');
    // both seats parked: b's setup (the next move in its list) must still be applied
    d = dv({ a: [{ secret: 'grape', v: 2 }], b: [{ secret: 'plumb', v: 2 }, { setup: { v: 2, pool: 'fair' } }] });
    assert(d.state.v === 2 && d.state.secret.a === 'grape' && d.state.secret.b === 'plumb' && !d.state.pend && !d.over, `parking: with both secrets parked the setup still lands (${JSON.stringify(d.state)}, rejected ${JSON.stringify(d.rejected)})`);
    const both = run([['a', { secret: 'grape', v: 2 }], ['b', { secret: 'plumb', v: 2 }]]);
    assert(R.next(both).length > 0 && both.pend.a && both.pend.b, 'parking: both parked is never "over" (next lists a seat that can send the rules)');
    // and nothing is ever over while a pend exists
    for (const only of ['a', 'b']) { const one = run([[only, { secret: 'grape', v: 2 }]]); assert(R.next(one).length > 0, `parking: ${only} parked alone is not over`); }
  }

  // ── pools ──
  assert(love.length >= 50 && love.every((w) => common.includes(w)), `love list: ${love.length} words, all in the common list`);
  const uncommon = [...valid].find((w) => !common.includes(w));
  throws(() => run([['a', S({})], ['a', { secret: uncommon }]]), /everyday/, 'fair pool: rejects a word outside the common list');
  assert(run([['a', S({})], ['a', { secret: 'crane' }]]).secret.a === 'crane', 'fair pool: accepts a common word');
  throws(() => run([['a', S({ pool: 'love' })], ['a', { secret: 'crane' }]]), /love list/, 'love pool: rejects a non-love word');
  assert(run([['a', S({ pool: 'love' })], ['a', { secret: 'heart' }]]).secret.a === 'heart', 'love pool: accepts HEART');
  assert(run([['a', S({ pool: 'any' })], ['a', { secret: uncommon }]]).secret.a === uncommon, 'any pool: accepts any valid word');
  s = run([['a', S({ pool: 'love' })], ['a', { secret: 'heart' }], ['b', { secret: 'bride' }], ['a', { guess: 'crane' }], ['a', { guess: uncommon }]]);
  assert(s.guesses.a.length === 2, 'guesses: any valid word, whatever the pool');

  // ── hard mode ──
  const hardBase = [['a', S({ pool: 'any', hard: true })], ['a', { secret: 'abbey' }], ['b', { secret: 'crane' }]];
  // CRANE vs guess SLATE: A is not in the word...  use guess 'brine' (crane): b r i n e -> r green? crane c r a n e; brine b r i n e: r=g, n=g, e=g
  s = run([...hardBase, ['a', { guess: 'brine' }]]);
  throws(() => run([...hardBase, ['a', { guess: 'brine' }], ['a', { guess: 'slate' }]]), /Hard mode: keep R in spot 2\./, 'hard: a revealed green must stay');
  throws(() => run([...hardBase, ['a', { guess: 'abbot' }], ['a', { guess: 'pound' }]]), /Hard mode: use the A\./, 'hard: a revealed yellow must be reused');
  assert(run([...hardBase, ['a', { guess: 'brine' }], ['a', { guess: 'crane' }]]).guesses.a.length === 2, 'hard: a legal follow-up is accepted');
  assert(run([['a', S({ pool: 'any' })], ['a', { secret: 'abbey' }], ['b', { secret: 'crane' }], ['a', { guess: 'brine' }], ['a', { guess: 'slate' }]]).guesses.a.length === 2, 'normal mode ignores hard-mode constraints');
  // a repeated letter: BOBBY vs ABBEY
  assert(eq(R.heatOf('crane', ['brine']), { g: 3, y: 0 }), 'heat: BRINE against CRANE is 3 greens');
  throws(() => run([['a', S({ pool: 'any', hard: true })], ['a', { secret: 'abbey' }], ['b', { secret: 'nylon' }], ['a', { guess: 'ennui' }], ['a', { guess: 'slate' }]]), /Hard mode: use both Ns\./, 'hard: two revealed copies need two (use both Ns)');

  // ── dealt opener ──
  s = run([['a', S({ dealt: true })]]);
  assert(common.includes(s.opener) && eq(s.guesses, { a: [], b: [] }), 'dealt: the opener is drawn from the common list at setup');
  assert(run([['a', S({ dealt: true })]], { first: 'a', seed: 7 }).opener === s.opener && run([['a', S({ dealt: true })]], { first: 'a', seed: 8 }).opener !== undefined, 'dealt: deterministic per seed');
  const op = s.opener;
  throws(() => run([['a', S({ dealt: true })], ['a', { secret: op }]]), /dealt opener/, 'dealt: a secret equal to the opener is refused');
  const other1 = common.find((w) => w !== op && w !== 'crane');
  s = run([['a', S({ dealt: true })], ['a', { secret: other1 }], ['b', { secret: 'crane' }]]);
  assert(eq(s.guesses.a, [op]) && eq(s.guesses.b, [op]), 'dealt: row 1 is the opener for both once both have picked');
  assert(!R.doneBy(s, 'a') && eq(R.next(s), ['a', 'b']), 'dealt: the opener alone does not finish anyone');
  throws(() => R.apply(clone(s), 'a', { guess: op }), /already tried/, 'dealt: the opener counts as a guess already made');
  let t = s;
  for (const g of ['slate', 'brine', 'pound', 'misty', 'jumbo']) t = R.apply(clone(t), 'a', { guess: g });
  assert(t.guesses.a.length === 6 && R.doneBy(t, 'a'), 'dealt: the opener counts toward the six guesses');
  const seeds = new Set(); for (let sd = 1; sd <= 30; sd++) seeds.add(run([['a', S({ dealt: true })]], { first: 'a', seed: sd }).opener);
  assert(seeds.size >= 20, `dealt: openers vary across seeds (${seeds.size} different in 30)`);
  // the dealt opener never lands on the secret even for the ones the opener happens to be
  // ── heat tie-break ──
  const A = 'crane';
  const duelState = (ga, gb, secA = 'abbey', secB = 'crane') => ({ v: 2, opts: { pool: 'any', hard: false, dealt: false, bo3: false }, secret: { a: secA, b: secB }, guesses: { a: ga, b: gb } });
  // a cracks CRANE (b's word) in 3; b cracks ABBEY in 3. a's earlier rows: slate(e g? ) etc.
  let st = duelState(['slate', 'brine', 'crane'], ['hobby', 'tabby', 'abbey']);
  let rs = R.result(st);
  assert(R.next(st).length === 0 && rs.winner && /greens|yellows/.test(rs.sub), `heat: equal tallies are broken by heat (${rs.sub})`);
  const dd = R.duel(st.secret, st.guesses);
  assert(dd.w === (dd.ha.g > dd.hb.g ? 'a' : 'b'), 'heat: more greens before the solving row wins');
  st = duelState(['crane'], ['abbey']);
  rs = R.result(st);
  assert(rs.winner === null && rs.text === 'Dead heat', 'heat: two first-guess cracks are a dead heat');
  // same greens, different yellows
  st = duelState(['plumb', 'crane'], ['hobby', 'abbey'], 'abbey', 'crane');
  const d2 = R.duel(st.secret, st.guesses);
  assert(d2.by === 'greens' || d2.by === 'yellows' || d2.w === null, 'heat: rows before the solve are counted (not the solving row)');
  assert(R.heatOf('crane', ['crane']).g === 0, 'heat: the solving row is not counted');
  // both miss: heat decides who got closer
  const miss = (w) => [w, 'pound', 'misty', 'jumbo', 'fight', 'lunch'];
  st = duelState(miss('brine'), miss('hobby'));
  rs = R.result(st);
  assert(R.next(st).length === 0 && rs.winner === 'a' && /closer/.test(rs.sub), `heat: a double miss goes to whoever got closer (${rs.sub})`);
  st = duelState(miss('slate'), ['slate', 'brine', 'pound', 'misty', 'jumbo', 'fight'].slice(0, 6), 'abbey', 'crane');
  assert(R.duel(st.secret, st.guesses).w !== undefined, 'heat: runs on a double miss');
  // an actual win by guesses still reads as before and a near miss gets a line
  st = duelState(['slate', 'crane'], miss('hobby'));
  rs = R.result(st);
  assert(rs.winner === 'a' && /Cracked it in 2 guesses\. The other word held out\./.test(rs.sub), `result: a crack beats a miss (${rs.sub})`);
  st = duelState(['slate', 'brine', 'crane'], ['hobby', 'tabby', 'oxbow', 'abbey']);
  rs = R.result(st);
  assert(/One guess\. That’s all it was\./.test(rs.sub), `result: a one-guess margin gets its line (${rs.sub})`);
  st = duelState(['crane'], ['plumb', 'pound', 'misty', 'jumbo', 'fight', 'abbey'.replace('abbey', 'abbes')]);
  // b's last row has some greens against CRANE? B guesses against secret.a (abbey): abbes -> a b b e green + s grey = 4 greens
  rs = R.result({ ...st, secret: { a: 'abbey', b: 'crane' }, guesses: { a: ['crane'], b: ['plumb', 'pound', 'misty', 'jumbo', 'fight', 'abbes'] } });
  assert(rs.winner === 'a' && /Four greens on the last row\. Brutal\./.test(rs.sub), `result: four greens on a missing last row (${rs.sub})`);

  // ── best of 3 ──
  const bo = [['a', S({ pool: 'any', bo3: true })]];
  const round = (sa, sb, ga, gb) => [['a', { secret: sa }], ['b', { secret: sb }], ...ga.map((g) => ['b', { guess: g }]), ...gb.map((g) => ['a', { guess: g }])];
  // round 1: a's word abbey, b's word crane. b cracks abbey in 1 ('abbey'), a misses crane -> b wins round 1
  let m = run([...bo, ...round('abbey', 'crane', ['abbey'], ['pound', 'misty', 'jumbo', 'fight', 'lunch', 'slate'])]);
  assert(m.rounds.length === 1 && m.rounds[0].w === 'b' && eq(m.wins, { a: 0, b: 1 }) && m.round === 2, 'bo3: a finished round is archived and the next round opens');
  assert(eq(m.secret, { a: null, b: null }) && eq(m.guesses, { a: [], b: [] }) && eq(R.next(m), ['a', 'b']), 'bo3: the new round starts with both picking');
  assert(R.score(m).b === 1, 'bo3: the chips show round wins');
  throws(() => R.apply(clone(m), 'a', { secret: 'abbey' }), /already used this set/, 'bo3: a secret from an earlier round is refused');
  throws(() => R.apply(clone(m), 'a', S({})), /already set/, 'bo3: setup stays locked');
  // round 2: b wins again -> set over 2-0
  m = run([...bo, ...round('abbey', 'crane', ['abbey'], ['pound', 'misty', 'jumbo', 'fight', 'lunch', 'slate']), ...round('plumb', 'grape', ['plumb'], ['pound', 'misty', 'jumbo', 'fight', 'lunch', 'slate'])]);
  assert(m.fin && eq(R.next(m), []) && R.result(m).winner === 'b' && /^2 to 0 over 2 rounds/.test(R.result(m).sub), `bo3: first to two takes the set (${R.result(m).sub})`);
  // a comeback: b wins 1, a wins 2 and 3
  const win = (w, secA, secB) => (w === 'b' ? round(secA, secB, [secA], ['pound', 'misty', 'jumbo', 'fight', 'lunch', 'slate']) : round(secA, secB, ['pound', 'misty', 'jumbo', 'fight', 'lunch', 'slate'], [secB]));
  m = run([...bo, ...win('b', 'abbey', 'crane'), ...win('a', 'plumb', 'grape'), ...win('a', 'heart', 'river')]);
  assert(m.fin && R.result(m).winner === 'a' && m.rounds.length === 3 && /^2 to 1 over 3 rounds/.test(R.result(m).sub), 'bo3: a comeback goes to three rounds');
  // a drawn round gives nobody the point; 1-1 after 3 plays a 4th; 4th level = draw
  const drawR = (secA, secB) => round(secA, secB, [secA], [secB]); // both crack in 1: dead heat
  m = run([...bo, ...win('b', 'abbey', 'crane'), ...win('a', 'plumb', 'grape'), ...drawR('heart', 'river')]);
  assert(!m.fin && m.rounds.length === 3 && m.round === 4 && eq(m.wins, { a: 1, b: 1 }), 'bo3: 1-1 after three rounds plays a fourth');
  m = R.apply(clone(m), 'a', { secret: 'lover' }); m = R.apply(m, 'b', { secret: 'sweet' }); m = R.apply(m, 'b', { guess: 'lover' }); m = R.apply(m, 'a', { guess: 'sweet' });
  assert(m.fin && R.result(m).winner === null && R.result(m).text === 'Set drawn', 'bo3: a level fourth round draws the set');
  m = run([...bo, ...drawR('abbey', 'crane'), ...win('a', 'plumb', 'grape'), ...drawR('heart', 'river')]);
  assert(m.fin && R.result(m).winner === 'a' && m.rounds.length === 3, 'bo3: after round three the leader takes the set');
  // options persist across rounds
  m = run([['a', S({ pool: 'love', hard: true, dealt: true, bo3: true })], ['a', { secret: 'heart' }], ['b', { secret: 'bride' }]]);
  const o1 = m.opener;
  m = R.apply(m, 'a', { guess: 'bride' }); m = R.apply(m, 'b', { guess: 'heart' });
  assert(m.round === 2 && m.opts.pool === 'love' && m.opts.hard && m.opts.dealt && m.opener && m.opener !== o1, 'bo3: pool, hard and dealt persist, and the opener changes each round');

  // ── records ──
  const fin = (ga, gb) => duelState(ga, gb);
  let data = {};
  let p = Rec.recordMatch(data, fin(['slate', 'crane'], ['pound', 'misty', 'jumbo', 'fight', 'lunch', 'oxbow']), 'm1');
  assert(p.lastm === 'm1' && p.matches_n === 1 && p.a_wins_n === 1 && p.a_streak === 1 && p.b_streak === 0 && p.a_fast_pb === 6 && p.a_held_n === 1 && !p.b_fast_pb, 'records: first match counts wins, streak, fastest and held-out');
  data = { ...data, ...p };
  assert(Rec.recordMatch(data, fin(['crane'], ['abbey']), 'm1') === null, 'records: the same match is recorded once');
  assert(Rec.recentOf(data).join() === 'm1' && data.recent_m === 'm1', 'records: recent_m holds the recorded ids');
  // reopening finished matches later (the Agents verifier's repro): never double-counted, legacy never counted on reopen
  const v1done = { secret: { a: 'abbey', b: 'crane' }, guesses: { a: ['crane'], b: ['abbey'] } };
  assert(Rec.recordMatch(data, v1done, 'old1', false) === null, 'records: a finished legacy v1 match opened later is never recorded');
  assert(Rec.recordMatch(data, v1done, 'old1', true) !== null, 'records: a legacy match watched to its end is recorded');
  assert(Rec.recordMatch(data, fin(['crane'], ['abbey']), 'm1', false) === null, 'records: reopening a recorded match does nothing');
  const reopened = Rec.recordMatch(data, fin(['crane'], ['abbey']), 'm9', false);
  assert(reopened && reopened.matches_n === 2 && reopened.recent_m === 'm1,m9', 'records: a v2 match this phone never recorded counts once when opened');
  let dz = { ...data, ...reopened };
  assert(Rec.recordMatch(dz, fin(['crane'], ['abbey']), 'm1', false) === null && Rec.recordMatch(dz, fin(['crane'], ['abbey']), 'm9', false) === null, 'records: opening m1 then m9 again later does not count either twice');
  for (let k = 0; k < 65; k++) dz = { ...dz, ...Rec.recordMatch(dz, fin(['crane'], ['abbey']), `r${k}`) };
  assert(Rec.recentOf(dz).length === 60 && Rec.recentOf(dz)[59] === 'r64' && !Rec.recentOf(dz).includes('m1'), 'records: recent_m keeps the last 60 ids (core keeps 25 finished online matches)');
  p = Rec.recordMatch(data, fin(['crane'], ['pound', 'misty', 'jumbo', 'fight', 'lunch', 'oxbow']), 'm2');
  assert(p.a_wins_n === 2 && p.a_streak === 2 && p.a_streak_best === 2 && p.a_two_n === 2 && p.a_fast_pb === 7 && p.pbm === 'm2', 'records: streak, mind-reader count and a personal best');
  data = { ...data, ...p };
  const stamps = Rec.stampsFor(fin(['crane'], ['pound', 'misty', 'jumbo', 'fight', 'lunch', 'oxbow']), data, 'm2', (w) => w);
  assert(stamps.some((x) => x.label === 'New record') && stamps.some((x) => x.label === 'Mind-reader') && stamps.some((x) => x.label === 'Held out'), `records: stamps (${stamps.map((x) => x.label).join(', ')})`);
  p = Rec.recordMatch(data, fin(['slate', 'brine', 'pound', 'misty', 'jumbo', 'crane'], ['pound', 'misty', 'jumbo', 'fight', 'lunch', 'oxbow']), 'm3');
  assert(p.a_lastditch_n === 1 && p.a_streak === 3, 'records: a crack on guess six is a last-ditch crack');
  data = { ...data, ...p };
  assert(Rec.stampsFor(fin(['slate', 'brine', 'pound', 'misty', 'jumbo', 'crane'], ['pound', 'misty', 'jumbo', 'fight', 'lunch', 'oxbow']), data, 'm3', (w) => w).some((x) => /3 in a row/.test(x.label)), 'records: a three-win streak stamps N in a row');
  p = Rec.recordMatch(data, fin(['pound', 'misty', 'jumbo', 'fight', 'lunch', 'oxbow'], ['abbey']), 'm4');
  assert(p.b_wins_n === 1 && p.a_streak === 0 && data.a_streak_best === 3 && p.a_streak_best === undefined && p.b_streak === 1 && p.b_fast_pb === 7, 'records: a loss resets the streak and keeps the best');
  p = Rec.recordMatch({ matches_n: 9 }, fin(['crane'], ['abbey']), 'mx');
  assert(p.matches_n === 10 && p.draws_n === 1 && Rec.stampsFor(fin(['crane'], ['abbey']), { ...p }, 'mx', (w) => w).some((x) => /number 10/.test(x.label)), 'records: the tenth duel is a milestone, a dead heat is a draw');
  const same = Rec.stampsFor(fin(['crane'], ['abbey']), {}, 'my', (w) => w);
  assert(same.some((x) => x.label === 'In sync'), 'stamps: both solving on the same row is In sync');
  assert(Rec.stampsFor(duelState(['crane'], ['crane'], 'crane', 'crane'), {}, 'mz', (w) => w).some((x) => x.label === 'Great minds'), 'stamps: the same secret is Great minds');
  assert(eq(Rec.setupFromString(Rec.setupToString({ pool: 'love', hard: true, dealt: false, bo3: true })), { pool: 'love', hard: true, dealt: false, bo3: true }) && Rec.setupFromString('junk') === null, 'records: the last setup round-trips as a string');
  assert(Rec.ledgerOf({ a_wins_n: 12, b_wins_n: 9, b_streak: 3 }, (w) => (w === 'a' ? 'Emerson' : 'Sydney')).text === 'E 12 – 9 S · Sydney ×3 streak', 'records: the ledger strip reads "E 12 – 9 S · Sydney ×3 streak"');
  // records for a best of 3 set
  m = run([...bo, ...win('b', 'abbey', 'crane'), ...win('a', 'plumb', 'grape'), ...win('a', 'heart', 'river')]);
  p = Rec.recordMatch({}, m, 'set1');
  assert(p.sets_n === 1 && p.comeback_n === 1 && p.a_wins_n === 1 && p.matches_n === 1, 'records: a best-of-3 comeback counts a set and a comeback');

  // a first-ever bo3 set (crack in 3, then in 2) is not a "new record"
  m = run([...bo, ...round('abbey', 'crane', ['abbey'], ['slate', 'pound', 'crane']), ...round('plumb', 'grape', ['plumb'], ['slate', 'grape'])]);
  p = Rec.recordMatch({}, m, 'first');
  assert(p.a_fast_pb === 6 && !p.pbm, 'records: no NEW RECORD on the first match, even when a later round beat an earlier one');
  p = Rec.recordMatch({ a_fast_pb: 5 }, m, 'second');
  assert(p.pbm === 'second' && p.a_fast_pb === 6, 'records: a real personal best (6 > 5) still sets pbm');
  p = Rec.recordMatch({ a_fast_pb: 6 }, m, 'third');
  assert(!p.pbm && p.a_fast_pb === undefined, 'records: equalling the best is not a record');
  assert(Rec.stampsFor(duelState(['crane'], ['crane'], 'crane', 'crane'), { recent_m: 'x', matches_n: 10 }, 'x', (w) => w)[0].label === 'Great minds', 'stamps: the rare ones come first (Great minds survives the cap)');

  // size budget: the entry file stays modest now the lists live in their own file
  const fsz = fs.statSync(path.join(ROOT, 'js/games/wordduel.js')).size;
  assert(fsz < 110 * 1024, `wordduel.js is ${(fsz / 1024).toFixed(1)} KB`);
}


// ═══════════════════════════ UI ═══════════════════════════════════════════
const toastText = (pg) => pg.evaluate(() => { const x = [...document.querySelectorAll('.toast')]; return x.length ? x[x.length - 1].textContent : ''; });
const tapKeys = async (pg, word) => { for (const ch of word) await pg.tap(`.g-wd-key[data-k="${ch}"]`); };
const tapEnter = (pg) => pg.tap('.g-wd-key[data-k="enter"]');
const typeWord = async (pg, w, wait = 280) => { await pg.keyboard.type(w); await pg.keyboard.press('Enter'); await pg.waitForTimeout(wait); };
const MISSES = ['slate', 'brine', 'pound', 'misty', 'jumbo', 'fight'];
async function retry(fn) { for (let n = 0; ; n++) { try { return await fn(); } catch (e) { if (n >= 2 || !/not attached|detached/i.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 300)); } } }
const newOnline = (h, pg) => retry(() => h.newOnlineGame(pg, 'wordduel'));
const newLocal = (h, pg) => retry(() => h.newLocalGame(pg, 'wordduel'));
const reveal = async (pg) => { await pg.waitForSelector('#game-root .gm-curtain:not([hidden])'); await pg.tap('#game-root [data-g="reveal"]'); await pg.waitForTimeout(100); };
const dataOf = (pg) => pg.evaluate(() => { try { return (JSON.parse(localStorage.getItem('ju.games.data.v1') || '{}').wordduel) || {}; } catch { return {}; } });
const sayOf = (pg) => pg.textContent('.g-wd-say');
async function snap(pg, scheme, name, size) {
  if (size) await pg.setViewportSize({ width: size[0], height: size[1] });
  await pg.waitForTimeout(120);
  await pg.screenshot({ path: path.join(SHOTS, `${scheme}-${name}.png`), animations: 'disabled' });
}
async function reloadInto(h, pg, id) {
  await pg.reload();
  try { await pg.waitForFunction(() => !!document.querySelector('.tabbar'), null, { timeout: 15000 }); } catch (e) { await pg.screenshot({ path: path.join(SHOTS, 'reload-fail.png') }); throw new Error('reload: no tab bar after reloading: ' + (await pg.evaluate(() => document.body.innerText.slice(0, 200)))); }
  await pg.waitForTimeout(300);
  await h.openMatch(pg, id);
  await pg.waitForTimeout(400);
}
const geometry = (pg) => pg.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right) }; };
  const sc = [document.scrollingElement, q('#game-root'), q('.gm'), q('.g-wd')].filter(Boolean).map((e) => e.scrollHeight - e.clientHeight);
  return { vh: innerHeight, vw: innerWidth, kb: r(q('.g-wd-kb')), enter: r(q('.g-wd-key[data-k="enter"]')), scroll: Math.max(...sc), hscroll: document.documentElement.scrollWidth > innerWidth };
});

async function setRules(pg, want) {
  for (const k of ['hard', 'dealt', 'bo3']) {
    const on = (await pg.getAttribute(`[data-rule="${k}"]`, 'aria-checked')) === 'true';
    if (on !== !!want[k]) await pg.tap(`[data-rule="${k}"]`);
  }
  if (want.pool) await pg.tap(`[data-rule="pool:${want.pool}"]`);
}

// every visible button in the game (keyboard keys excepted) is at least 44 px tall and wide
const smallButtons = (pg) => pg.evaluate(() => [...document.querySelectorAll('.g-wd button:not(.g-wd-key), .g-wd-hold-layer button:not(.g-wd-key)')]
  .filter((b) => b.offsetParent !== null).map((b) => ({ t: b.textContent.trim().slice(0, 20), r: b.getBoundingClientRect() })).filter((x) => x.r.height < 43.5 || x.r.width < 43.5).map((x) => `${x.t} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`));
async function playVisible(pg, sizes) {
  for (const [w, hh] of sizes) {
    await pg.setViewportSize({ width: w, height: hh });
    await pg.waitForTimeout(200);
    const r = await pg.evaluate(() => { const b = document.querySelector('.g-wd-actions [data-act="play"]').getBoundingClientRect(); return { t: b.top, b: b.bottom, h: b.height, vh: innerHeight, scroll: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight }; });
    assert(r.t >= 0 && r.b <= r.vh && r.h >= 44 && r.scroll <= 1, `${w}x${hh}: Play is fully visible without scrolling (${JSON.stringify(r)})`);
  }
  await pg.setViewportSize({ width: 390, height: 664 });
  await pg.waitForTimeout(150);
}

// 1. online: rules card -> pick -> play with fair + hard + dealt; B3, B4, records and ledger
async function onlineDealtHard(h, scheme) {
  const R = await imp('js/games/wordduel/rules.js');
  const { a, b } = h;
  const id = await newOnline(h, a);
  await h.openMatch(b, id);
  await h.settle();
  const first = (await h.engine(a, id)).first;
  const F = first === 'a' ? a : b;
  const S = first === 'a' ? b : a;
  const FN = first === 'a' ? 'Emerson' : 'Sydney';
  assert(await F.isVisible('.g-wd-actions [data-act="play"]') && await F.isVisible('.g-wd-rules'), 'online: the first player sees the rules card with a big Play button');
  assert(new RegExp(`Waiting for ${FN} to set the rules`).test(await sayOf(S)) && !(await S.isVisible('.g-wd-rules')) && !(await S.isVisible('.g-wd-kb')), 'online: the other player waits for the rules (no card, no keyboard)');
  assert(eq((await h.engine(a, id)).acts, ['a', 'b']), 'online: next() stays both players while pristine');
  assert(await F.getAttribute('[data-rule="pool:fair"]', 'aria-pressed') === 'true', 'rules card defaults to everyday words');
  assert(await F.evaluate(() => { const b = document.querySelector('.g-wd-actions [data-act="play"]').getBoundingClientRect(); return b.height >= 44 && b.bottom <= innerHeight; }), 'Play is a 44 px+ button inside the viewport');
  await playVisible(F, [[360, 640], [844, 390], [667, 375], [320, 568]]);
  assert((await smallButtons(F)).length === 0, `the rules card's buttons are all 44 px+ (${await smallButtons(F)})`);
  await snap(F, scheme, 'wd2-1-rules');
  await snap(S, scheme, 'wd2-1-wait');
  await setRules(F, { pool: 'fair', hard: true, dealt: true, bo3: false });
  assert(await F.getAttribute('[data-rule="hard"]', 'aria-checked') === 'true' && await F.getAttribute('[data-rule="dealt"]', 'aria-checked') === 'true', 'rules card toggles are switches');
  await F.tap('[data-act="play"]');
  await h.settle();
  let e = await h.engine(a, id);
  assert(e.state.v === 2 && eq(e.state.opts, { pool: 'fair', hard: true, dealt: true, bo3: false }) && /^[a-z]{5}$/.test(e.state.opener), `setup move applied: ${JSON.stringify(e.state.opts)}, opener ${e.state.opener}`);
  const lastSetup = (await dataOf(F)).last_setup;
  assert(lastSetup === 'fair:1:1:0', `the rules card remembers its last choice (${lastSetup})`);
  for (const pg of [a, b]) assert(await pg.isVisible('.g-wd-key[data-k="q"]') && /Everyday words/i.test(await pg.textContent('.g-wd-tags')), 'both players get the keyboard and the pool stamp');
  assert(new RegExp(e.state.opener, 'i').test(await F.textContent('.g-wd-dealtline')), 'the pick screen shows the dealt opener');
  assert((await smallButtons(F)).length === 0, `the pick screen's buttons are all 44 px+ (${await smallButtons(F)})`);
  await snap(F, scheme, 'wd2-2-pick');
  // pool rejection, opener rejection
  const uncommon = [...R.lists().valid].find((w) => !R.lists().commonSet.has(w));
  await F.keyboard.type(uncommon); await F.keyboard.press('Enter'); await F.waitForTimeout(80);
  assert(/everyday/i.test(await toastText(F)), `a rare word is refused for a secret (${await toastText(F)})`);
  for (let i = 0; i < 5; i++) await F.keyboard.press('Backspace');
  await F.keyboard.type(e.state.opener); await F.keyboard.press('Enter'); await F.waitForTimeout(80);
  assert(/dealt opener/i.test(await toastText(F)), 'the dealt opener is refused as a secret');
  for (let i = 0; i < 5; i++) await F.keyboard.press('Backspace');
  // S's word must share letters with the opener, so hard mode has hints to enforce for F
  const sS = ['plumb', 'grape', 'crane', 'slate', 'river', ...R.lists().common].find((w) => w !== e.state.opener && /[gy]/.test(R.scoreGuess(w, e.state.opener)));
  const sF = ['plumb', 'grape', 'crane', 'slate', 'river'].find((w) => w !== e.state.opener && w !== sS); // F's word (S cracks it), S's word (F cracks it)
  await tapKeys(F, sF); await tapEnter(F);
  await typeWord(S, sS);
  await h.settle(); await h.settle();
  e = await h.engine(a, id);
  const op = e.state.opener;
  const otherSeat = first === 'a' ? 'b' : 'a';
  assert(e.state.secret[first] === sF && e.state.secret[otherSeat] === sS && eq(e.state.guesses.a, [op]) && eq(e.state.guesses.b, [op]), `dealt: row 1 is the opener for both once both have picked (${JSON.stringify(e.state)}, wanted ${sF}/${sS})`);
  assert(await F.isVisible('.g-wd-row.is-dealt') && await S.isVisible('.g-wd-row.is-dealt'), 'row 1 carries the DEALT tag');
  assert(await F.isVisible('.g-wd-strip .g-wd-heat'), 'the heat meter shows during play');
  const stripText = await S.evaluate(() => document.querySelector('.g-wd-strip').innerText.toUpperCase());
  assert(!new RegExp(sF.toUpperCase()).test(stripText), 'the heat meter shows counts, no letters');
  await F.evaluate(() => document.querySelectorAll('.g-wd-key').forEach((k) => { k.__keep = true; }));
  // hard mode: find an illegal follow-up for F (cracking sS), by brute force
  let illegal = null;
  for (const w of R.lists().common) { if (w === op) continue; try { R.hardCheck(sS, [op], w); } catch (er) { illegal = { w, msg: er.message }; break; } }
  if (illegal) {
    await F.keyboard.type(illegal.w); await F.keyboard.press('Enter'); await F.waitForTimeout(100);
    assert(/Hard mode: (keep|use)/.test(await toastText(F)), `hard mode refuses ${illegal.w.toUpperCase()} (${await toastText(F)})`);
    for (let i = 0; i < 5; i++) await F.keyboard.press('Backspace');
  } else console.log('note: the opener gave no hint, hard mode not exercised');
  // F cracks in 2 (opener + exact word)
  await F.keyboard.type(sS); await F.waitForTimeout(40);
  await F.keyboard.press('Enter');
  await F.waitForTimeout(220);
  assert(!/Cracked it in/.test(await sayOf(F)), `B4: no "Cracked it in" before the flip ends (${await sayOf(F)})`);
  assert(await F.evaluate(() => document.querySelectorAll('.g-wd-key').length === 28 && [...document.querySelectorAll('.g-wd-key')].every((k) => k.__keep)), 'B3: the same key nodes survive a submit (built once)');
  await F.waitForTimeout(1500);
  assert(/Cracked it in 2/.test(await sayOf(F)), `after the flip it says so (${await sayOf(F)})`);
  assert((await smallButtons(F)).length === 0, `the waiting view's buttons are all 44 px+ (${await smallButtons(F)})`);
  await snap(F, scheme, 'wd2-3-done');
  // S: a wrong guess, then the crack on row 3. F (done) must not see "cracked it in 3" before the flip ends
  const legal = (w) => { try { R.hardCheck(sF, [op], w); return true; } catch { return false; } };
  const wrong = [...MISSES, ...R.lists().common].find((w) => w !== op && w !== sF && legal(w));
  await S.keyboard.type(wrong); await S.keyboard.press('Enter'); await S.waitForTimeout(60);
  const toastNow = await toastText(S); await S.waitForTimeout(200);
  assert((await h.engine(S, id)).state.guesses[first === 'a' ? 'b' : 'a'].length === 2, `the partner's wrong guess ${wrong} was played (toast: ${toastNow}; row ${await S.evaluate(() => document.querySelector('.g-wd-row.is-draft') && document.querySelector('.g-wd-row.is-draft').innerText.replace(/\\s/g, ''))}; say ${await sayOf(S)}; opener ${op}; target ${sF}; rejected ${JSON.stringify((await h.engine(S, id)).rejected)}; pending ${JSON.stringify((await h.engine(S, id)).lists)})`);
  await S.keyboard.type(sF); await S.keyboard.press('Enter');
  const trace = [];
  for (let i = 0; i < 9; i++) { await F.waitForTimeout(100); trace.push(await F.evaluate(() => [...document.querySelectorAll('.g-wd-colhead small')].map((x) => x.textContent).join('|'))); }
  await h.settle();
  const colHead = await F.evaluate(() => [...document.querySelectorAll('.g-wd-colhead small')].map((x) => x.textContent).join(' | '));
  assert(trace.slice(0, 6).every((x) => !/cracked it in 3/.test(x)), `B4: the partner's crack isn't announced before its flip finishes (${trace.join(' ; ')})`);
  await F.waitForTimeout(2600);
  e = await h.engine(a, id);
  const eb = await h.engine(b, id);
  assert(e.over && eq(e.state, eb.state), `both phones agree on the finished duel (over ${e.over}, acts ${JSON.stringify(e.acts)}/${JSON.stringify(eb.acts)}, ${JSON.stringify(e.state)} vs ${JSON.stringify(eb.state)})`);
  assert(e.result.winner === first && /Cracked it in 2 guesses, against 3\./.test(e.result.sub), `fewer guesses wins (${e.result.sub})`);
  for (const pg of [a, b]) await pg.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 6000 });
  await h.settle();
  const da = await dataOf(a); const db = await dataOf(b);
  const wk = `${first}_wins_n`;
  assert(da.lastm === id && da.matches_n === 1 && da[wk] === 1 && db.matches_n === 1 && db[wk] === 1, `records: one match counted once on both phones (${JSON.stringify(da)})`);
  assert(da[`${first}_fast_pb`] === 6 && da[`${first}_streak`] === 1, 'records: fastest crack and streak');
  await a.click('#game-root [data-g="end-look"]'); await b.click('#game-root [data-g="end-look"]');
  await a.waitForTimeout(300);
  for (const pg of [a, b]) {
    const led = await pg.textContent('.g-wd-ledger');
    assert(first === 'a' ? /E 1 – 0 S/.test(led) : /E 0 – 1 S/.test(led), `the end view shows the ledger strip (${led})`);
    assert(await pg.isVisible('.g-wd-stamps'), 'the end view prints stamps');
  }
  const stampTxt = await a.textContent('.g-wd-stamps');
  assert(/Mind-reader/i.test(stampTxt), `a crack in two earns MIND-READER (${stampTxt})`);
  assert((await smallButtons(a)).length === 0, `the end view's buttons are all 44 px+ (${await smallButtons(a)})`);
  await snap(a, scheme, 'wd2-4-end');
  await snap(b, scheme, 'wd2-4-end-b');
  await h.closeGame(a); await h.closeGame(b);
}

// the Agents verifier's repro: Sydney's phone is away while the match ends on another device, then opens it
async function awayPhone(h, scheme) {
  const { a, b } = h;
  const b2 = await h.device('b');
  await h.openGames(b2);
  const id = await newOnline(h, a);
  await h.openMatch(b2, id);
  await h.settle();
  const first = (await h.engine(a, id)).first;
  const P = { a, b: b2 };
  await setRules(P[first], { pool: 'fair', hard: false, dealt: false, bo3: false });
  await P[first].tap('[data-act="play"]');
  await h.settle();
  await typeWord(a, 'plumb', 120); await typeWord(b2, 'grape', 120); await h.settle();
  await typeWord(a, 'grape', 150); await typeWord(b2, 'plumb', 150);
  await h.settle(); await a.waitForTimeout(2600);
  const e = await h.engine(a, id);
  assert(e.over, 'the match ended while the first Sydney phone was away');
  await a.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 6000 });
  await h.settle();
  const before = await dataOf(a);
  assert(before.recent_m && before.recent_m.split(',').includes(id), `the finishing phone recorded it (${JSON.stringify(before)})`);
  await h.openGames(b);
  await b.locator(`[data-g="open"][data-id="${id}"]`).first().click({ timeout: 8000 });
  await b.waitForSelector('#game-root .gm');
  await b.waitForTimeout(800);
  const after = await dataOf(b);
  assert(after.matches_n === before.matches_n && eq(after.recent_m, before.recent_m), `opening the finished match on the phone that was away does not count it again (${before.matches_n} -> ${after.matches_n})`);
  await h.closeGame(b);
  await h.closeGame(a);
  await h.closeGame(b2);
}

// 2. online best of 3, to a set result
async function onlineBo3(h, scheme) {
  const { a, b } = h;
  const id = await newOnline(h, a);
  await h.openMatch(b, id);
  await h.settle();
  const first = (await h.engine(a, id)).first;
  const P = { a, b };
  await setRules(P[first], { pool: 'fair', hard: false, dealt: false, bo3: true });
  await P[first].tap('[data-act="play"]');
  await h.settle();
  const ex = async () => (await h.engine(a, id)).state;
  const both = async (sa, sb) => { await typeWord(a, sa, 120); await typeWord(b, sb, 120); await h.settle(); };
  await both('abbey', 'crane');
  await typeWord(b, 'abbey', 200);
  for (const g of MISSES) await typeWord(a, g, 120);
  await h.settle(); await a.waitForTimeout(1800);
  let s = await ex();
  assert(s.rounds && s.rounds.length === 1 && s.rounds[0].w === 'b' && s.round === 2, `bo3: round 1 archived, b leads (${JSON.stringify(s)})`);
  for (const pg of [a, b]) assert(await pg.isVisible('.g-wd-actions [data-act="nextround"]'), 'bo3: both phones show the round recap');
  assert(/takes round 1/.test(await sayOf(a)), `recap says who took the round (${await sayOf(a)})`);
  await snap(a, scheme, 'wd2-5-recap');
  assert((await a.textContent('.gm-p-b [data-score="b"]')) === '1', 'bo3: the player chips show round wins');
  await a.tap('[data-act="nextround"]'); await b.tap('[data-act="nextround"]');
  assert(/(Sydney|Emerson) needs this one/.test(await a.textContent('.g-wd-score')), `the scoreboard says who needs the round (${await a.textContent('.g-wd-score')})`);
  await both('plumb', 'grape');
  await typeWord(a, 'grape', 200);
  for (const g of MISSES) await typeWord(b, g, 120);
  await h.settle(); await b.waitForTimeout(1800);
  s = await ex();
  assert(s.rounds.length === 2 && s.rounds[1].w === 'a' && eq(s.wins, { a: 1, b: 1 }), 'bo3: round 2 to a, level 1-1');
  await a.tap('[data-act="nextround"]'); await b.tap('[data-act="nextround"]');
  assert(/Winner takes it all/.test(await a.textContent('.g-wd-score')), 'round 3 at 1-1: "Winner takes it all"');
  await both('heart', 'river');
  await typeWord(a, 'river', 150);
  await typeWord(b, 'crane', 120); await typeWord(b, 'heart', 150);
  await h.settle(); await a.waitForTimeout(2600);
  s = await ex();
  const eng = await h.engine(a, id);
  assert(eng.over && s.fin && s.rounds.length === 3 && eng.result.winner === 'a' && /2 to 1/.test(eng.result.sub), `bo3: a takes the set 2 to 1 (${eng.result.sub})`);
  for (const pg of [a, b]) await pg.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 6000 });
  const end = await a.textContent('#game-root .gm-end-head');
  assert(/Emerson/.test(end), `the end card names the set winner (${end})`);
  await a.click('#game-root [data-g="end-look"]');
  await a.waitForTimeout(300);
  assert(await a.evaluate(() => document.querySelectorAll('.g-wd-recap > span').length) === 3, 'the end view recaps all three rounds');
  const d = await dataOf(a);
  assert(d.sets_n === 1 && d.comeback_n === 1, `records: a set and a comeback (${JSON.stringify(d)})`);
  assert(/Comeback/i.test(await a.textContent('.g-wd-stamps')), 'a comeback set earns its stamp');
  await snap(a, scheme, 'wd2-6-bo3-end');
  await h.closeGame(a); await h.closeGame(b);
}

// 3 + 4. one phone: best of 3 handover, B1 (the finishing guess can't be retaken)
async function localFlows(h, scheme) {
  const { a } = h;
  await h.settle();
  await newLocal(h, a);
  assert(await a.isVisible('#game-root .gm-curtain'), 'one phone: curtain before the rules card');
  await reveal(a);
  assert(await a.isVisible('.g-wd-rules'), 'one phone: the rules card shows once, before the first pick');
  await setRules(a, { pool: 'fair', hard: false, dealt: false, bo3: true });
  await a.tap('[data-act="play"]');
  const id = await a.evaluate(() => window.__lastMatchId);
  await typeWord(a, 'plumb', 150);
  await reveal(a);
  assert(!(await a.isVisible('.g-wd-rules')), 'the rules card is not shown again to the second picker');
  await typeWord(a, 'grape', 150);
  await reveal(a);
  await typeWord(a, 'crane', 1400);
  await a.keyboard.type('grape'); await a.keyboard.press('Enter');
  await a.waitForTimeout(300);
  const E1 = await h.engine(a, id);
  assert(E1.state.guesses.a.length === 2 && await a.isVisible('.g-wd-hold-layer'), `B1: the finishing guess is committed at once and shown in the reveal (${JSON.stringify(E1.state.guesses)}, hold ${await a.isVisible('.g-wd-hold-layer')}, ${JSON.stringify(E1.acts)})`);
  await a.waitForTimeout(1600);
  assert((await smallButtons(a)).length === 0, `the reveal's buttons are all 44 px+ (${await smallButtons(a)})`);
  await snap(a, scheme, 'wd2-7-local-hold');
  await a.tap('#game-root [data-g="close"]');
  await a.waitForTimeout(250);
  await reloadInto(h, a, id);
  assert(await a.isVisible('.g-wd-hold-layer') && /Cracked it in 2/.test(await a.textContent('.g-wd-hold-layer .g-wd-say')), 'B1: reopening shows the held result again');
  await a.keyboard.type('plumb'); await a.keyboard.press('Enter'); await a.waitForTimeout(150);
  const E2 = await h.engine(a, id);
  assert(eq(E2.state.guesses.a, ['crane', 'grape']) && E2.state.guesses.b.length === 0, 'B1: nothing can be retaken after reopening (Emerson still has crane, grape)');
  assert(await a.evaluate(() => document.querySelector('#game-root .gm-stage').classList.contains('is-covered')), 'the board underneath stays covered');
  await a.tap('.g-wd-hold-layer [data-act="holddone"]');
  await a.waitForTimeout(100);
  assert(await a.isVisible('#game-root .gm-curtain') && !(await a.isVisible('.g-wd-hold-layer')), 'Done, pass to Sydney: the curtain is next');
  await reveal(a);
  assert(!(await a.isVisible('.g-wd-hold-layer')) && /Crack Emerson/.test(await sayOf(a)), 'Sydney solves Emerson’s word');
  const sy = await a.evaluate(() => document.querySelector('.g-wd-area').innerText.toUpperCase());
  assert(!/CRANE|GRAPE/.test(sy), 'the next player does not see the previous player’s board');
  for (const g of MISSES) await typeWord(a, g, g === MISSES[5] ? 250 : 130);
  await a.waitForTimeout(300);
  assert(await a.isVisible('.g-wd-hold-layer'), 'the round-ending guess is also held in a reveal');
  await a.waitForTimeout(1600);
  assert(/Out of guesses\. It was PLUMB/.test(await a.textContent('.g-wd-hold-layer .g-wd-say')), 'the reveal shows Sydney’s miss');
  const hl = await a.evaluate(() => document.querySelector('.g-wd-hold-layer').innerText.toUpperCase());
  assert(!/GRAPE/.test(hl), 'the reveal never shows the partner’s board');
  await a.tap('.g-wd-hold-layer [data-act="holddone"]');
  await a.waitForTimeout(100);
  assert(await a.isVisible('#game-root .gm-curtain'), 'curtain for the next round’s first picker');
  await reveal(a);
  assert(await a.isVisible('.g-wd-actions [data-act="nextround"]') && /takes round 1/.test(await sayOf(a)), `round recap after the curtain (${await sayOf(a)})`);
  await snap(a, scheme, 'wd2-8-local-recap');
  await a.tap('[data-act="nextround"]');
  assert(/Sydney needs this one/.test(await a.textContent('.g-wd-score')), 'one phone: "Round 2. Sydney needs this one."');
  await typeWord(a, 'heart', 150);
  await reveal(a);
  assert(!(await a.isVisible('.g-wd-actions [data-act="nextround"]')) && await a.isVisible('.g-wd-key[data-k="q"]'), 'the second picker goes straight to picking');
  const E3 = await h.engine(a, id);
  assert(E3.state.rounds.length === 1 && E3.state.round === 2 && E3.state.secret.a === 'heart', 'one phone: round 2 is under way');
  await h.closeGame(a);
}

// 5. landscape
async function landscape(h, scheme) {
  const { a, b } = h;
  const id = await newOnline(h, a);
  await h.openMatch(b, id);
  await h.settle();
  const first = (await h.engine(a, id)).first;
  await ({ a, b })[first].tap('[data-act="play"]');
  await h.settle();
  await a.setViewportSize({ width: 390, height: 664 });
  await typeWord(a, 'plumb', 120); await typeWord(b, 'grape', 120); await h.settle();
  await typeWord(a, 'crane', 1400);
  await a.keyboard.type('sle');
  for (const [w, hh] of [[667, 375], [844, 390], [390, 844], [360, 640]]) {
    await a.setViewportSize({ width: w, height: hh });
    await a.waitForTimeout(250);
    const g = await geometry(a);
    assert(g.kb && g.kb.b <= g.vh && g.kb.t >= 0 && g.enter.b <= g.vh && g.enter.t >= 0 && g.enter.l >= 0 && g.enter.r <= g.vw && g.scroll <= 1 && !g.hscroll, `${w}x${hh}: the keyboard and Enter are inside the viewport, no scroll (${JSON.stringify(g)})`);
    if (w > hh) await snap(a, scheme, `wd2-9-landscape-${w}`);
  }
  await a.setViewportSize({ width: 667, height: 375 });
  await a.waitForTimeout(150);
  assert(await a.evaluate(() => { const bd = document.querySelector('.g-wd-board').getBoundingClientRect(); return bd.height >= 150 && bd.bottom <= innerHeight; }), 'landscape: the board is still a usable size');
  await a.setViewportSize({ width: 390, height: 664 });
  await h.closeGame(a); await h.closeGame(b);
}

// 6. a legacy match (no setup move) still renders and plays out as before; the ledger on the rules card
async function legacy(h, scheme, ids) {
  const { a, b } = h;
  await h.openMatch(a, ids.legacy);
  await h.settle();
  assert(!(await a.isVisible('.g-wd-rules')) && await a.isVisible('.g-wd-key[data-k="q"]') && /Crack Sydney/.test(await sayOf(a)), 'legacy: a v1 match opens straight into play (no rules card)');
  await snap(a, scheme, 'wd2-10-legacy');
  await a.keyboard.type('crane'); await a.keyboard.press('Enter');
  await a.waitForTimeout(1500);
  await h.openMatch(b, ids.legacy);
  await b.keyboard.type('abbey'); await b.keyboard.press('Enter');
  await h.settle(); await b.waitForTimeout(2400);
  const e = await h.engine(a, ids.legacy);
  assert(e.over && !e.state.v && e.result.winner === 'b' && e.result.sub === 'Cracked it in 1 guess, against 2.', `legacy: it finishes with the original result text (${e.result.sub})`);
  assert(/Sydney wins, 1 to 2\./.test(await sayOf(b)), `legacy: the original end line (${await sayOf(b)})`);
  await h.closeGame(a); await h.closeGame(b);
  const id = await newOnline(h, a);
  await h.openMatch(b, id);
  await h.settle();
  const first = (await h.engine(a, id)).first;
  const F = first === 'a' ? a : b;
  const strip = await F.textContent('.g-wd-strip');
  assert(/E 12 – 10 S · Sydney ×4 streak/.test(strip), `the rules card carries the ledger strip, with the legacy match just finished counted (${strip})`);
  assert(await F.getAttribute('[data-rule="pool:love"]', 'aria-pressed') === 'true' && await F.getAttribute('[data-rule="hard"]', 'aria-checked') === 'true', 'the rules card remembers the last choice');
  await snap(F, scheme, 'wd2-11-rules-ledger');
  await F.tap('[data-act="play"]');
  await h.settle();
  const s = (await h.engine(a, id)).state;
  assert(s.opts.pool === 'love' && s.opts.hard && !s.opts.dealt, 'one tap on Play starts with the remembered rules');
  assert(await F.evaluate(() => document.querySelectorAll('.g-wd-chip').length) === 3, 'love mode shows 3 suggestion chips');
  const R = await imp('js/games/wordduel/rules.js');
  await F.tap('[data-act="surprise"]');
  const dr = await F.evaluate(() => [...document.querySelectorAll('.g-wd-row.is-draft .g-wd-tile')].map((x) => x.textContent).join('').toLowerCase());
  assert(R.lists().loveSet.has(dr), `Surprise me draws from the love list (${dr})`);
  await F.tap('[data-act="lock"]');
  await h.settle();
  assert(Object.values((await h.engine(a, id)).state.secret).some((x) => R.lists().loveSet.has(x)), 'a Surprise me pick locks in');
  await h.closeGame(a); await h.closeGame(b);
}

async function uiTests() {
  const now = Date.now();
  const legacyId = 'seedlegacy01';
  const seed = {
    'gamedata/wordduel': { a_wins_n: 12, b_wins_n: 9, matches_n: 21, b_streak: 3, b_streak_best: 3, last_setup: 'love:1:0:0' },
    [`matches/${legacyId}`]: { game: 'wordduel', first: 'a', seed: 4242, by: 'a', created: now - 60000, opts: {}, a: JSON.stringify([{ secret: 'abbey' }, { guess: 'slate' }]), b: JSON.stringify([{ secret: 'crane' }]), ua: 0, ub: 0 },
  };
  for (const scheme of ['light', 'dark']) {
    const light = scheme === 'light';
    const clean = await launch({ port: light ? 9120 : 9121, only: ['wordduel'], colorScheme: scheme, coarse: true });
    try {
      const only = (process.env.ONLY || '').split(',').filter(Boolean);
      const want = (n) => !only.length || only.includes(n);
      if (want('online')) await onlineDealtHard(clean, scheme);
      if (want('away')) await awayPhone(clean, scheme);
      if (light && want('bo3')) await onlineBo3(clean, scheme);
      if (want('local')) await localFlows(clean, scheme);
      if (light && want('land')) await landscape(clean, scheme);
      clean.assertNoErrors();
      console.log(`ok - no page errors (${scheme}, clean data)`);
    } catch (e) { fails++; console.error(e.message, (e.stack || "").split("\n").slice(1, 4).join("\n")); await clean.shot(clean.a, path.join(SHOTS, `fail-${scheme}-a.png`)).catch(() => {}); await clean.shot(clean.b, path.join(SHOTS, `fail-${scheme}-b.png`)).catch(() => {}); console.error('errors:', clean.errors); } finally { await clean.close(); }
    if (process.env.ONLY && !process.env.ONLY.includes('legacy')) continue;
    const seeded = await launch({ port: light ? 9122 : 9123, only: ['wordduel'], colorScheme: scheme, coarse: true, seedDocs: seed });
    try {
      await legacy(seeded, scheme, { legacy: legacyId });
      seeded.assertNoErrors();
      console.log(`ok - no page errors (${scheme}, seeded data)`);
    } catch (e) { fails++; console.error(e.message); await seeded.shot(seeded.a, path.join(SHOTS, `fail-${scheme}-seed-a.png`)).catch(() => {}); console.error('errors:', seeded.errors); } finally { await seeded.close(); }
  }
}

(async () => {
  try { await unitTests(); } catch (e) { console.error(e.message); fails++; }
  if (!process.env.UNIT) {
    try { await uiTests(); } catch (e) { console.error(e.message); fails++; }
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL GOOD');
  process.exitCode = fails ? 1 : 0;
})();
