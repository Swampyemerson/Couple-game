// Double Agents: v1 replay equivalence + v2 rules (unit), then the v2 flows through the real UI.
//   node tools/test/games/words-agents.test.js            (unit tests only: UNIT=1)
//   SHOTS=/some/dir node tools/test/games/words-agents.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'agents-shots');
fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => JSON.parse(JSON.stringify(x));
const throws = (fn, re, msg) => { let e = null; try { fn(); } catch (x) { e = x; } assert(e && re.test(e.message), `${msg} (${e ? e.message : 'no error'})`); };

// deterministic tiny PRNG for the random logs
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function unitTests() {
  const core = await import(pathToFileURL(path.join(ROOT, 'js/games/core.js')).href);
  await import(pathToFileURL(path.join(ROOT, 'js/games/agents.js')).href);
  const { makeV1 } = await import(pathToFileURL(path.join(ROOT, 'tools/test/games/fixtures/agents-v1.mjs')).href);
  const ag = core.gameById('agents');
  const T = ag._test;
  AG = T;
  const v1 = makeV1(core.shuffled, T.NOUNS);
  const mk = (def, first, seed) => { const s = def.init({ first, seed }); s.seed = seed; return s; };
  const run = (moves, first = 'a', seed = 7) => { let s = mk(ag, first, seed); for (const [w, m] of moves) s = ag.apply(clone(s), w, clone(m)); return s; };

  // ── §1 replay equivalence: legacy logs (no setup move) derive the same on the live rules ──
  let steps = 0;
  let invalid = 0;
  const overs = new Set();
  const NLOGS = 360;
  for (let L = 0; L < NLOGS; L++) {
    const r = prng(L * 7919 + 13);
    const seed = L < 4 ? [8, 24, 10645, 31][L] : Math.floor(r() * 2147483646) + 1;
    const first = r() < 0.5 ? 'a' : 'b';
    let sa = mk(v1, first, seed);
    let sb = mk(ag, first, seed);
    assert0(eq(sa, sb), `init matches (seed ${seed})`);
    for (let n = 0; n < 220; n++) {
      const who = r() < 0.85 && !(v1.next(sa).length === 0) ? v1.next(sa)[r() < 0.5 ? 0 : v1.next(sa).length - 1] : r() < 0.5 ? 'a' : 'b';
      const k = r();
      let mv;
      const keyOf = sa.key[sa.giver];
      if (sa.phase === 'clue' && k < 0.55) {
        const lives = sa.words.filter((w, i) => !sa.found[i]);
        const pool = [...['qwerty', 'zigzag', 'jumble', 'velvet', 'whimsy', 'gizmo', 'fjord', 'quartz', 'nimbus', 'pixie'], lives[Math.floor(r() * lives.length)], `${lives[Math.floor(r() * lives.length)]}s`, 'x', 'big cat', 'Café', '', 12, 'a'.repeat(21), lives[0].slice(1), `un${lives[1]}`];
        mv = { clue: pool[Math.floor(r() * pool.length)], n: r() < 0.9 ? 1 + Math.floor(r() * 9) : [0, 10, 1.5, '2', null][Math.floor(r() * 5)] };
      } else if (k < 0.8) {
        // aim at the giver's agents most of the time so logs get long and reach wins
        const live = [...keyOf].map((c, i) => (c === 'G' && !sa.found[i] ? i : -1)).filter((i) => i >= 0);
        const bad = [-1, 25, 1.5, '3', null, 99];
        mv = { pick: r() < 0.7 && live.length ? live[Math.floor(r() * live.length)] : r() < 0.15 ? bad[Math.floor(r() * bad.length)] : Math.floor(r() * 25) };
      } else if (k < 0.9) mv = { stop: true };
      else mv = [{}, null, 'x', { foo: 1 }, { clue: 'qwerty', n: 2, pick: 3 }, { pick: 1, clue: 'x' }][Math.floor(r() * 6)];
      let ra; let rb; let ea = null; let eb = null;
      try { ra = v1.apply(clone(sa), who, clone(mv)); } catch (e) { ea = e.message; }
      try { rb = ag.apply(clone(sb), who, clone(mv)); } catch (e) { eb = e.message; }
      steps++;
      if (ea || eb) invalid++;
      assert0(ea === eb, `same rejection (seed ${seed}, step ${n}, ${JSON.stringify(mv)}): v1 "${ea}" vs live "${eb}"`);
      if (!ea) { sa = ra; sb = rb; }
      assert0(eq(sa, sb), `same state (seed ${seed}, step ${n})`);
      assert0(eq(v1.next(sa), ag.next(sb)), `same next() (seed ${seed}, step ${n})`);
      if (sa.over) { assert0(eq(v1.result(sa), ag.result(sb)), `same result() (seed ${seed})`); overs.add(sa.over); break; }
    }
  }
  assert(steps > 10000 && invalid > 2000 && overs.has('win') && overs.has('burned') && overs.has('time'), `v1 replay equivalence: ${NLOGS} random legacy logs, ${steps} moves (${invalid} rejected), finishes: ${[...overs].join('/')}`);
  // the named seeds from the survey
  assert(T.pickWords(8).includes('doughnut') && T.pickWords(24).includes('cactus'), 'survey seeds still deal the same boards');

  // ── setup ──
  const S = (o = {}) => ({ setup: { v: 2, ...o } });
  let s = run([['a', S({ level: 'spy', pack: 'us' })]]);
  assert(s.v === 2 && s.tokens === 7 && s.pack === 'us' && s.sudden === true && s.level === 'spy' && s.log.length === 0 && eq(ag.next(s), ['a']), 'setup: tier, pack and sudden death are stored; the giver still gives the first clue');
  assert(!eq(s.words, T.pickWords(7)) && eq(s.key, T.makeKeys(7)), 'setup: a pack re-deals the words, the keys stay');
  assert(eq(run([['a', S()]]).words, T.pickWords(7)) && run([['a', S()]]).tokens === 9, 'setup: defaults are agent / classic, and classic is the v1 board');
  for (const [lv, n] of [['rookie', 11], ['agent', 9], ['spy', 7]]) assert(run([['b', S({ level: lv })]], 'b').tokens === n, `tier ${lv} has ${n} tokens`);
  throws(() => run([['b', S()]], 'a'), /first player/, 'setup from the other player is rejected');
  throws(() => run([['a', S()], ['a', S()]]), /already set/, 'a second setup is rejected');
  throws(() => run([['a', S()], ['b', S()]]), /already set/, 'a second setup from the partner also says the rules are already set');
  throws(() => run([['a', { setup: { v: 1 } }]]), /version/, 'setup v must be 2');
  throws(() => run([['a', { setup: {} }]]), /version/, 'setup needs v');
  throws(() => run([['a', S({ level: 'god' })]]), /rookie, agent or spy/, 'unknown level throws');
  throws(() => run([['a', S({ pack: 'nope' })]]), /pack/, 'unknown pack throws');
  throws(() => run([['a', S({ extra: 1 })]]), /Unknown rule/, 'unknown key throws');
  throws(() => run([['a', S({ sudden: 'yes' })]]), /on or off/, 'sudden must be a boolean');
  throws(() => run([['a', { setup: 5 }]]), /didn’t make sense/, 'setup must be an object');
  throws(() => run([['a', { clue: 'qwerty', n: 1 }], ['b', S()]]), /already set/, 'setup is rejected during the first guess');
  s = run([['a', { clue: 'qwerty', n: 1 }], ['b', { pick: [...mk(ag, 'a', 7).key.a].findIndex((c) => c === 'N') }]]);
  throws(() => ag.apply(clone(s), s.giver, S()), /already set/, 'setup is rejected after the first clue');

  // ── packs ──
  const { PACKS, PACK_BREAKS, BREAKS } = T;
  for (const [k, list] of Object.entries(PACKS)) {
    assert(list.length >= 55 && new Set(list).size === list.length && list.every((w) => /^[a-z]{2,8}$/.test(w)), `pack ${k}: ${list.length} distinct a-z words, 2-8 letters`);
    assert(list.every((w) => !list.some((o) => o !== w && w.includes(o))), `pack ${k}: no word inside another`);
    assert(list.filter((w) => w.length >= 7).every((w) => (BREAKS.get(w) || PACK_BREAKS.get(w) || []).join('') === w), `pack ${k}: every 7-8 letter word has a break`);
  }
  assert([...PACK_BREAKS.values()].every(([x, y]) => x.length >= 2 && y.length >= 3), 'pack breaks leave no one- or two-letter lines');
  let packOk = true;
  for (const pk of ['us', 'travel', 'mythic']) {
    for (let seed = 1; seed <= 60; seed++) {
      const ws = T.packWords(seed * 104729, pk);
      const fromPack = ws.filter((w) => PACKS[pk].includes(w)).length;
      const ok = ws.length === 25 && new Set(ws).size === 25 && !ws.some((w, i) => ws.some((o, j) => i !== j && o.includes(w))) && fromPack >= 15 && eq(ws, T.packWords(seed * 104729, pk))
        && ws.every((w) => /^[a-z]{2,8}$/.test(w) && (w.length < 7 || BREAKS.has(w) || PACK_BREAKS.has(w)));
      if (!ok) { packOk = false; console.log('bad pack board', pk, seed, ws); }
    }
  }
  assert(packOk, 'themed boards: 25 unique words, none inside another, ≥15 from the pack, deterministic, breaks present (180 boards)');

  // ── clue checker v2 ──
  const board = (words) => { const st = mk(ag, 'a', 3); st.words = [...words, ...st.words.slice(words.length)]; return st; };
  const bad = (st, c, re = /Too close|on the board/) => throws(() => T.cleanClue2(clone(st), c), re, `v2 refuses "${c}"`);
  const good = (st, c) => assert(T.cleanClue2(clone(st), c) === c.toLowerCase(), `v2 allows "${c}"`);
  let b = board(['doughnut', 'cactus', 'ring', 'watch', 'seahorse', 'dog', 'cherry', 'mouse', 'pajamas', 'kitten', 'bunny', 'child', 'wolf']);
  b.words = b.words.map((w, i) => (i > 12 && ['doughnut', 'cactus', 'ring', 'watch', 'seahorse', 'dog', 'cherry', 'mouse', 'pajamas', 'kitten', 'bunny', 'child', 'wolf'].includes(w) ? `zz${i}` : w));
  for (const c of ['donut', 'donuts', 'cacti', 'cactuses', 'rings', 'ringer', 'dogs', 'cherries', 'mice', 'pyjamas', 'kitty', 'rabbit', 'children', 'wolves', 'RING']) bad(b, c);
  throws(() => T.cleanClue2(clone(b), 'watch'), /WATCH is on the board/, 'the exact board word reads "is on the board"');
  throws(() => T.cleanClue2(clone(b), 'cacti'), /Too close to CACTUS \(same word family\)/, 'the message names the word and why');
  for (const c of ['at', 'an', 'cr', 'sea', 'ear', 'qwerty', 'catalog', 'tick']) good(b, c);
  bad(b, 'seahorses', /Too close to SEAHORSE/);
  // fix round 1: no false rejects, stem collisions gone, dropped-e inflections blocked
  const fb = board(['spa', 'tea', 'bee', 'vow', 'map', 'knight', 'hero', 'plane', 'ring', 'moth', 'cafe', 'hat', 'bat', 'jam', 'new', 'dance', 'cheese', 'run', 'flower']);
  const keep = new Set(['spa', 'tea', 'bee', 'vow', 'map', 'knight', 'hero', 'plane', 'ring', 'moth', 'cafe', 'hat', 'bat', 'jam', 'new', 'dance', 'cheese', 'run', 'flower']);
  fb.words = fb.words.map((w, i) => (i >= 19 && keep.has(w) ? `zz${i}` : w));
  for (const c of ['space', 'spark', 'team', 'teach', 'beer', 'vowel', 'maple', 'night', 'heron', 'planet', 'string', 'mother', 'caves', 'hates', 'bates', 'james', 'news', 'mapped2'.slice(0, 5)]) good(fb, c);
  for (const c of ['dancing', 'dancer', 'danced', 'cheesy', 'running', 'rings', 'ringer', 'ringing', 'spas', 'flowers']) bad(fb, c);
  bad(fb, 'sunflower', /Too close to FLOWER/);
  good(fb, 'seahorse');
  assert(T.cleanClue2(clone(fb), 'sea') === 'sea', 'short fragments stay allowed');
  // the old checker still blocks what it always did, on v1 states
  const st1 = mk(ag, 'a', 3); st1.words = ['doughnut', 'cactus', ...st1.words.slice(2).map((w) => (w === 'donut' || w === 'cacti' ? 'zz' : w))];
  throws(() => T.cleanClue(clone(st1), `${st1.words[5]}s`), /Too close/, 'v1 checker unchanged (plural of a board word)');
  assert(T.cleanClue(clone(st1), 'donut') === 'donut' && T.cleanClue(clone(st1), 'cacti') === 'cacti', 'v1 checker still has its loopholes (frozen on purpose)');
  // v2 through apply
  const w2 = run([['a', S()]]);
  w2.words[0] = 'doughnut';
  throws(() => ag.apply(clone(w2), 'a', { clue: 'donut', n: 1 }), /same word family/, 'apply uses the v2 checker once set up');
  const w1 = run([]);
  w1.words[0] = 'doughnut';
  assert(ag.apply(clone(w1), 'a', { clue: 'donut', n: 1 }).log.length === 1, 'apply keeps the v1 checker without a setup move');

  // ── n + 1 picks ──
  let p = run([['a', S()], ['a', { clue: 'qwerty', n: 1 }]]);
  const ga = (st, w) => [...st.key[w]].map((c, i) => (c === 'G' && !st.found[i] ? i : -1)).filter((i) => i >= 0);
  const bys = (st, w) => [...st.key[w]].map((c, i) => (c === 'N' && !st.found[i] && !st.miss[w].includes(i) ? i : -1)).filter((i) => i >= 0);
  let t1 = ga(p, 'a');
  p = ag.apply(p, 'b', { pick: t1[0] });
  assert(p.phase === 'guess', 'n=1: the first agent leaves the turn open (n + 1 = 2 picks)');
  p = ag.apply(p, 'b', { pick: t1[1] });
  assert(p.phase === 'clue' && p.giver === 'b' && p.turns === 1 && p.found.filter(Boolean).length === 2, 'n=1: the second agent ends the turn automatically');
  let q = run([['a', { clue: 'qwerty', n: 1 }]]);
  q = ag.apply(q, 'b', { pick: ga(q, 'a')[0] });
  q = ag.apply(q, 'b', { pick: ga(q, 'a')[0] });
  assert(q.phase === 'guess', 'v1: no pick limit (the turn stays open)');

  // ── sudden death ──
  // play 'rookie'..'spy' turns with bystander-only guesses until tokens run out
  const burnTurns = (st) => {
    while (!st.over && st.phase !== 'sudden') {
      const g = st.giver; const gu = g === 'a' ? 'b' : 'a';
      st = ag.apply(clone(st), g, { clue: 'qwerty', n: 1 });
      st = ag.apply(clone(st), gu, { pick: bys(st, g)[0] });
    }
    return st;
  };
  let d = burnTurns(run([['a', S({ level: 'spy' })]]));
  assert(d.phase === 'sudden' && d.turns === 7 && !d.over && d.sd.length === 0 && eq(ag.next(d), [d.picker]), 'spy: 7 turns without finishing leads to sudden death');
  const keyOfPicker = d.key[d.picker === 'a' ? 'b' : 'a'];
  assert(agentsLeftT(d, d.picker === 'a' ? 'b' : 'a') > 0, 'the picker is judged on a key that still has agents');
  throws(() => ag.apply(clone(d), d.picker === 'a' ? 'b' : 'a', { pick: 0 }), /partner is picking/, 'sudden death: the other player cannot pick');
  throws(() => ag.apply(clone(d), d.picker, { clue: 'qwerty', n: 1 }), /no clues/, 'sudden death: no clues');
  throws(() => ag.apply(clone(d), d.picker, { stop: true }), /no clues/, 'sudden death: no stop');
  throws(() => ag.apply(clone(d), d.picker, { pick: 30 }), /Pick a card/, 'sudden death: bad card');
  let e1 = ag.apply(clone(d), d.picker, { pick: bys(d, d.picker === 'a' ? 'b' : 'a')[0] });
  assert(e1.over === 'caught' && ag.result(e1).text === 'Caught in sudden death' && /bystander/.test(ag.result(e1).sub) && eq(ag.next(e1), []), 'sudden death: a bystander ends it');
  e1 = ag.apply(clone(d), d.picker, { pick: [...keyOfPicker].indexOf('K') });
  assert(e1.over === 'caught' && /assassin/.test(ag.result(e1).sub), 'sudden death: an assassin ends it');
  // find everything: always pick a real agent for the current picker
  let e2 = clone(d); let flips = 0; let lastPicker = e2.picker;
  while (!e2.over) {
    const pk = e2.picker; const tgt = ga(e2, pk === 'a' ? 'b' : 'a')[0];
    e2 = ag.apply(e2, pk, { pick: tgt });
    if (!e2.over && e2.picker !== lastPicker) flips++;
    lastPicker = e2.picker;
  }
  assert(e2.over === 'win' && e2.sd.length > 0 && flips > 0 && ag.result(e2).sub.includes('sudden death') && ag.result(e2).score === 15, 'sudden death: finding every agent wins; the picker alternates');
  // a picker whose partner has nothing left keeps picking
  let e3 = clone(d);
  while (agentsLeftT(e3, 'a') > 0 && agentsLeftT(e3, 'b') > 0 && !e3.over) { const pk = e3.picker; e3 = ag.apply(e3, pk, { pick: ga(e3, pk === 'a' ? 'b' : 'a')[0] }); }
  if (!e3.over) {
    const pk = e3.picker; const empty = agentsLeftT(e3, 'a') === 0 ? 'a' : 'b';
    assert(pk === empty || agentsLeftT(e3, pk === 'a' ? 'b' : 'a') > 0, 'sudden death: the picker is never stuck on an empty key');
  }
  // no-sudden option: time runs out as before
  d = burnTurns(run([['a', S({ sudden: false })]]));
  assert(d.over === 'time' && ag.result(d).text === 'Out of time', 'sudden: false keeps the cold-trail ending');
  d = burnTurns(run([['a', S({ level: 'rookie' })]]));
  assert(d.turns === 11 && d.phase === 'sudden', 'rookie: 11 turns before sudden death');

  // ── mind meld + stats ──
  let m = run([['a', S()], ['a', { clue: 'qwerty', n: 2 }]]);
  let tg = ga(m, 'a');
  m = ag.apply(m, 'b', { pick: tg[0] });
  m = ag.apply(m, 'b', { pick: tg[1] });
  assert(T.matchStats(m).melds === 0, 'meld is not claimed until the turn ends');
  m = ag.apply(m, 'b', { stop: true });
  assert(T.matchStats(m).melds === 1 && T.matchStats(m).top[0].got === 2, 'exactly n agents, then stop: a mind meld');
  let m2 = run([['a', { clue: 'qwerty', n: 2 }]]);
  m2 = ag.apply(m2, 'b', { pick: ga(m2, 'a')[0] });
  m2 = ag.apply(m2, 'b', { stop: true });
  assert(T.matchStats(m2).melds === 0, 'fewer than n is not a meld');
  m2 = run([['a', { clue: 'qwerty', n: 1 }]]);
  m2 = ag.apply(m2, 'b', { pick: ga(m2, 'a')[0] });
  m2 = ag.apply(m2, 'b', { pick: bys(m2, 'a')[0] });
  assert(T.matchStats(m2).melds === 0, 'a bystander spoils the meld');
  // records
  const rp = T.recordPatch({}, run([['a', S()]]), 'm1');
  assert(rp.missions_n === 1 && rp.streak === 0 && rp.lastm === 'm1' && rp.pack_classic_n === 1, 'recordPatch: a first mission');
  // a won mission on the last token, a streak, bests that only rise, milestones, idempotence
  const won = (turns, sd) => { const w = run([['a', S({ level: 'rookie' })]]); w.over = 'win'; w.turns = turns; w.found = Array(25).fill('a').fill(null, 15); if (sd) w.sd = [{ by: 'a', i: 0, r: 'G' }]; return w; };
  let d1 = {};
  let pw = T.recordPatch(d1, won(11), 'w1');
  assert(pw.wins_n === 1 && pw.streak === 1 && pw.rookie_wins_n === 1 && pw.pack_classic_n === 1 && !('spare_best' in pw) && pw.lastb.includes('last'), 'recordPatch: a win on the very last token earns the stamp, no spare');
  d1 = { ...d1, ...pw };
  pw = T.recordPatch(d1, won(6), 'w2');
  assert(pw.streak === 2 && pw.streak_best === 2 && pw.spare_best === 5 && pw.wins_n === 2 && /record/.test(pw.lastb) && /row2/.test(pw.lastb), 'recordPatch: a streak and a spare best are records');
  d1 = { ...d1, ...pw };
  assert(!('spare_best' in T.recordPatch(d1, won(9), 'w3')) && T.recordPatch(d1, won(9), 'w3').missions_n === 3, 'recordPatch: a lower spare never lowers the best');
  assert(eq(T.recordPatch(d1, won(9), 'w3'), T.recordPatch(d1, won(9), 'w3')), 'recordPatch: the same snapshot gives the same numbers (two phones agree)');
  const lost = run([['a', S()]]); lost.over = 'burned'; lost.hit = 0; lost.found = Array(25).fill(null).fill('a', 0, 12);
  pw = T.recordPatch(d1, lost, 'w4');
  assert(pw.streak === 0 && pw.burned_n === 1 && pw.close_best === 12 && pw.missions_n === 3, 'recordPatch: a loss resets the streak and sets the closest call');
  pw = T.recordPatch({ missions_n: 9 }, won(8, true), 'w5');
  assert(pw.missions_n === 10 && pw.escape_n === 1 && pw.sudden_n === 1 && /ms10/.test(pw.lastb) && /escape/.test(pw.lastb), 'recordPatch: sudden-death escapes and the 10th mission milestone');
}

// ── browser flows ────────────────────────────────────────────────────────
let AG = null;
const keyIdx = (st, w, ch) => [...st.key[w]].map((c, i) => (c === ch && !st.found[i] && !st.miss[w].includes(i) ? i : -1)).filter((i) => i >= 0);
function safeClue(state) {
  const live = state.words.filter((w, i) => !state.found[i]);
  return ['qwerty', 'zigzag', 'jumble', 'velvet', 'whimsy', 'gizmo', 'fjord', 'quartz', 'nimbus', 'pixie'].find((c) => live.every((w) => !w.includes(c) && !c.includes(w)));
}
async function giveClue(pg, clue, n = 2) {
  await pg.fill('.g-ag-input', clue);
  const cur = Number(await pg.textContent('.g-ag-step output'));
  for (let k = cur; k < n; k++) await pg.click('.g-ag-step [data-act="plus"]');
  for (let k = cur; k > n; k--) await pg.click('.g-ag-step [data-act="minus"]');
  await pg.click('.g-ag-form button[type="submit"]');
}
async function pickCard(pg, i, viaButton) {
  await pg.waitForTimeout(430);
  await pg.click(`.g-ag-card[data-i="${i}"]`);
  if (viaButton) await pg.click('.g-ag-dock [data-act="pick"]');
  else { await pg.waitForTimeout(400); await pg.click(`.g-ag-card[data-i="${i}"]`); }
}
async function snap(pg, scheme, name, sizes = [[390, 844]]) {
  for (const [w, hgt] of sizes) {
    await pg.setViewportSize({ width: w, height: hgt });
    await pg.waitForTimeout(120);
    await pg.screenshot({ path: path.join(SHOTS, `${scheme}-${name}-${w}.png`), scale: 'css', animations: 'disabled' });
  }
  await pg.setViewportSize({ width: 390, height: 844 });
}
const retry = async (fn) => { for (let n = 0; ; n++) { try { return await fn(); } catch (e) { if (n >= 2 || !/not attached|detached/i.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 300)); } } };
const newOnline = (h, pg, game) => retry(() => h.newOnlineGame(pg, game));
const stateOf = async (h, pg, id) => (await h.engine(pg, id)).state;

async function v2Online(h, scheme) {
  const { a, b } = h;
  const P = { a, b };
  const id = await newOnline(h, a, 'agents');
  await h.openMatch(b, id);
  await h.settle();
  let s = await stateOf(h, a, id);
  const G = P[s.giver];
  const R = P[s.giver === 'a' ? 'b' : 'a'];
  const g = s.giver;
  const r = g === 'a' ? 'b' : 'a';
  assert(await G.isVisible('.g-ag-play') && !(await G.isVisible('.g-ag-grid .g-ag-card')), 'rules card: the first giver sees the briefing, not the board');
  assert(/Waiting for/.test(await R.textContent('.g-ag-rules')) && !(await R.isVisible('.g-ag-play')), 'rules card: the partner waits for the rules');
  assert(/No missions logged/.test(await G.textContent('.g-ag-ledger')), 'rules card: empty ledger invites the first mission');
  assert(await G.getAttribute('[data-lv="agent"]', 'aria-pressed') === 'true' && await G.getAttribute('[data-pk="classic"]', 'aria-pressed') === 'true', 'rules card: defaults are Agent / Classic');
  const boxes = await G.$$eval('.g-ag-rules button', (bs) => bs.map((x) => x.getBoundingClientRect().height));
  assert(boxes.every((x) => x >= 44), `rules card: every control is at least 44px tall (${Math.min(...boxes)})`);
  await snap(G, scheme, 'v2-1-rules');
  for (const [w, hh] of [[360, 640], [320, 568], [844, 390]]) {
    await G.setViewportSize({ width: w, height: hh });
    await G.waitForTimeout(250);
    const pb = await G.evaluate(() => { const e = document.querySelector('.g-ag-play').getBoundingClientRect(); return { b: e.bottom, t: e.top, ih: innerHeight, h: e.height }; });
    assert(pb.b <= pb.ih && pb.t >= 0 && pb.h >= 44, `rules card ${w}x${hh}: the Play button is fully in view (bottom ${Math.round(pb.b)} of ${pb.ih})`);
  }
  await G.setViewportSize({ width: 390, height: 844 });
  await G.tap('[data-pk="mythic"]');
  await G.tap('[data-lv="spy"]');
  assert(await G.getAttribute('[data-pk="mythic"]', 'aria-pressed') === 'true' && await G.getAttribute('[data-lv="spy"]', 'aria-pressed') === 'true', 'rules card: pack and level selections stick');
  await G.tap('.g-ag-play');
  await h.settle();
  s = await stateOf(h, a, id);
  assert(s.v === 2 && s.tokens === 7 && s.pack === 'mythic' && s.level === 'spy' && s.sudden === true && s.log.length === 0, 'Play sends { setup }: spy, mythic, sudden death on');
  assert(s.words.filter((w) => AG.PACKS.mythic.includes(w)).length >= 15, 'the mythic pack re-dealt the board');
  assert(eq(await stateOf(h, b, id), s), 'both phones derive the same v2 state');
  assert((await G.$$('.g-ag-tokens .g-ag-tok')).length === 7 && (await R.$$('.g-ag-tokens .g-ag-tok')).length === 7, 'the spy level shows 7 tokens');
  assert((await G.$$('.g-ag-card.k-G')).length === 9 && (await R.$$('.g-ag-card')).length === 25, 'then the board shows (giver sees their key)');
  const small = (pg) => pg.evaluate(() => [...document.querySelectorAll('.g-agents button, .g-agents input, .g-agents .gm-btn')].filter((e) => e.offsetParent !== null && !e.classList.contains('g-ag-card')).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.textContent || e.className).trim().slice(0, 14), w: r.width, h: r.height }; }).filter((x) => x.w < 43.5 || x.h < 43.5));
  assert(!(await small(G)).length, `tap targets: every control on the clue form is at least 44px ${JSON.stringify(await small(G))}`);
  // checker v2 through the UI: a plural of a board word is refused with a specific message
  await giveClue(G, `${s.words[0]}s`, 1);
  await G.waitForTimeout(80);
  assert(/Too close to .*same word family|Too close to/.test(await G.evaluate(() => { const t = [...document.querySelectorAll('.toast')]; return t.length ? t[t.length - 1].textContent : ''; })), 'a plural of a board word is refused');
  // turn 1: a mind meld (exactly n agents, then stop)
  await giveClue(G, safeClue(s), 2);
  await h.settle();
  assert(/3 picks left/.test(await R.textContent('.g-ag-slip')), 'the slip counts the picks left (n + 1)');
  // the double-tap guard
  const todo = keyIdx(s, g, 'G');
  await R.waitForTimeout(450);
  await R.evaluate((i) => { const c = document.querySelector(`.g-ag-card[data-i="${i}"]`); c.click(); c.click(); }, todo[0]);
  await h.settle();
  assert((await stateOf(h, a, id)).log[0].picks.length === 0 && await R.$('.g-ag-card.is-sel'), 'a double click within 100 ms selects but does not commit');
  await R.waitForTimeout(400);
  await R.click(`.g-ag-card[data-i="${todo[0]}"]`);
  await h.settle();
  assert((await stateOf(h, a, id)).found[todo[0]] === r, 'a deliberate second tap confirms the pick');
  assert(!(await small(R)).length, `tap targets: every control in the guess view is at least 44px ${JSON.stringify(await small(R))}`);
  // 360x640: the primary actions stay inside the viewport
  for (const pg of [G, R]) await pg.setViewportSize({ width: 360, height: 640 });
  await R.waitForTimeout(250);
  const dockBox = await R.evaluate(() => { const bx = (sel) => { const e = document.querySelector(sel); if (!e) return null; const q = e.getBoundingClientRect(); return { t: q.top, b: q.bottom }; }; return { ih: innerHeight, pick: bx('.g-ag-dock [data-act="pick"]'), stop: bx('.g-ag-dock [data-act="stop"]') }; });
  assert(dockBox.pick && dockBox.stop && dockBox.pick.b <= dockBox.ih && dockBox.stop.b <= dockBox.ih && dockBox.pick.t >= 0, `360x640: Pick and End turn are fully in view (bottom ${Math.round(dockBox.pick.b)} of ${dockBox.ih})`);
  const rows = await R.evaluate(() => { const cs = [...document.querySelectorAll('.g-ag-card')].map((c) => c.getBoundingClientRect()); return { last: Math.max(...cs.map((c) => c.bottom)), dock: document.querySelector('.g-ag-dock').getBoundingClientRect().top }; });
  assert(rows.last <= rows.dock + 1, `360x640: all five board rows sit above the dock (${Math.round(rows.last)} <= ${Math.round(rows.dock)})`);
  await snap(R, scheme, 'v2-2-guess-360', [[360, 640]]);
  // landscape phone: the whole board and the Pick button fit, no sideways scroll
  for (const [w, hh] of [[844, 390], [667, 375]]) {
    for (const pg of [G, R]) await pg.setViewportSize({ width: w, height: hh });
    await R.waitForTimeout(300);
    const L = await R.evaluate(() => { const cs = [...document.querySelectorAll('.g-ag-card')].map((c) => c.getBoundingClientRect()); const pk = document.querySelector('[data-act="pick"]').getBoundingClientRect(); return { last: Math.max(...cs.map((c) => c.bottom)), right: Math.max(...cs.map((c) => c.right)), pickB: pk.bottom, pickR: pk.right, ih: innerHeight, iw: innerWidth, sw: document.documentElement.scrollWidth, rsw: document.querySelector('#game-root').scrollWidth, rcw: document.querySelector('#game-root').clientWidth, slip: document.querySelector('.g-ag-slip').getBoundingClientRect() }; });
    assert(L.last <= L.ih && L.pickB <= L.ih && L.pickR <= L.iw && L.sw <= L.iw && L.rsw <= L.rcw + 1 && L.slip.bottom <= L.ih, `landscape ${w}x${hh}: board, slip and Pick are inside the viewport, no sideways scroll (${JSON.stringify({ last: Math.round(L.last), pickB: Math.round(L.pickB), ih: L.ih })})`);
    if (w === 844) await snap(R, scheme, 'v2-2-guess-landscape', [[844, 390]]);
  }
  for (const pg of [G, R]) await pg.setViewportSize({ width: 360, height: 640 });
  await R.waitForTimeout(250);
  for (const pg of [G, R]) await pg.setViewportSize({ width: 390, height: 844 });
  await pickCard(R, todo[1], true);
  await h.settle();
  assert(/1 pick left/.test(await R.textContent('.g-ag-slip')), 'one pick left after two agents');
  await R.waitForTimeout(450);
  await R.click('.g-ag-dock [data-act="stop"]');
  await h.settle();
  s = await stateOf(h, a, id);
  assert(s.giver === r && s.phase === 'clue' && AG.matchStats(s).melds === 1, 'two for two then stop is a mind meld');
  for (const pg of [G, R]) assert(await pg.isVisible('.g-ag-banner') && /Mind meld/i.test(await pg.textContent('.g-ag-banner')) && /Two for two/.test(await pg.textContent('.g-ag-banner')), `mind meld banner on both phones (${pg === G ? 'giver' : 'guesser'})`);
  assert((await G.$$('.g-ag-log li.meld')).length === 1, 'the history marks the mind meld');
  await snap(G, scheme, 'v2-3-meld');
  // turn 2: the other way round, ending on an assassin (burned)
  await giveClue(R, safeClue(s), 1);
  await h.settle();
  s = await stateOf(h, a, id);
  const kill = keyIdx(s, r, 'K')[0];
  await pickCard(G, kill, false);
  await G.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 6000 });
  await G.click('#game-root [data-g="end-look"]');
  assert(await G.isVisible('.g-ag-debrief .g-ag-epi') && (await G.textContent('.g-ag-debrief .g-ag-epi')).length > 10, 'the result view has an epilogue line');
  assert(/MIND MELD/.test(await G.textContent('.g-ag-stamps')), 'the result view stamps the mind meld');
  assert((await G.$$('.g-ag-best .g-ag-paper')).length >= 1, 'the best clue is printed as a slip');
  assert(/1\s*mission(?!s)/.test(await G.textContent('.g-ag-debrief .g-ag-ledger')), 'records: the ledger counts the mission');
  await snap(G, scheme, 'v2-4-end');
  // both phones recorded the same match once: still one mission
  await R.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 6000 });
  await R.click('#game-root [data-g="end-look"]');
  assert(/1\s*mission(?!s)/.test(await R.textContent('.g-ag-debrief .g-ag-ledger')), 'records: the other phone does not double count');
  // rematch: the briefing remembers the last choice
  await G.click('.g-ag-dock [data-g="rematch"]');
  await h.settle();
  await G.waitForTimeout(400);
  const rid = await G.evaluate(() => window.__lastMatchId);
  const rs = await stateOf(h, a, rid);
  const NG = P[rs.giver];
  if (NG !== G) { await h.closeGame(NG); await h.openMatch(NG, rid); }
  await NG.waitForSelector('.g-ag-play', { timeout: 5000 });
  const dm = await NG.evaluate(() => ({ pk: document.querySelector('[data-pk][aria-pressed="true"]')?.dataset.pk, lv: document.querySelector('[data-lv][aria-pressed="true"]')?.dataset.lv }));
  assert(dm.pk === 'mythic' && dm.lv === 'spy', `the rematch briefing remembers the last rules (${JSON.stringify(dm)})`);
  await h.closeGame(G).catch(() => {});
  await h.closeGame(R).catch(() => {});
}

async function suddenOnline(h, scheme) {
  const { a, b } = h;
  const P = { a, b };
  const id = await newOnline(h, a, 'agents');
  await h.openMatch(b, id);
  await h.settle();
  let s = await stateOf(h, a, id);
  await P[s.giver].tap('[data-lv="spy"]');
  await P[s.giver].tap('.g-ag-play');
  await h.settle();
  for (let n = 0; n < 7; n++) {
    s = await stateOf(h, a, id);
    const g = s.giver; const r = g === 'a' ? 'b' : 'a';
    await P[g].waitForSelector('.g-ag-input');
    await giveClue(P[g], safeClue(s), 1);
    await h.settle();
    s = await stateOf(h, a, id);
    if (n === 5) assert(/Last call/.test(await P[r].textContent('.g-ag-say')) && await P[r].$('.g-ag-tok.last'), 'one token left: "Last call." and a pulsing token');
    await pickCard(P[r], keyIdx(s, g, 'N')[0], false);
    await h.settle();
  }
  s = await stateOf(h, a, id);
  assert(s.phase === 'sudden' && !s.over, 'seven spent turns lead to sudden death');
  const pk = s.picker; const wt = pk === 'a' ? 'b' : 'a';
  assert(/no clues, no mistakes/i.test(await P[pk].textContent('.g-ag-say')), 'sudden death: the picker reads "no clues, no mistakes"');
  assert(await P[pk].$('.g-ag-tok.sudden') && await P[wt].$('.g-ag-tok.sudden'), 'sudden death: one pulsing marker replaces the tokens');
  assert(!(await P[pk].$('.g-ag-input')) && !(await P[pk].$('.g-ag-dock [data-act="stop"]')), 'sudden death: no clue form, no End turn');
  assert((await P[wt].$$('.g-ag-card.k-G')).length === 9 - 0 || (await P[wt].$$('.g-ag-card.k-G')).length > 0, 'sudden death: the partner sees their own key being guessed');
  await snap(P[pk], scheme, 'v2-5-sudden');
  // one good pick passes the turn, then a bystander ends it
  const good = keyIdx(s, wt, 'G')[0];
  await pickCard(P[pk], good, true);
  await h.settle();
  s = await stateOf(h, a, id);
  assert(s.found[good] === pk && s.picker === wt && s.sd.length === 1, 'sudden death: an agent is found and the turn passes to the partner');
  const bad = keyIdx(s, pk, 'N')[0];
  await pickCard(P[wt], bad, true);
  await P[wt].waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 6000 });
  s = await stateOf(h, a, id);
  assert(s.over === 'caught' && /Caught in sudden death/.test(await P[wt].textContent('#game-root .gm-end-head')), 'sudden death: a bystander ends the mission');
  await P[wt].click('#game-root [data-g="end-look"]');
  assert(/Caught in sudden death/.test(await P[wt].textContent('.g-ag-say')), 'the board explains the loss');
  await snap(P[wt], scheme, 'v2-6-caught');
  await h.closeGame(P[wt]).catch(() => {});
  await h.closeGame(P[pk]).catch(() => {});
}

const missionsOf = async (pg) => pg.evaluate(() => { try { return Number(JSON.parse(localStorage.getItem('ju.games.data.v1') || '{}').agents?.missions_n) || 0; } catch { return -1; } });
async function recordsReopen(h, scheme) {
  const { a, b } = h;
  // finished matches only show in the hub while their end is "unseen": make them unseen again on demand
  const unsee = async (pg) => {
    if (await pg.isVisible('#game-root [data-g="close"]')) await h.closeGame(pg).catch(() => {});
    await pg.evaluate(() => localStorage.setItem('ju.games.seenEnd.v1', '{}'));
    await pg.reload();
    await pg.waitForFunction(() => !!document.querySelector('.tabbar'), null, { timeout: 15000 });
    await pg.waitForTimeout(500);
  };
  await unsee(a);
  await unsee(b);
  const base = await missionsOf(a);
  // a finished v1 match opened from the hub is never counted
  await h.openMatch(a, 'legacy2');
  await a.waitForTimeout(800);
  assert(await missionsOf(a) === base, 'records: opening a finished legacy v1 match does not count it');
  // a finished v2 match nobody recorded counts once, however often it is reopened, on either phone
  await unsee(a);
  await h.openMatch(a, 'v2done');
  await a.waitForTimeout(800);
  assert(await missionsOf(a) === base + 1, 'records: a finished v2 match nobody recorded counts once');
  await unsee(a);
  await h.openMatch(a, 'v2done');
  await a.waitForTimeout(600);
  await h.settle();
  await unsee(b);
  await h.openMatch(b, 'v2done');
  await b.waitForTimeout(800);
  assert(await missionsOf(a) === base + 1 && await missionsOf(b) === base + 1, `records: reopening it (either phone) does not count it again (${await missionsOf(a)}, ${await missionsOf(b)})`);
  // an earlier match, reopened after newer ones were recorded, neither reverts nor double counts
  await unsee(b);
  await h.openMatch(b, 'legacy1');
  await b.waitForTimeout(600);
  assert(await missionsOf(b) === base + 1, 'records: reopening an older match later changes nothing');
  await h.closeGame(b).catch(() => {});
}

async function legacySeeded(h, scheme) {
  const { a, b } = h;
  const seed = 31;
  const keys = AG.makeKeys(seed);
  const words = AG.pickWords(seed);
  const clue = ['qwerty', 'zigzag', 'jumble'].find((c) => words.every((w) => !w.includes(c) && !c.includes(w)));
  const agent = [...keys.a].indexOf('G');
  await h.openMatch(a, 'legacy1');
  await h.openMatch(b, 'legacy1');
  await h.settle();
  const s = await stateOf(h, a, 'legacy1');
  assert(s.v === undefined && s.tokens === undefined && s.log.length === 1 && s.found[agent] === 'b', 'legacy: a seeded v1 match derives with no v2 fields');
  assert(!(await a.isVisible('.g-ag-play')) && !(await b.isVisible('.g-ag-play')), 'legacy: no rules card once the game is under way');
  assert((await b.$$('.g-ag-tokens .g-ag-tok')).length === 9, 'legacy: nine tokens');
  const kill = [...keys.a].indexOf('K');
  await pickCard(b, kill, false);
  await b.waitForSelector('#game-root .gm-end:not([hidden])', { timeout: 6000 });
  assert(/Burned/.test(await b.textContent('#game-root .gm-end-head')), 'legacy: a v1 match still plays to its ending');
  await b.click('#game-root [data-g="end-look"]');
  assert(await b.isVisible('.g-ag-debrief'), 'legacy: the result view works for v1 matches too');
  await snap(b, scheme, 'v2-7-legacy');
  await h.closeGame(b).catch(() => {});
  await h.closeGame(a).catch(() => {});
}

function agentsLeftT(st, w) { let n = 0; for (let i = 0; i < 25; i++) if (st.key[w][i] === 'G' && !st.found[i]) n++; return n; }
function assert0(c, m) { if (!c) throw new Error('FAIL: ' + m); }

(async () => {
  try { await unitTests(); } catch (e) { console.error(e.stack || e.message); fails++; }
  if (!process.env.UNIT) {
    // seeded legacy match: Emerson (a) already gave a clue, Sydney (b) found one agent
    const seed = 31;
    const keys = AG.makeKeys(seed);
    const words = AG.pickWords(seed);
    const clue = ['qwerty', 'zigzag', 'jumble'].find((c) => words.every((w) => !w.includes(c) && !c.includes(w)));
    const agent = [...keys.a].indexOf('G');
    const kill = [...keys.a].indexOf('K');
    const base = { game: 'agents', first: 'a', seed, by: 'a', created: Date.now(), opts: {}, ua: 1, ub: 1 };
    const seedDocs = {
      'matches/legacy2': { ...base, a: JSON.stringify([{ clue, n: 2 }]), b: JSON.stringify([{ pick: kill }]) },
      'matches/v2done': { ...base, a: JSON.stringify([{ setup: { v: 2 } }, { clue, n: 2 }]), b: JSON.stringify([{ pick: kill }]) },
      'matches/legacy1': { game: 'agents', first: 'a', seed, by: 'a', created: Date.now(), opts: {}, a: JSON.stringify([{ clue, n: 2 }]), b: JSON.stringify([{ pick: agent }]), ua: 1, ub: 1 } };
    for (const scheme of (process.env.SCHEME ? [process.env.SCHEME] : ['light', 'dark'])) {
      const full = scheme === 'light';
      const h = await launch({ port: scheme === 'light' ? 9170 : 9171, only: ['agents'], colorScheme: scheme, coarse: true, seedDocs });
      try {
        await v2Online(h, scheme);
        if (full) await suddenOnline(h, scheme);
        await legacySeeded(h, scheme);
        await recordsReopen(h, scheme);
        h.assertNoErrors();
        console.log(`ok - no page errors (${scheme})`);
      } catch (e) {
        fails++;
        console.error(e.stack || e.message);
        await h.shot(h.a, path.join(SHOTS, `fail-${scheme}-a.png`)).catch(() => {});
        await h.shot(h.b, path.join(SHOTS, `fail-${scheme}-b.png`)).catch(() => {});
        console.error('errors:', h.errors);
      } finally { await h.close(); }
    }
  }
  console.log(fails ? `\n${fails} FAILED` : `\nALL GOOD (screenshots in ${SHOTS})`);
  process.exitCode = fails ? 1 : 0;
})();
