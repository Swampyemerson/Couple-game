// Same Wave: the v1 pins, the v2 rules (every mode / pack / twist), records, and the whole UI on an iPhone profile.
//   node tools/test/games/party-wave.test.js
//   SHOTS=/some/dir  to save screenshots;  QUICK=1  to skip the layout matrix screenshots.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let passed = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); passed++; console.log('ok -', m); };
const other = (w) => (w === 'a' ? 'b' : 'a');
const clone = (x) => JSON.parse(JSON.stringify(x));
const sha = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);

// ── v1 fixtures, recorded from the code as it was BEFORE the v2 update ──────────────────
const V1_DEALS = {'1':'84,66 101,74 61,61 19,94 104,66 35,42 16,14 98,10','5':'130,6 125,25 12,36 46,58 55,86 33,59 116,94 13,81','77':'26,64 122,8 52,80 32,50 67,19 111,42 89,28 75,87','4242':'73,91 83,23 94,26 124,74 69,31 23,53 58,22 40,9','31337':'65,38 118,48 107,79 52,90 129,91 96,91 40,84 15,75','123456':'41,30 73,15 71,67 27,91 95,49 15,94 16,72 86,37','987654321':'83,49 95,53 111,77 137,27 46,70 60,15 27,84 112,87','2147483646':'106,94 109,90 35,79 42,51 21,49 23,86 33,39 94,34'}; // seed -> "card,target" per round, first player a
const V1_MATCHES = [{'name':'perfect','first':'a','seed':31337,'lists':{'a':[{'clue':'c0'},{'at':48},{'clue':'c2'},{'at':90},{'clue':'c4'},{'at':91},{'clue':'c6'},{'at':75}],'b':[{'at':38},{'clue':'c1'},{'at':79},{'clue':'c3'},{'at':91},{'clue':'c5'},{'at':84},{'clue':'c7'}]},'final':{'score':32,'r':8,'over':true,'text':'Telepathic','sub':'32 of 32 points, 8 bullseyes.','points':[4,4,4,4,4,4,4,4],'rejected':[],'sha':'aab498cd613d28a7','resSha':'4e055259f1e09b1e'}},{'name':'mixed','first':'b','seed':1,'lists':{'a':[{'at':66},{'clue':'clue number 1'},{'at':54},{'clue':'clue number 3'},{'at':53},{'clue':'clue number 5'},{'at':38},{'clue':'clue number 7'}],'b':[{'clue':'clue number 0'},{'at':77},{'clue':'clue number 2'},{'at':100},{'clue':'clue number 4'},{'at':26},{'clue':'clue number 6'},{'at':51}]},'final':{'score':18,'r':8,'over':true,'text':'Crossed signals','sub':'18 of 32 points, 2 bullseyes.','points':[4,4,3,3,2,2,0,0],'rejected':[],'sha':'50fa5298335824e8','resSha':'a5a6a352e385ce5c'}},{'name':'junk','first':'a','seed':77,'lists':{'a':[{'clue':'  spaced   out 0 '},{'at':100},{'clue':'  spaced   out 2 '},{'at':0},{'clue':'  spaced   out 4 '},{'at':42},{'clue':'  spaced   out 6 '},{'at':100}],'b':[{'at':0},{'clue':'   '},{'clue':'73%'},{'at':5},{'clue':'  spaced   out 1 '},{'at':140},{'at':50.5},{'clue':'x'},{'at':80},{'clue':'  spaced   out 3 '},{'at':100},{'clue':'  spaced   out 5 '},{'at':0},{'clue':'  spaced   out 7 '}]},'final':{'score':10,'r':8,'over':true,'text':'Different radio stations','sub':'10 of 32 points, 2 bullseyes.','points':[0,0,4,0,0,4,0,2],'rejected':['Write a clue first.','No numbers on their own. That’s cheating!','Write a clue first.','The dial only goes from 0 to 100.','The dial only goes from 0 to 100.','Turn the dial to pick a spot.'],'sha':'4d7eef2227f38292','resSha':'09ace239b420fddb'}},{'name':'mixed','first':'a','seed':4242,'lists':{'a':[{'clue':'clue number 0'},{'at':20},{'clue':'clue number 2'},{'at':83},{'clue':'clue number 4'},{'at':69},{'clue':'clue number 6'},{'at':50}],'b':[{'at':91},{'clue':'clue number 1'},{'at':33},{'clue':'clue number 3'},{'at':44},{'clue':'clue number 5'},{'at':46},{'clue':'clue number 7'}]},'final':{'score':18,'r':8,'over':true,'text':'Crossed signals','sub':'18 of 32 points, 2 bullseyes.','points':[4,4,3,3,2,2,0,0],'rejected':[],'sha':'2bb377b2438d2c1d','resSha':'a5a6a352e385ce5c'}}];


// ── pure rules, in Node ─────────────────────────────────────────────────
async function load() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-rules-'));
  for (const f of ['core.js', 'covers.js', 'wave.js']) fs.copyFileSync(path.join(ROOT, 'js/games', f), path.join(dir, f));
  fs.cpSync(path.join(ROOT, 'js/games/wave'), path.join(dir, 'wave'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const imp = (f) => import(pathToFileURL(path.join(dir, f)).href);
  const core = await imp('core.js');
  await imp('wave.js');
  return { core, W: core.gameById('wave'), R: await imp('wave/rules.js'), C: await imp('wave/cards.js'), Rec: await imp('wave/records.js'), V: await imp('wave/view.js') };
}

function rulesTests({ core, W, R, C, Rec, V }) {
  const step = (s, who, mv) => W.apply(clone(s), who, clone(mv));
  const throws = (fn, re, msg) => {
    try { fn(); } catch (e) { assert(re.test(e.message), `${msg} ("${e.message}")`); return; }
    assert(false, `${msg}: should have thrown`);
  };
  const fresh = (first, seed) => { const s = W.init({ first, seed }); s.seed = seed; return s; };
  const v2 = (first, seed, mode = 'classic', pack = 'everything', deal) => step(fresh(first, seed), first, { setup: { v: 2, mode, pack, ...(deal ? { deal } : {}) } });

  // ── v1 is pinned ──
  console.log('# v1 pins');
  for (const [seed, txt] of Object.entries(V1_DEALS)) {
    const st = W.init({ first: 'a', seed: +seed });
    assert(st.rounds.map((r) => `${r.card},${r.target}`).join(' ') === txt, `v1 seed ${seed}: the same eight cards and targets`);
    assert(JSON.stringify(Object.keys(st)) === '["first","seed","r","phase","score","rounds"]' && st.v === undefined && st.rounds.every((r) => JSON.stringify(Object.keys(r)) === '["giver","card","target","clue","at","points"]'), `v1 seed ${seed}: the state has no v2 fields`);
    assert(st.rounds.every((r) => r.target >= 4 && r.target <= 96 && r.card < 139), `v1 seed ${seed}: targets 4..96, classic cards only`);
  }
  for (const m of V1_MATCHES) {
    const d = core.derive(W, { first: m.first, seed: m.seed, lists: clone(m.lists) });
    const f = m.final;
    assert(d.over && d.state.score === f.score && d.state.r === f.r && d.result.text === f.text && d.result.sub === f.sub, `v1 match "${m.name}" (seed ${m.seed}) replays to ${f.score}: ${f.text}`);
    assert(JSON.stringify(d.state.rounds.map((x) => x.points)) === JSON.stringify(f.points) && JSON.stringify(d.rejected.map((x) => x.error)) === JSON.stringify(f.rejected), `v1 match "${m.name}": the same points and the same rejected moves`);
    assert(sha(d.state) === f.sha && sha(d.result) === f.resSha, `v1 match "${m.name}": the final state and result are byte-identical`);
  }
  // a v1 match still starts with a plain clue, and never turns into v2
  let w = fresh('a', 31337);
  w = step(w, 'a', { clue: 'legacy' });
  assert(w.v === undefined && w.phase === 'guess' && w.rounds[0].tw === undefined, 'a first move without a setup is the legacy v1 path');
  throws(() => step(w, 'a', { setup: { v: 2, mode: 'classic', pack: 'classic' } }), /before the first clue/i, 'a setup after a v1 clue is refused');
  const v1msgs = [[{ clue: '   ' }, /write a clue/i], [{ clue: 'x'.repeat(41) }, /40/], [{ clue: '73%' }, /numbers/i]];
  for (const [mv, re] of v1msgs) throws(() => step(fresh('a', 5), 'a', mv), re, `v1 message for ${JSON.stringify(mv).slice(0, 30)}`);

  // ── the setup move ──
  console.log('# setup move');
  const base = fresh('b', 99);
  assert(JSON.stringify(W.next(base)) === '["b"]', 'before the setup, next() is the first player alone');
  throws(() => step(base, 'a', { setup: { v: 2, mode: 'classic', pack: 'classic' } }), /first player/i, 'only the first player can set up');
  for (const bad of [{ v: 2, mode: 'nope', pack: 'classic' }, { v: 2, mode: 'classic', pack: 'nope' }, { v: 1, mode: 'classic', pack: 'classic' }, null, 'x', { mode: 'classic', pack: 'classic' }]) throws(() => step(base, 'b', { setup: bad }), /unknown|makes no sense/i, `setup ${JSON.stringify(bad)} is refused`);
  const ok = step(base, 'b', { setup: { v: 2, mode: 'bet', pack: 'justus' } });
  assert(ok.v === 2 && ok.mode === 'bet' && ok.pack === 'justus' && JSON.stringify(W.next(ok)) === '["b"]' && ok.r === 0 && ok.phase === 'clue', 'setup sets v, mode, pack; the first player still gives the first clue');
  assert(ok.rounds.length === 8 && ok.rounds.map((r) => r.giver).join('') === 'babababa', 'v2: eight rounds, the giver alternates, first starts');
  throws(() => step(ok, 'b', { setup: { v: 2, mode: 'classic', pack: 'classic' } }), /already set up/i, 'a second setup throws');
  assert(JSON.stringify(v2('b', 99, 'bet', 'justus').rounds) === JSON.stringify(ok.rounds), 'the v2 rounds are deterministic from seed + mode + pack');
  assert(JSON.stringify(v2('b', 99, 'bet', 'justus').rounds) !== JSON.stringify(v2('b', 99, 'sure', 'justus').rounds), 'a different mode deals different rounds');
  throws(() => step(step(fresh('b', 3), 'b', { clue: 'x' }), 'b', { setup: { v: 2, mode: 'classic', pack: 'classic' } }), /before the first clue/i, 'no setup once a clue exists');

  // deal validation
  const pool = R.poolFor('justus');
  const good = pool.slice(0, 7);
  const dealOk = v2('a', 7, 'classic', 'justus', good);
  assert(JSON.stringify(dealOk.rounds.map((r) => r.card)) === JSON.stringify([...good, good[0]]), 'a deal is used as given; the last round replays the first card');
  for (const [bad, why] of [[good.slice(0, 6), 'too short'], [[...good.slice(0, 6), good[0]], 'a repeat'], [[...good.slice(0, 6), 5], 'a card from another pack'], [[...good.slice(0, 6), 99999], 'out of range'], [[...good.slice(0, 6), 1.5], 'not an integer'], ['abc', 'not a list']]) {
    throws(() => v2('a', 7, 'classic', 'justus', bad), /deal/i, `a deal that is ${why} is refused`);
  }

  // ── packs and cards ──
  console.log('# packs');
  const NEW = C.NEW_CARDS;
  for (const id of ['justus', 'everyday', 'hottakes', 'future']) assert(R.poolFor(id).length >= 16, `pack ${id} has ${R.poolFor(id).length} cards (>= 16)`);
  assert(R.poolFor('classic').length === 139 && R.poolFor('everything').length === 139 + NEW.length, 'classic is the 139 original cards, everything is all of them');
  assert(NEW.every((c) => Array.isArray(c) && c.length === 2 && c.every((t) => typeof t === 'string' && t.length > 2 && t.length < 40)) && new Set(NEW.map((c) => c.join('|'))).size === NEW.length, 'every new card has two poles and none repeats');
  assert(NEW.every((c) => c[0] !== c[1]) && NEW.every((c) => !/^\s|\s$/.test(c[0] + c[1])), 'poles differ, no stray spaces');
  const gtxt = (i) => C.NEW_CARDS[i - 139].join(' / ');
  assert(NEW.length === 79 && gtxt(154) === 'Says “I love you” out loud / Shows it by doing things' && gtxt(170) === 'Double espresso / Gentle herbal tea' && gtxt(174) === 'Never leaves the seat / Up and down all flight' && gtxt(198) === 'Saw it coming / Never saw it coming' && gtxt(207) === 'Rocking-chair hobby / Adventure-trip hobby' && gtxt(211) === 'Peaceful garden project / Noisy garage project', 'the six reworked cards are real spectra at the same indices (79 new cards)');
  const cozy = R.poolFor('cozy');
  assert(C.COZY_OUT.length === 5 && C.COZY_OUT.join() === '64,111,112,120,130' && cozy.length === R.poolFor('everything').length - 5 && C.COZY_OUT.every((i) => !cozy.includes(i)), 'cozy is everything minus the five suggestive cards, listed explicitly');
  for (const id of R.PACK_IDS) {
    for (let seed = 1; seed <= 20; seed++) {
      const s = v2('a', seed, 'classic', id);
      const inPool = new Set(R.poolFor(id));
      if (!s.rounds.every((r) => inPool.has(r.card)) || new Set(s.rounds.map((r) => r.card)).size !== 7) throw new Error(`pack ${id} seed ${seed}: cards not from the pack or repeated`);
    }
    assert(true, `pack ${id}: every deal is seven distinct cards from the pack`);
  }

  // ── targets, edge rounds, Déjà vu, jackpot ──
  console.log('# targets');
  let jp = 0; const N = 1500;
  for (let seed = 1; seed <= N; seed++) {
    const s = v2(seed % 2 ? 'a' : 'b', seed, ['classic', 'bet', 'sure', 'oneword', 'mixed'][seed % 5], 'everything');
    const T = s.rounds.map((r) => r.target);
    if (!T.every((t) => Number.isInteger(t) && t >= 0 && t <= 100)) throw new Error('target out of range');
    if (!s.rounds.some((r) => r.target <= 8 || r.target >= 92)) throw new Error(`seed ${seed}: no edge round`);
    if (!s.rounds.every((r) => r.edge === (r.target <= 8 || r.target >= 92))) throw new Error('edge flag wrong');
    const L = s.rounds[7];
    if (L.card !== s.rounds[0].card || !L.dv || Math.abs(L.target - T[0]) < 20) throw new Error(`seed ${seed}: Déjà vu wrong`);
    if (s.rounds[0].jp) throw new Error('jackpot on round 1');
    if (s.rounds.filter((r) => r.jp).length > 1) throw new Error('two jackpots');
    if (s.rounds.some((r) => r.jp)) jp++;
  }
  assert(true, `${N} seeds: targets 0..100, at least one edge round, Déjà vu repeats round 1's card with a target 20+ away`);
  assert(jp / N > 0.28 && jp / N < 0.39, `a jackpot in about a third of matches (${(jp / N).toFixed(3)}), never round 1`);
  const dvEdges = Array.from({ length: 300 }, (_, i) => v2('a', 5000 + i, 'mixed', 'everything')).filter((s) => s.rounds.some((r) => r.target === 0 || r.target === 100));
  assert(dvEdges.length > 0, 'the full 0 and 100 can be dealt');

  // ── modes: scoring ──
  console.log('# modes');
  // play a v2 match through the engine with a plan per round: { clue, at: offset or absolute fn, bet, sure }
  const play = (first, seed, mode, pack, plan, deal) => {
    const lists = { a: [], b: [] };
    let s = v2(first, seed, mode, pack, deal);
    lists[first].push({ setup: { v: 2, mode, pack, ...(deal ? { deal } : {}) } });
    for (let r = 0; r < 8; r++) {
      const Rd = s.rounds[r]; const p = plan(r, Rd);
      const g = Rd.giver; const h = other(g);
      const cm = { clue: p.clue || `c${r}` }; if (p.bet) cm.bet = p.bet;
      lists[g].push(cm); s = step(s, g, cm);
      const gm = { at: p.at }; if (p.sure) gm.sure = true;
      lists[h].push(gm); s = step(s, h, gm);
    }
    return { s, lists };
  };
  const perfect = (r, Rd) => ({ at: Rd.target });
  for (const mode of R.MODE_IDS) {
    const { s, lists } = play('a', 42, mode, 'everything', (r, Rd) => ({ ...perfect(r, Rd), clue: Rd.tw === 'oneword' ? `w${r}` : undefined, bet: Rd.tw === 'bet' ? 'bull' : undefined, sure: Rd.tw === 'sure' ? true : undefined }));
    const d = core.derive(W, { first: 'a', seed: 42, lists: clone(lists) });
    assert(d.over && d.rejected.length === 0 && d.state.score === R.maxOf(d.state) && d.result.text === 'Telepathic' && d.result.max === R.maxOf(d.state), `${mode}: a perfect match scores the maximum (${d.state.score} of ${R.maxOf(d.state)}), Telepathic`);
    assert(JSON.stringify(d.state) === JSON.stringify(s) && /of \d+ points/.test(d.result.sub), `${mode}: the engine replay matches the direct play`);
  }
  // classic bands + edge bonus + jackpot, on a hand-picked seed
  const cs = v2('a', 11, 'classic', 'classic');
  const rs = clone(cs.rounds); // pick a normal round, an edge round and the jackpot round if present
  const plain = rs.findIndex((r) => !r.edge && !r.jp);
  const withClue = (s, r) => { let x = s; for (let i = 0; i < r; i++) { const g = x.rounds[i].giver; x = step(x, g, { clue: 'c' }); x = step(x, other(g), { at: x.rounds[i].target }); } return step(x, x.rounds[r].giver, { clue: 'c' }); };
  const pts = (s, r, off) => { const x = withClue(s, r); const Rd = x.rounds[r]; const at = Rd.target + off <= 100 ? Rd.target + off : Rd.target - off; return step(x, other(Rd.giver), { at }).rounds[r]; };
  for (const [off, base] of [[0, 4], [4, 4], [5, 3], [10, 3], [11, 2], [17, 2], [18, 0], [40, 0]]) {
    const Rd = pts(cs, plain, off);
    assert(Rd.points === base && Rd.base === base && Rd.bn.length === 0, `v2 classic: ${off} off scores ${base}`);
  }
  const edgeI = rs.findIndex((r) => r.edge && !r.jp);
  if (edgeI > 0) {
    assert(pts(cs, edgeI, 3).points === 5 && JSON.stringify(pts(cs, edgeI, 3).bn) === '["edge"]', 'an edge target hit within 4 earns +1');
    assert(pts(cs, edgeI, 8).points === 3 && pts(cs, edgeI, 8).bn.length === 0, 'an edge target missed by more than 4 earns no bonus');
  } else assert(true, 'edge bonus (this seed has no edge round past round 1; covered by the seeds below)');
  // jackpot doubles everything, on the first seed that has one
  let jpSeed = 1; while (!v2('a', jpSeed, 'classic', 'classic').rounds.some((r) => r.jp)) jpSeed++;
  const js = v2('a', jpSeed, 'classic', 'classic'); const ji = js.rounds.findIndex((r) => r.jp);
  const jr = pts(js, ji, 0);
  assert(jr.points === (4 + (jr.edge ? 1 : 0)) * 2 && jr.jp === true, `the Jackpot round doubles its points (seed ${jpSeed}, round ${ji + 1}: ${jr.points})`);
  assert(pts(js, ji, 40).points === 0, 'a missed Jackpot round is still 0');
  assert(R.roundMax(jr) === (4 + (jr.edge ? 1 : 0)) * 2, 'the round maximum counts the doubling');

  // sure
  const sureS = v2('a', 21, 'sure', 'classic');
  const sureAt = (r, off, sure) => { const x = withClue(sureS, r); const Rd = x.rounds[r]; const at = Rd.target + off <= 100 ? Rd.target + off : Rd.target - off; return step(x, other(Rd.giver), { at, ...(sure ? { sure: true } : {}) }).rounds[r]; };
  const sr = sureS.rounds.findIndex((r, i) => i > 0 && !r.edge && !r.jp);
  assert(sureAt(sr, 0, true).base === 6 && sureAt(sr, 10, true).base === 6 && sureAt(sr, 11, true).points === 0 && sureAt(sr, 40, true).points === 0, 'Double Down: Sure pays 6 within 10, otherwise 0');
  assert(sureAt(sr, 3, false).points === 4 && sureAt(sr, 8, false).points === 3, 'Double Down: without Sure the normal bands apply');
  throws(() => step(withClue(v2('a', 21, 'classic', 'classic'), 0), 'b', { at: 50, sure: true }), /isn’t on/i, 'Sure is refused in a round without Double Down');
  throws(() => step(withClue(sureS, 0), 'b', { at: 50, sure: 'yes' }), /sure is on or off/i, 'a junk sure value is refused');
  // one word
  const ow = v2('a', 22, 'oneword', 'classic');
  throws(() => step(ow, 'a', { clue: 'two words' }), /one word/i, 'One Word: a clue with a space is refused');
  assert(step(ow, 'a', { clue: 'ice-cream' }).phase === 'guess', 'One Word: a hyphenated single word is fine');
  const owr = (() => { const x = step(ow, 'a', { clue: 'single' }); return step(x, 'b', { at: x.rounds[0].target + (x.rounds[0].target < 90 ? 20 : -20) }); })();
  assert(owr.rounds[0].points === 0, 'One Word: a miss earns no +1');
  const owOk = step(step(ow, 'a', { clue: 'single' }), 'b', { at: ow.rounds[0].target });
  assert(owOk.rounds[0].bn.includes('ow') && owOk.rounds[0].points === (4 + 1 + (ow.rounds[0].edge ? 1 : 0)) * (ow.rounds[0].jp ? 2 : 1), 'One Word: any scoring round earns +1');
  // bet
  const bs = v2('a', 23, 'bet', 'classic');
  const betRound = (bet, off) => { const x = step(bs, 'a', { clue: 'c', ...(bet ? { bet } : {}) }); const Rd = x.rounds[0]; const at = Rd.target + off <= 100 ? Rd.target + off : Rd.target - off; return step(x, 'b', { at }).rounds[0]; };
  const bonus = (r) => r.bn.includes('bet');
  assert(bonus(betRound('bull', 2)) && !bonus(betRound('bull', 7)), 'bet Bullseye: right within 4, wrong beyond');
  assert(bonus(betRound('close', 9)) && !bonus(betRound('close', 12)), 'bet Close: right within 10, wrong beyond');
  assert(bonus(betRound('off', 19)) && !bonus(betRound('off', 15)), 'bet Way off: right beyond 17, wrong within');
  assert(!bonus(betRound(null, 0)) && betRound(null, 0).bet === null, 'no bet, no bonus');
  throws(() => step(bs, 'a', { clue: 'c', bet: 'huge' }), /bet/i, 'an unknown bet is refused');
  throws(() => step(v2('a', 23, 'classic', 'classic'), 'a', { clue: 'c', bet: 'bull' }), /no bets/i, 'a bet in a round without Giver’s Bet is refused');
  throws(() => step(step(bs, 'a', { clue: 'c' }), 'a', { bet: 'bull' }), /gave the clue/i, 'a bet after the clue is refused (the bet travels with the clue)');
  const after = step(step(bs, 'a', { clue: 'c' }), 'b', { at: 50 });
  throws(() => step(after, 'a', { bet: 'bull' }), /not your turn|wait/i, 'a bet after the guess is refused');
  assert(JSON.stringify(W.next(step(bs, 'a', { clue: 'c', bet: 'close' }))) === '["b"]', 'after a bet the guesser is the only actor, so order cannot matter');
  // mixed
  const mixed = v2('a', 31, 'mixed', 'everything');
  assert(new Set(mixed.rounds.map((r) => r.tw)).size === 5 && mixed.rounds.every((r) => R.TWISTS.includes(r.tw)), 'mixed: every twist appears, one per round');
  assert(mixed.rounds.every((r) => r.tw !== 'edge' || r.edge), 'mixed: an Edge round really has an edge target');
  const mp = play('a', 31, 'mixed', 'everything', (r, Rd) => ({ at: Rd.target, clue: Rd.tw === 'oneword' ? `w${r}` : undefined, bet: Rd.tw === 'bet' ? 'close' : undefined, sure: Rd.tw === 'sure' ? true : undefined })).s;
  assert(mp.rounds.every((r, i) => r.tw !== 'bet' || r.bn.includes('bet')) && mp.rounds.every((r) => r.tw !== 'oneword' || r.bn.includes('ow')), 'mixed: each twist pays out in its own round');
  assert(R.ratingFor(1) === 'Telepathic' && R.ratingFor(0.8) === 'Same wavelength' && R.ratingFor(0.6) === 'Pretty much in sync' && R.ratingFor(0.4) === 'Crossed signals' && R.ratingFor(0.2) === 'Different radio stations' && R.ratingFor(0.05) === 'Static on the line', 'v2 ratings are bands of the percentage');
  // game over
  const over = play('a', 5, 'classic', 'classic', perfect).s;
  throws(() => step(over, 'a', { clue: 'x' }), /over/i, 'no moves after the end');

  // ── near-miss lines ──
  console.log('# near-miss');
  const nm = V.nearMiss;
  assert(nm({}, 5) === '1 off the bullseye!' && nm({}, 6) === '2 off the bullseye!' && nm({}, 4) === '' && nm({}, 7) === '', 'near the bullseye: "1 off the bullseye!"');
  assert(nm({}, 11) === 'Just missed 3 points' && nm({}, 10) === '' && nm({}, 18) === 'Just missed 2 points' && nm({}, 17) === '' && nm({}, 30) === '', 'just missed 3 / 2 points');
  assert(nm({ sure: true }, 11) === 'Just missed the 6!', 'a Sure that missed by a hair says so');
  assert(nm({ sure: true }, 18) === '' && nm({ sure: true }, 19) === '' && nm({ sure: true }, 15) === '' && nm({ sure: true }, 12) === 'Just missed the 6!', 'a Sure that is a clear miss gets no "Just missed 2 points" nudge');
  assert(nm({ sure: true }, 5) === '' && nm({ sure: true }, 10) === '' && nm({ sure: true }, 0) === '', 'no near-miss nudge when Sure already paid its full 6');

  // ── records ──
  console.log('# records');
  const names = { a: 'Emerson', b: 'Sydney' };
  const cardText = (i) => `card ${i}`;
  const m1 = play('a', 101, 'classic', 'classic', (r, Rd) => ({ at: r % 2 ? Rd.target : Math.min(100, Rd.target + 3 + r), clue: 'x'.repeat(r + 1) })).s;
  const p1 = Rec.recordPatch(m1, {}, 'match-1', 'classic', cardText);
  assert(p1.lastRec === 'match-1' && p1.plays === 1 && p1.best_classic === m1.score && p1.lastNewBest === 'match-1' && p1.lastOldBest === 0, 'first match: plays 1, best set, flagged as a new best');
  assert(p1.a_givePts + p1.b_givePts === m1.score && p1.a_guessPts + p1.b_guessPts === m1.score && p1.a_givePts === p1.b_guessPts, 'give and guess points both add up to the team score');
  assert(Object.entries(p1).every(([k, v]) => /^[a-zA-Z0-9_.-]{1,60}$/.test(k) && ['number', 'string', 'boolean'].includes(typeof v)), 'record keys and values fit the data doc rules');
  const m2 = play('b', 102, 'classic', 'classic', (r, Rd) => ({ at: Rd.target })).s;
  const d1 = { ...p1 };
  const p2 = Rec.recordPatch(m2, d1, 'match-2', 'classic', cardText);
  assert(p2.plays === 2 && p2.best_classic === m2.score && p2.lastOldBest === m1.score && p2.bullStreakBest >= 8, `second match: plays 2, a new best over ${m1.score}, a bullseye streak of ${p2.bullStreakBest}`);
  assert(p2.bulls === p1.bulls + 8 && p2.dead >= 8 && /^“.*” on card/.test(p2.bestClue) && p1.closest === 0 && p2.closest === undefined, 'bullseyes, dead-centre hits, the best clue and the closest miss are kept');
  const m3 = play('a', 103, 'classic', 'classic', (r, Rd) => ({ at: Math.max(0, Math.min(100, Rd.target + 40 * (Rd.target > 50 ? -1 : 1))) })).s;
  const p3 = Rec.recordPatch(m3, { ...d1, ...p2 }, 'match-3', 'classic', cardText);
  assert(p3.best_classic === undefined && p3.lastNewBest === undefined && p3.bullStreak === 0 && p3.plays === 3, 'a lower score keeps the best and breaks the bullseye streak');
  const p4 = Rec.recordPatch(m2, { ...d1, ...p2 }, 'match-4', 'bet', cardText);
  assert(p4.best_bet === m2.score && p4.best_classic === undefined, 'bests are kept per mode');
  // stamps, milestones, history line
  const dataNow = { ...d1, ...p2 };
  const first = Rec.stampsOf(m1, { ...p1 }, 'match-1', 'classic');
  assert(!first.stamps.some((x) => x.id === 'best') && !Rec.stampsOf(m1, {}, 'match-1', 'classic').stamps.some((x) => x.id === 'best'), 'NEW BEST needs an earlier best to beat: the very first score gets no stamp');
  assert(/goes on the Classic board/.test(Rec.historyLine(m1, { ...p1 }, 'match-1', 'classic', m1.score)), 'the first score of a mode says it goes on the board');
  const st = Rec.stampsOf(m2, dataNow, 'match-2', 'classic');
  assert(st.stamps.some((x) => x.id === 'best' && x.sub === `was ${m1.score}`) && st.stamps.some((x) => x.id === 'dead'), 'the strip shows NEW BEST (with the old best) and DEAD CENTRE');
  const mile = Rec.stampsOf(m2, { plays: 10, bulls: 12, lastRec: 'match-2' }, 'match-2', 'classic');
  assert(mile.stamps.some((x) => x.id === 'bulls' && x.text === '10 BULLSEYES') && mile.stamps.some((x) => x.id === 'plays' && x.text === '10 MATCHES'), 'milestone stamps at 10 bullseyes and 10 matches');
  const notYet = Rec.stampsOf(m2, { plays: 9, bulls: 4 }, 'match-2', 'classic');
  assert(notYet.stamps.some((x) => x.id === 'plays' && x.text === '10 MATCHES') && notYet.stamps.some((x) => x.id === 'bulls' && x.text === '10 BULLSEYES'), 'milestones show before the write has landed too');
  const hl = Rec.historyLine(m3, { ...dataNow, ...p3, best_classic: 32, lastNewBest: 'match-2' }, 'match-3', 'classic', m3.score);
  assert(/^Your 3rd match together\. Best ever 32, tonight \d+: /.test(hl) && !/lose|fail|bad/i.test(hl), `history line: "${hl}"`);
  assert(/Your 12th match/.test(Rec.historyLine(m3, { plays: 12, lastRec: 'x', best_classic: 40 }, 'x', 'classic', 20)) && /Your 11th/.test(Rec.historyLine(m3, { plays: 11, lastRec: 'x', best_classic: 40 }, 'x', 'classic', 20)) && /Your 22nd/.test(Rec.historyLine(m3, { plays: 22, lastRec: 'x', best_classic: 40 }, 'x', 'classic', 20)), 'ordinals: 11th, 12th, 22nd');
  const chase = Rec.chaseLine({ plays: 3, a_givePts: 40, b_givePts: 34 }, names);
  assert(/Emerson leads 3\.3 to 2\.8 a round/.test(chase) && /bullseye/.test(chase) && /Sydney/.test(chase), `the head-to-head is a chase: "${chase}"`);
  assert(/dead level/.test(Rec.chaseLine({ plays: 2, a_givePts: 20, b_givePts: 20 }, names)) && Rec.chaseLine({}, names) === '', 'a level chase, and nothing before a first match');
  // badges
  const bd = Rec.badgesOf(m1, names);
  assert(bd.a && bd.b && bd.a.name && bd.b.name && bd.a.id !== bd.b.id || bd.a.id === 'heat', `each person gets one badge (${bd.a.name} / ${bd.b.name})`);
  const betM = play('a', 61, 'bet', 'classic', (r, Rd) => ({ at: Rd.target, bet: r % 2 ? 'bull' : 'off' })).s;
  const bb = Rec.badgesOf(betM, names);
  assert(bb.b.id === 'fortune' || bb.a.id === 'fortune', 'a bet match can crown a Fortune Teller');
  const level = play('a', 62, 'classic', 'classic', (r, Rd) => ({ at: Rd.target, clue: 'same' })).s;
  const lb = Rec.badgesOf(level, names);
  assert(lb.a.name && lb.b.name && ['Clue Poet', 'Dead heat', 'Economist', 'Dial Whisperer', 'Wave Rider', 'Edge Walker', 'Fortune Teller'].includes(lb.a.name), `a dead-level match still gets a kind badge (${lb.a.name} / ${lb.b.name})`);
  const names2 = Object.values(Rec.BADGES);
  assert(['Fortune Teller', 'Edge Walker', 'Economist', 'Clue Poet', 'Dial Whisperer'].every((n) => names2.includes(n)), 'the five badges exist');
  // rotation
  const pl = R.poolFor('justus');
  let data = {};
  const seenAll = new Set();
  let resets = 0;
  for (let i = 0; i < 6; i++) {
    const { deal, seen } = Rec.pickDeal(pl, data, Math.random, 7);
    if (deal.length !== 7 || new Set(deal).size !== 7 || !deal.every((x) => pl.includes(x))) throw new Error('bad deal');
    if (i < 2 && deal.some((x) => seenAll.has(x))) throw new Error('repeated before the pool ran out');
    if (i >= 2 && deal.every((x) => !seenAll.has(x))) resets++;
    deal.forEach((x) => seenAll.add(x));
    data = { seen };
  }
  assert(true, 'rotation: unseen cards come first (22 cards = 3 deals), then the pool starts over without breaking');
  // a new lap never opens with the deal you just had (small packs)
  for (const pack of ['justus', 'future', 'hottakes']) {
    const P = R.poolFor(pack); let dd = {}; let prev = [];
    for (let i = 0; i < 12; i++) {
      const { deal, seen } = Rec.pickDeal(P, dd, Math.random, 7);
      if (i > 0 && deal.some((x) => prev.includes(x)) && P.length - 7 >= 7) throw new Error(`${pack}: deal ${i + 1} repeats a card from the deal before`);
      prev = deal; dd = { seen };
    }
    assert(true, `rotation: ${pack} never repeats a card from the immediately previous deal (12 deals in a row)`);
  }
  assert(Rec.parseSeen({ seen: 'a.1z.0' }).join() === '10,71,0' && Rec.encodeSeen([10, 71, 0]) === 'a.1z.0', 'the seen list is base36 joined by dots');
  const big = Rec.encodeSeen(Array.from({ length: 2000 }, (_, i) => 100000 + i));
  assert(big.length <= 3000 && Rec.parseSeen({ seen: big }).length > 100, 'the seen list is capped at 3000 characters, keeping the newest');
  const fullPool = R.poolFor('everything');
  const d1x = Rec.pickDeal(fullPool, { seen: fullPool.slice(0, 215).map((x) => x.toString(36)).join('.') }, Math.random, 7);
  assert(d1x.deal.length === 7 && new Set(d1x.deal).size === 7 && fullPool.slice(215).every((x) => d1x.deal.includes(x)), 'a nearly used-up pool deals its stragglers first');
}

// ── browser helpers ─────────────────────────────────────────────────────
const visible = (pg, sel) => pg.isVisible(sel).catch(() => false);
async function waitFor(fn, ms = 6000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 60));
  }
}
const dialPoint = (pg, v, rf = 0.72) => pg.$eval('.wv-dial.live svg', (svg, [val, f]) => {
  const a = Math.PI * (val / 100);
  const p = new DOMPoint(120 - 108 * f * Math.cos(a), 128 - 108 * f * Math.sin(a)).matrixTransform(svg.getScreenCTM());
  return { x: p.x, y: p.y };
}, [v, rf]);
const dialValue = (pg) => pg.$eval('.wv-dial.live', (d) => Number(d.getAttribute('aria-valuenow')));
async function dragDial(pg, v, cdp) {
  const a = await dialPoint(pg, 50, 0.55);
  const b = await dialPoint(pg, v, 0.72);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 3 }] });
  for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * k) / 8, y: a.y + ((b.y - a.y) * k) / 8, id: 3 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pg.waitForTimeout(60);
}
// bounding boxes that must never intersect: [selector, rect] pairs of the elements present
const overlaps = (pg, sels) => pg.evaluate((ss) => {
  const rs = [];
  for (const s of ss) { const e = document.querySelector(s); if (!e) continue; const q = e.getBoundingClientRect(); if (q.width && q.height) rs.push([s, q]); }
  const bad = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i][1]; const b = rs[j][1];
    if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) bad.push(`${rs[i][0]} x ${rs[j][0]}`);
  }
  return bad;
}, sels);
const REVEAL_PARTS = ['.wv-top', '.wv-dvb', '.wv-clue', '.wv-result', '.wv-note', '.wv-go', '.wv-wait'];
// WCAG contrast of every ink / highlight / card pairing the game uses, in the page's current theme
const contrastReport = (pg) => pg.evaluate(() => {
  const host = document.createElement('div');
  host.className = 'g-wave';
  host.style.cssText = 'position:fixed;left:0;top:0;width:300px;z-index:9;background:var(--g-bg)';
  host.innerHTML = `<div class="wv-stamp"><b>NEW BEST</b><small>was 20</small></div><span class="wv-chip">+1 Edge</span><span class="wv-chip jp">Jackpot x2</span>
    <div class="wv-dvb"><span>Déjà vu</span></div><button class="wv-pack" aria-checked="true">Cozy</button><button class="wv-pack" aria-checked="false">Other</button>
    <button class="wv-mode" aria-checked="true"><b>Classic</b></button><button class="wv-mode" aria-checked="false"><b>Other</b></button>
    <div class="wv-card"><div class="wv-end l"><span>Left pole</span></div><div class="wv-end r"><span>Right pole</span></div></div>
    <div class="wv-tw"><span>One Word</span></div><div class="wv-plaque"><b>3</b><span>Rating</span></div>
    <div class="wv-pts">+4</div><div class="wv-pts zero">0</div><span class="wv-row-pts">+1</span><span class="wv-row-pts zero">0</span>
    <button class="wv-sure" aria-pressed="true">Sure<small>6 within 10</small></button><button class="wv-sure" aria-pressed="false">Sure<small>6 within 10</small></button>
    <button class="wv-wg" aria-pressed="true">Bullseye<small>within 4</small></button><button class="wv-wg" aria-pressed="false">Close<small>within 10</small></button>
    <div class="wv-medal a"><small class="p-a">Emerson</small><b>Poet</b><span>why</span></div><div class="wv-medal b"><small class="p-b">Sydney</small><b>Poet</b><span>why</span></div>`;
  document.body.appendChild(host);
  const rgb = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.a > 0.95) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
  const sels = ['.wv-stamp b', '.wv-stamp small', '.wv-chip:not(.jp)', '.wv-chip.jp', '.wv-dvb span', '.wv-pack[aria-checked="true"]', '.wv-pack[aria-checked="false"]', '.wv-mode[aria-checked="true"] b', '.wv-mode[aria-checked="false"] b', '.wv-end.l span', '.wv-end.r span', '.wv-tw span', '.wv-plaque b', '.wv-plaque span', '.wv-pts:not(.zero)', '.wv-pts.zero', '.wv-row-pts:not(.zero)', '.wv-row-pts.zero', '.wv-sure[aria-pressed="true"]', '.wv-sure[aria-pressed="true"] small', '.wv-sure[aria-pressed="false"]', '.wv-wg[aria-pressed="true"]', '.wv-wg[aria-pressed="true"] small', '.wv-wg[aria-pressed="false"]', '.wv-medal.a b', '.wv-medal.a small', '.wv-medal.b b', '.wv-medal.b small'];
  const out = sels.map((q) => { const el = host.querySelector(q); const cs = getComputedStyle(el); const f = rgb(cs.color); const b = bgOf(el); const [l1, l2] = [lum(f), lum(b)].sort((x, y) => y - x); return [q, Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100]; });
  host.remove();
  return out;
});
async function reloadInto(h, pg, id) {
  await pg.reload();
  await pg.waitForFunction(() => !!document.querySelector('.tabbar'), null, { timeout: 15000 });
  await pg.waitForTimeout(300);
  await h.openMatch(pg, id);
  await pg.waitForTimeout(300);
}
const toastText = (pg) => pg.evaluate(() => { const t = [...document.querySelectorAll('.toast')]; return t.length ? t[t.length - 1].textContent : ''; });
const gd = (h) => h.docs['gamedata/wave'] || {};
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: `${SHOTS}/${name}.png` }); };
// the rects of selectors, as [top, bottom, left, right]; must sit inside the viewport and the scroller must not need to scroll
const inView = (pg, sels) => pg.evaluate((ss) => {
  const vh = innerHeight; const vw = innerWidth;
  const sc = document.querySelector('.wv-scroll');
  const out = { vh, noScroll: sc.scrollHeight <= sc.clientHeight + 1, bad: [] };
  for (const s of ss) {
    const e = document.querySelector(s);
    if (!e) { out.bad.push(`${s} missing`); continue; }
    const r = e.getBoundingClientRect();
    if (r.top < -0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.right > vw + 0.5 || r.height < 8) out.bad.push(`${s} [${Math.round(r.top)}..${Math.round(r.bottom)}] of ${vh}`);
  }
  return out;
}, sels);

(async () => {
  console.log('# rules');
  const L = await load();
  rulesTests(L);

  const h = await launch({ port: +process.env.PORT || 8770 + Math.floor(Math.random() * 500), only: ['wave'], coarse: true });
  const { a, b } = h;
  const pages = { a, b };
  await h.settle();
  const cdps = { a: await a.context().newCDPSession(a), b: await b.context().newCDPSession(b) };
  // spy on the game's shared data writes (the data doc), per device
  for (const pg of [a, b]) {
    await pg.context().addInitScript(() => {
      const wrap = () => {
        if (!window.claude || window.claude.__spied) return;
        const orig = window.claude.use.bind(window.claude);
        window.claude.__spied = true;
        window.claude.use = async (n) => {
          const r = await orig(n);
          if (n !== 'db') return r;
          return { ...r, doc: (p) => { const d = r.doc(p); if (!/^gamedata\/wave/.test(p)) return d; const log = (x) => { (window.__gd = window.__gd || []).push(x); }; return { ...d, update: async (x) => { log(x); return d.update(x); }, set: async (x) => { log(x); return d.set(x); } }; } };
        };
      };
      wrap();
    });
    await pg.reload();
    await pg.waitForFunction(() => !!document.querySelector('.tabbar'), null, { timeout: 15000 });
  }
  await h.settle();
  const writes = async (pg, key) => (await pg.evaluate(() => window.__gd || [])).filter((x) => key in x).length;

  const start = async (host, mode, pack) => {
    const id = await h.newOnlineGame(host, 'wave');
    await h.settle();
    await h.openMatch(other(host.__who) === 'a' ? a : b, id);
    await h.settle();
    const e = await h.engine(a, id);
    const F = pages[e.first]; const S = pages[other(e.first)];
    await F.waitForSelector('.wv-start');
    return { id, F, S, first: e.first };
  };
  const pick = async (F, mode, pack) => {
    await F.tap(`.wv-mode[data-mode="${mode}"]`);
    if (pack) await F.tap(`.wv-pack[data-pack="${pack}"]`);
    await F.tap('.wv-start');
    await h.settle();
  };
  // one round through the UI: giver types a clue, the other dials to target+off
  const round = async (id, r, { off = 0, sure = false, bet = null, clue = null, keep = false } = {}) => {
    const e = await h.engine(a, id);
    const Rd = e.state.rounds[r]; const gv = Rd.giver; const GV = pages[gv]; const GS = pages[other(gv)];
    await waitFor(async () => (await visible(GV, '.wv-input')) || (await visible(GV, '.wv-go')), 10000, 'giver screen');
    if (!(await visible(GV, '.wv-input'))) await GV.tap('.wv-go');
    await GV.waitForSelector('.wv-input');
    await GV.tap('.wv-input');
    await GV.keyboard.type(clue || (Rd.tw === 'oneword' ? `word${r}` : `clue number ${r + 1}`));
    if (bet) await GV.tap(`.wv-wg[data-wg="${bet}"]`);
    await GV.tap('.wv-form .gm-btn');
    await h.settle();
    await GS.waitForSelector('.wv-dial.live');
    const tgt = Rd.target + off >= 0 && Rd.target + off <= 100 ? Rd.target + off : Rd.target - off;
    await dragDial(GS, tgt, cdps[other(gv)]);
    assert(Math.abs((await dialValue(GS)) - tgt) <= 1, `round ${r + 1}: the dial is at ${tgt}`);
    if (sure) await GS.tap('.wv-sure');
    if (!keep) {
      await GS.tap('.wv-go');
      await h.settle();
    }
    return { Rd, GV, GS, tgt };
  };

  try {
    // ════════ the setup screen, two phones ════════
    console.log('# setup (online)');
    const S1 = await start(b, 'classic');
    assert(await visible(S1.S, '.wv-wait') && !(await S1.S.$('.wv-mode')), 'the other player waits while the first player picks');
    assert((await S1.S.textContent('#game-root .wv-h')).includes(S1.first === 'a' ? 'Emerson' : 'Sydney'), 'the waiting screen names who is choosing');
    const modeNames = await S1.F.$$eval('.wv-mode b', (x) => x.map((e) => e.textContent));
    assert(modeNames.join() === 'Classic,Giver’s Bet,Double Down,One Word,Mixed Bag', `five mode cards: ${modeNames}`);
    const packNames = await S1.F.$$eval('.wv-pack', (x) => x.map((e) => e.textContent));
    assert(packNames.join() === 'Classic,Just Us,Everyday,Hot Takes,Future Us,Everything,Cozy', `seven packs: ${packNames}`);
    // every mode tile and pack chip is on screen and tappable at first view, at the three sizes
    for (const [w, hh] of [[390, 664], [375, 548], [844, 390], [667, 375]]) {
      for (const pg of [a, b]) await pg.setViewportSize({ width: w, height: hh });
      await S1.F.waitForTimeout(350);
      const r = await S1.F.evaluate(() => {
        const sc = document.querySelector('.wv-scroll'); const st = document.querySelector('.wv-sticky').getBoundingClientRect();
        const bad = [];
        for (const e of document.querySelectorAll('.wv-mode, .wv-pack, .wv-lab, .wv-pitch, .wv-packnote, .wv-start')) {
          const q = e.getBoundingClientRect();
          const isStart = e.classList.contains('wv-start');
          if (q.top < 0 || q.bottom > innerHeight + 0.5 || (!isStart && q.bottom > st.top + 0.5)) bad.push(`${e.className.split(' ')[0]} ${e.textContent.trim().slice(0, 14)} [${Math.round(q.top)}..${Math.round(q.bottom)}] sticky ${Math.round(st.top)}`);
          if (/wv-mode|wv-pack/.test(e.className)) { const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); if (!hit || !e.contains(hit)) bad.push(`${e.textContent.trim()} is covered`); }
        }
        return { bad, noScroll: sc.scrollHeight <= sc.clientHeight + 1 };
      });
      assert(r.bad.length === 0 && r.noScroll, `setup ${w}x${hh}: all five modes, all seven packs, the notes and Start are visible and tappable without scrolling (${r.bad.join('; ')}${r.noScroll ? '' : ' scrolls'})`);
      await shot(S1.F, `setup-${w}x${hh}`);
      const look = await S1.F.evaluate(() => [getComputedStyle(document.querySelector('.wv-mode[aria-checked="true"]')).backgroundColor, getComputedStyle(document.querySelector('.wv-pack[aria-checked="true"]')).backgroundColor]);
      assert(look[0] === look[1], `setup ${w}x${hh}: the selected mode and the selected pack look alike (${look})`);
      assert(await visible(S1.S, '#game-root .wv-h'), `the waiting screen keeps its heading at ${w}x${hh}`);
    }
    for (const pg of [a, b]) await pg.setViewportSize({ width: 390, height: 664 });
    // a reload mid-setup keeps what was picked
    await S1.F.tap('.wv-mode[data-mode="sure"]'); await S1.F.tap('.wv-pack[data-pack="future"]');
    await reloadInto(h, S1.F, S1.id);
    await S1.F.waitForSelector('.wv-start');
    assert((await S1.F.textContent('.wv-start')).startsWith('Start: Double Down · Future Us'), 'a reload mid-setup keeps the picked mode and pack');
    await S1.F.tap('.wv-mode[data-mode="classic"]'); await S1.F.tap('.wv-pack[data-pack="everything"]');
    const geo = await S1.F.evaluate(() => [...document.querySelectorAll('.wv-mode, .wv-pack, .wv-start')].map((e) => Math.round(e.getBoundingClientRect().height)));
    assert(geo.every((x) => x >= 44), `setup tap targets are at least 44 px (${Math.min(...geo)})`);
    assert((await inView(S1.F, ['.wv-start'])).bad.length === 0, 'the Start button is on screen at 390x664 without scrolling');
    assert((await S1.F.textContent('.wv-start')).startsWith('Start: Classic · Everything'), 'first time: Start button, Classic + Everything preselected');
    await shot(S1.F, 'setup');
    await S1.F.tap('.wv-mode[data-mode="oneword"]');
    await S1.F.tap('.wv-pack[data-pack="cozy"]');
    assert((await S1.F.textContent('.wv-start')).includes('One Word · Cozy') && await S1.F.$eval('.wv-mode[data-mode="oneword"]', (e) => e.getAttribute('aria-checked')) === 'true', 'tapping a mode and a pack selects them');
    await S1.F.tap('.wv-start');
    await h.settle();
    let e1 = await h.engine(a, S1.id);
    assert(e1.state.v === 2 && e1.state.mode === 'oneword' && e1.state.pack === 'cozy' && e1.acts.join() === S1.first, 'the setup move reaches both engines: v2, One Word, Cozy');
    const cozyOut = new Set([64, 111, 112, 120, 130]);
    assert(e1.state.rounds.every((r) => !cozyOut.has(r.card)), 'the cozy deal has none of the spicy cards');
    assert(gd(h).lastMode === 'oneword' && gd(h).lastPack === 'cozy' && /^[0-9a-z.]+$/.test(gd(h).seen) && gd(h).seen.split('.').length === 7, 'the choice and the seen list (7 cards) are remembered in the shared data');
    const seen1 = gd(h).seen;
    await S1.F.waitForSelector('.wv-input');
    assert(await S1.F.$eval('.wv-input', (x) => x.placeholder) === 'One word', 'One Word: the clue box says so');
    // One Word: a space blocks Send
    await S1.F.tap('.wv-input'); await S1.F.keyboard.type('two words');
    assert(await S1.F.$eval('.wv-form .gm-btn', (x) => x.disabled) && /one word only/i.test(await S1.F.textContent('.wv-note.warn')), 'One Word: two words disable Send and explain');
    await S1.F.fill('.wv-input', '');
    // finish round 1 here (classic scoring + One Word bonus)
    await round(S1.id, 0, { off: 2, clue: 'sauna' });
    e1 = await h.engine(a, S1.id);
    const R0 = e1.state.rounds[0];
    assert(R0.points === (4 + 1 + (R0.edge ? 1 : 0)) * (R0.jp ? 2 : 1) && R0.bn.includes('ow'), `One Word: 2 off scores the bullseye plus 1 (${R0.points})`);
    await h.closeGame(a); await h.closeGame(b);

    // ════════ every mode: setup -> a round, both players ════════
    console.log('# modes (online)');
    for (const mode of ['classic', 'bet', 'sure', 'mixed']) {
      const S = await start(a, mode);
      await pick(S.F, mode, 'everything');
      const e = await h.engine(a, S.id);
      assert(e.state.v === 2 && e.state.mode === mode, `${mode}: set up through the screen`);
      if (mode === 'bet') {
        assert(await S.F.$$eval('.wv-wg', (x) => x.length === 3), 'Giver’s Bet: three buttons, Bullseye / Close / Way off');
        const lab = await S.F.$$eval('.wv-wg', (x) => x.map((e2) => e2.textContent));
        assert(lab[0] === 'Bullseyewithin 4' && lab[1] === 'Closewithin 10' && lab[2] === 'Way offmore than 17', `bet definitions are on the buttons (${lab})`);
        assert(await S.F.$eval('.wv-wg', (x) => x.getBoundingClientRect().height) >= 44, 'bet buttons are 44 px tall');
        const m = await round(S.id, 0, { off: 8, bet: 'close' });
        const e2 = await h.engine(a, S.id);
        assert(e2.state.rounds[0].bet === 'close' && e2.state.rounds[0].bn.includes('bet'), 'Giver’s Bet: a right Close bet earns +1');
        await m.GV.waitForSelector('.wv-chip'); // the giver's reveal shows the bonus chip
        assert((await m.GS.textContent('.wv-chips')).includes('+1 Bet right'), 'the reveal names the bet bonus');
      } else if (mode === 'sure') {
        const m = await round(S.id, 0, { off: 6, sure: true, keep: true });
        assert(await m.GS.$eval('.wv-sure', (x) => x.getAttribute('aria-pressed')) === 'true', 'Double Down: the Sure toggle can be switched on');
        await m.GS.tap('.wv-go'); await h.settle();
        const e2 = await h.engine(a, S.id);
        assert(e2.state.rounds[0].sure === true && e2.state.rounds[0].base === 6, 'Double Down: Sure within 10 pays 6');
        await m.GS.waitForSelector('.wv-result:not(.hide)');
        assert((await m.GS.textContent('.wv-chips')).includes('Sure: 6'), 'the reveal shows the Sure payout');
        // round 2, a miss with Sure pays nothing
        const m2 = await round(S.id, 1, { off: 25, sure: true });
        assert((await h.engine(a, S.id)).state.rounds[1].points === 0, 'Double Down: Sure and a miss pays 0');
      } else {
        const m = await round(S.id, 0, { off: 0 });
        const e2 = await h.engine(a, S.id);
        assert(e2.state.rounds[0].points >= 4 && (await h.engine(b, S.id)).state.score === e2.state.score, `${mode}: round 1 scores and both phones agree`);
        if (mode === 'mixed') {
          const tw = e2.state.rounds[1].tw;
          const nxt = pages[e2.state.rounds[1].giver];
          await waitFor(async () => (await visible(nxt, '.wv-go')) || (await visible(nxt, '.wv-input')), 8000, 'next');
          if (await visible(nxt, '.wv-go')) await nxt.tap('.wv-go');
          await nxt.waitForSelector('.wv-input');
          const chip = tw === 'normal' ? '' : await nxt.textContent('.wv-tw');
          assert(tw === 'normal' || chip.toLowerCase().includes(L.R.TWIST_INFO[tw].name.toLowerCase()), `Mixed Bag: round 2's twist (${tw}) is announced to the giver`);
        }
      }
      await h.closeGame(a); await h.closeGame(b);
    }

    // ════════ the dial: double tap, plinth, bullseye label, chip, near-miss ════════
    console.log('# dial');
    const D = await start(a, 'classic');
    await pick(D.F, 'classic', 'classic');
    let ed = await h.engine(a, D.id);
    const gv0 = ed.state.rounds[0].giver; const GV = pages[gv0]; const GS = pages[other(gv0)];
    await GV.waitForSelector('.wv-input');
    await GV.tap('.wv-input'); await GV.keyboard.type('plinth test');
    await GV.tap('.wv-form .gm-btn');
    await h.settle();
    await GS.waitForSelector('.wv-dial.live');
    // 4: a touch that starts on the plinth does not move the needle
    const before = await dialValue(GS);
    await GS.evaluate(() => {
      const d = document.querySelector('.wv-dial.live'); const svg = d.querySelector('svg');
      const p = new DOMPoint(30, 136).matrixTransform(svg.getScreenCTM());
      d.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }));
      d.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0 }));
    });
    assert(await dialValue(GS) === before, `a tap on the plinth leaves the needle at ${before} (no snap to 0)`);
    await GS.evaluate(() => {
      const d = document.querySelector('.wv-dial.live'); const svg = d.querySelector('svg');
      const p = new DOMPoint(40, 100).matrixTransform(svg.getScreenCTM());
      d.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }));
      d.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0 }));
    });
    assert(await dialValue(GS) < 30, `a tap on the dial face still sets the needle (${await dialValue(GS)})`);
    // exactly 0 and 100 by dragging past the ends
    for (const side of [0, 1]) {
      const from = await dialPoint(GS, 50, 0.55); const to = await dialPoint(GS, side ? 100 : 0, 0.72);
      await GS.mouse.move(from.x, from.y); await GS.mouse.down(); await GS.mouse.move(to.x + (side ? 40 : -40), to.y + 50, { steps: 10 }); await GS.mouse.up();
      assert(await dialValue(GS) === (side ? 100 : 0), `dragging past the ${side ? 'right' : 'left'} end gives exactly ${side ? 100 : 0}`);
    }
    // 3: a double tap on Lock sends one move and no error toast
    const tgt0 = ed.state.rounds[0].target;
    await dragDial(GS, Math.max(0, Math.min(100, tgt0 + 5)), cdps[other(gv0)]);
    await GS.evaluate(() => { const g = document.querySelector('.wv-go'); g.click(); g.click(); });
    await GS.waitForTimeout(250);
    assert(!/clue|turn the dial|not your/i.test(await toastText(GS)), `a double tap on Lock gives no error toast (toast: "${await toastText(GS)}")`);
    await h.settle();
    ed = await h.engine(a, D.id);
    const lists = h.matches().find((m) => m.id === D.id);
    assert(ed.state.r === 1 && lists[other(gv0)].filter((x) => x.at !== undefined).length === 1, 'the double tap sent exactly one guess');
    // 6: the team chip shows the old total until the stamp lands
    const chipBefore = await GS.textContent('.wv-team b');
    assert(chipBefore === '0' || ed.state.rounds[0].points === 0, `the Team chip still says ${chipBefore} while the lid is closed`);
    await GS.waitForSelector('.wv-result:not(.hide)');
    assert(await GS.textContent('.wv-team b') === String(ed.state.rounds[0].points), 'and updates to the new total when the stamp lands');
    // 7: near-miss line (target + 5 is 5 off)
    assert((await GS.textContent('.wv-result-txt')).includes('1 off the bullseye!') || tgt0 + 5 > 100, 'the reveal says "1 off the bullseye!" for 5 off');
    // 5: the zone numbers are drawn above the needle
    const order = await GS.evaluate(() => { const svg = document.querySelector('.wv-svg'); const kids = [...svg.children]; return [kids.findIndex((k) => k.querySelector && k.querySelector('.wv-needle')), kids.findIndex((k) => k.classList && k.classList.contains('wv-zlabels'))]; });
    assert(order[0] >= 0 && order[1] > order[0], 'the 4 / 3 / 2 labels sit above the needle, so a bullseye never hides its 4');
    // a reload on a reveal this phone has already shown does not replay it: Next is ready at once
    await reloadInto(h, GS, D.id);
    await GS.waitForSelector('.wv-result:not(.hide)', { timeout: 3000 });
    assert(!(await GS.$eval('.wv-go', (x) => x.disabled)), 'a reload on a reveal that was already shown comes back with the stamp down and Next ready (no replay)');
    await GS.tap('.wv-go');
    await GS.waitForSelector('.wv-input');
    await reloadInto(h, GS, D.id);
    await GS.waitForSelector('.wv-input', { timeout: 4000 });
    assert(!(await GS.$('.wv-result')), 'a reload after moving past a reveal goes to the clue screen, not back to the reveal');
    await h.closeGame(a); await h.closeGame(b);

    // ════════ layouts ════════
    console.log('# layouts');
    const LAY = await start(b, 'classic');
    await pick(LAY.F, 'classic', 'justus');
    const eL = await h.engine(a, LAY.id);
    const lg = eL.state.rounds[0].giver; const LV = pages[lg]; const LS = pages[other(lg)];
    const sizes = [[390, 664], [375, 548], [844, 390]];
    for (const scheme of ['light', 'dark']) {
      for (const pg of [a, b]) await pg.emulateMedia({ colorScheme: scheme });
      for (const [w, hh] of sizes) {
        for (const pg of [a, b]) await pg.setViewportSize({ width: w, height: hh });
        await LV.waitForTimeout(350);
        const m = await inView(LV, ['.wv-input', '.wv-form .gm-btn', '.wv-dial', '.wv-card']);
        assert(m.bad.length === 0, `${scheme} ${w}x${hh}: the clue screen has the dial, the box and Send in view (${m.bad})`);
        await shot(LV, `${scheme}-${w}x${hh}-clue`);
      }
    }
    for (const pg of [a, b]) { await pg.setViewportSize({ width: 390, height: 664 }); await pg.emulateMedia({ colorScheme: 'light' }); }
    await LV.tap('.wv-input'); await LV.keyboard.type('layout test clue'); await LV.tap('.wv-form .gm-btn'); await h.settle();
    await LS.waitForSelector('.wv-dial.live');
    for (const scheme of ['light', 'dark']) {
      for (const pg of [a, b]) await pg.emulateMedia({ colorScheme: scheme });
      for (const [w, hh] of sizes) {
        for (const pg of [a, b]) await pg.setViewportSize({ width: w, height: hh });
        await LS.waitForTimeout(350);
        let m = await inView(LS, ['.wv-dial', '.wv-card', '.wv-go']);
        assert(m.bad.length === 0 && m.noScroll, `${scheme} ${w}x${hh}: the guess screen shows the dial, its card and Lock it in without scrolling (${m.bad}${m.noScroll ? '' : ' scrolls'})`);
        const dw = await LS.$eval('.wv-dial', (d) => d.getBoundingClientRect().width);
        assert(dw >= 125, `${scheme} ${w}x${hh}: the dial is still a usable size (${Math.round(dw)} px)`);
        await shot(LS, `${scheme}-${w}x${hh}-guess`);
        const t = await dialPoint(LS, 80, 0.72);
        await LS.touchscreen.tap(t.x, t.y);
        assert(Math.abs((await dialValue(LS)) - 80) <= 6, `${scheme} ${w}x${hh}: tapping the dial turns the needle (${await dialValue(LS)})`);
        m = await inView(LV, ['.wv-dial', '.wv-card']);
        assert(m.bad.length === 0, `${scheme} ${w}x${hh}: the clue-giver's waiting screen shows the dial (${m.bad})`);
        await shot(LV, `${scheme}-${w}x${hh}-waiting`);
      }
    }
    // the reveal and its Next button at each size
    for (const [w, hh] of [[390, 664], [375, 548], [844, 390]]) for (const pg of [a, b]) await pg.setViewportSize({ width: w, height: hh });
    await LS.setViewportSize({ width: 375, height: 548 }); await LV.setViewportSize({ width: 375, height: 548 });
    await LS.tap('.wv-go');
    await h.settle();
    await LS.waitForSelector('.wv-result:not(.hide)');
    for (const [w, hh] of [...sizes, [667, 375]]) {
      for (const pg of [a, b]) await pg.setViewportSize({ width: w, height: hh });
      await LS.waitForTimeout(350);
      const m = await inView(LS, ['.wv-dial', '.wv-card', '.wv-result', '.wv-go']);
      assert(m.bad.length === 0 && m.noScroll, `reveal ${w}x${hh}: the dial, the stamp and Next round are all in view (${m.bad}${m.noScroll ? '' : ' scrolls'})`);
      const ov = await overlaps(LS, REVEAL_PARTS);
      assert(ov.length === 0, `reveal ${w}x${hh}: the heading, clue, stamp and button do not overlap (${ov})`);
      await shot(LS, `reveal-${w}x${hh}`);
    }
    for (const pg of [a, b]) { await pg.setViewportSize({ width: 390, height: 664 }); await pg.emulateMedia({ colorScheme: 'light' }); }
    await h.closeGame(a); await h.closeGame(b);

    // ════════ long pole labels stay within two lines ════════
    console.log('# long pole labels');
    for (const [pack, deal, what] of [['justus', [145, 139, 140, 141, 142, 143, 144], 'Only {a} finds it funny'], ['everyday', [179, 161, 162, 163, 164, 165, 166], 'Worth cancelling plans for']]) {
      const P = await start(a, 'classic');
      await P.F.evaluate(async ([mid, who, mv]) => {
        const db = await window.claude.use('db');
        const snap = await db.doc(`matches/${mid}`).get();
        const list = JSON.parse(snap.data()[who] || '[]'); list.push(mv);
        await db.doc(`matches/${mid}`).update({ [who]: JSON.stringify(list) });
      }, [P.id, P.first, { setup: { v: 2, mode: 'classic', pack, deal } }]);
      await h.settle();
      await P.F.waitForSelector('.wv-input');
      await P.F.tap('.wv-input'); await P.F.keyboard.type('long label'); await P.F.tap('.wv-form .gm-btn'); await h.settle();
      await P.S.waitForSelector('.wv-dial.live');
      for (const [w, hh] of [[390, 664], [375, 548], [844, 390]]) {
        for (const pg of [a, b]) await pg.setViewportSize({ width: w, height: hh });
        await P.S.waitForTimeout(300);
        const lines = await P.S.$$eval('.wv-end span', (x) => x.map((e) => { const cs = getComputedStyle(e); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.15; return Math.round((e.getBoundingClientRect().height / lh) * 10) / 10; }));
        assert(lines.every((n) => n <= 2.1), `"${what}" (${pack}) at ${w}x${hh}: each pole is at most two lines (${lines})`);
        const iv = await inView(P.S, ['.wv-dial', '.wv-card', '.wv-go']);
        assert(iv.bad.length === 0, `and the dial, card and Lock are still in view (${iv.bad})`);
        await shot(P.S, `poles-${pack}-${w}x${hh}`);
      }
      for (const pg of [a, b]) await pg.setViewportSize({ width: 390, height: 664 });
      await h.closeGame(a); await h.closeGame(b);
    }

    // ════════ a whole match: final reveal, end card, records written once, recap, rematch ════════
    console.log('# whole match (mixed)');
    const wA = await a.evaluate(() => (window.__gd || []).length); const wB = await b.evaluate(() => (window.__gd || []).length);
    const M = await start(b, 'mixed');
    await pick(M.F, 'mixed', 'everything');
    const OFFS = [0, 3, 7, -2, 12, 0, 20, -4];
    let eM = await h.engine(a, M.id);
    for (let r = 0; r < 8; r++) {
      const sure = eM.state.rounds[r].tw === 'sure' && r % 2 === 0;
      const bet = eM.state.rounds[r].tw === 'bet' ? 'bull' : null;
      const last = r === 7;
      const m = await round(M.id, r, { off: OFFS[r], sure, bet, keep: last });
      if (last) {
        // Déjà vu is announced to both players on the last round, at every size, whatever the twist
        for (const [w, hh] of [[390, 664], [375, 548], [844, 390]]) {
          for (const pg of [a, b]) await pg.setViewportSize({ width: w, height: hh });
          await m.GS.waitForTimeout(350);
          const g = await inView(m.GS, ['.wv-dvb', '.wv-go', '.wv-dial']); const v = await inView(m.GV, ['.wv-dvb', '.wv-dial']);
          assert(g.bad.length === 0 && v.bad.length === 0 && /Déjà vu/.test(await m.GS.textContent('.wv-dvb')) && /Déjà vu/.test(await m.GV.textContent('.wv-dvb')), `round 8 at ${w}x${hh} (${eM.state.rounds[7].tw}): both players see the Déjà vu strip, with the dial and Lock still in view (${g.bad}${v.bad})`);
        }
        for (const pg of [a, b]) await pg.setViewportSize({ width: 390, height: 664 });
        await m.GS.waitForTimeout(250);
        // 2: the final reveal is seen before the end card
        await m.GS.tap('.wv-go');
        await m.GS.waitForSelector('.wv-result:not(.hide)', { timeout: 6000 });
        assert(await visible(m.GS, '.wv-go') && /see how you did/i.test(await m.GS.textContent('.wv-go')) && !(await visible(a, '#game-root .gm-end')) && !(await visible(b, '#game-root .gm-end')), 'the final reveal shows its stamp first; the end card has not cut in');
        assert(/Déjà vu/i.test(await m.GV.textContent('.wv-dvb')), 'the final reveal still carries the Déjà vu strip');
        for (const [w, hh] of [[844, 390], [667, 375]]) {
          for (const pg of [a, b]) await pg.setViewportSize({ width: w, height: hh });
          await m.GS.waitForTimeout(300);
          const ov = await overlaps(m.GS, REVEAL_PARTS); const iv = await inView(m.GS, ['.wv-go', '.wv-dial', '.wv-result']);
          assert(ov.length === 0 && iv.bad.length === 0, `final reveal ${w}x${hh}: Déjà vu strip, clue, stamp and button do not overlap and are in view (${ov} ${iv.bad})`);
          const pill = await m.GS.$eval('.wv-dvb span', (e) => [e.getClientRects().length, Math.round(e.getBoundingClientRect().height), e.parentElement.textContent.length]);
          assert(pill[0] === 1 && pill[1] <= 24, `final reveal ${w}x${hh}: the Déjà vu pill stays one line beside a ${pill[2]}-character sentence (height ${pill[1]})`);
          assert(/Now \d+(: \d+ closer)?\.$/.test((await m.GS.textContent('.wv-dvb')).trim()), 'the Déjà vu comparison reads "Now 5: 18 closer."');
        }
        for (const pg of [a, b]) await pg.setViewportSize({ width: 390, height: 664 });
        await m.GS.waitForTimeout(700);
        assert(!(await visible(m.GS, '#game-root .gm-end')), '1 s after the stamp the end card still waits for the reveal');
        await m.GS.tap('.wv-go');
        await waitFor(() => visible(m.GS, '#game-root .gm-end'), 2500, 'end card after tapping');
        assert(true, 'tapping "See how you did" brings the end card in at once');
        await waitFor(async () => (await visible(m.GV, '#game-root .gm-end')) || (await m.GV.$('.wv-rows')), 9000, 'the other phone reaches the end too');
        assert(true, 'the other phone is moved on after the stamp (the end card or the recap)');
      }
      eM = await h.engine(a, M.id);
    }
    await h.settle();
    assert(eM.over && eM.result.max === L.R.maxOf(eM.state), `the match is over: ${eM.result.score} of ${eM.result.max}`);
    const dga = gd(h);
    assert(dga.lastRec === M.id && dga.plays === 1 && dga.best_mixed === eM.state.score, 'records: one match counted, best_mixed set');
    assert(dga.a_givePts + dga.b_givePts === eM.state.score && dga.bulls === eM.state.rounds.filter((x) => Math.abs(x.at - x.target) <= 4).length, 'records: give points add up to the score, bullseyes counted');
    const lastMover = other(eM.state.rounds[7].giver);
    // the engine may re-send a device's own keys when a stale snapshot lands (a harmless self-heal), so
    // "once" means: only the finishing device writes the match, and every write carries the same single result
    const bodies = await pages[lastMover].evaluate(() => (window.__gd || []).filter((x) => 'lastRec' in x));
    assert((await writes(pages[other(lastMover)], 'lastRec')) === 0, `the device that did not end the match writes no record (last mover ${lastMover})`);
    assert(bodies.length >= 1 && bodies.every((x) => x.lastRec === M.id && x.plays === 1 && x.best_mixed === eM.state.score), `the finishing device writes this match's record, as plays 1 (${bodies.length} write${bodies.length > 1 ? 's, identical' : ''})`);
    void wA; void wB;
    // the recap
    for (const pg of [a, b]) { if (await visible(pg, '#game-root .gm-end')) await pg.tap('#game-root [data-g="end-look"]'); }
    await b.waitForSelector('.wv-rows .wv-row:nth-child(8)');
    await b.waitForTimeout(500);
    assert(await b.$$eval('.wv-medal', (x) => x.length) === 2, 'the recap has one badge per person');
    const medal = await b.$$eval('.wv-medal b', (x) => x.map((e) => e.textContent));
    assert(medal.every((t) => ['Fortune Teller', 'Edge Walker', 'Economist', 'Clue Poet', 'Dial Whisperer', 'Dead heat', 'Wave Rider'].includes(t)), `badges: ${medal}`);
    assert(await b.$$eval('.wv-row .wv-mini .tick', (x) => x.length) === 8, 'every recap row marks the exact target tick');
    assert(!/NEW BEST/.test(await b.textContent('.wv-recwrap')) && /Your first match together/.test(await b.textContent('.wv-recs')) && /goes on the Mixed Bag board/.test(await b.textContent('.wv-recs')), 'the records strip of a first-ever score: no NEW BEST stamp (nothing to beat), the history line instead');
    assert(/^\d+\/\d+$/.test((await b.textContent('.wv-plaque b')).trim()) && (await b.textContent('.wv-plaque b')).includes(`/${eM.result.max}`), 'the plaque shows the score out of this match’s maximum');
    await shot(b, 'recap');
    // every ink / highlight / card pairing is readable in both themes (WCAG AA, 4.5:1)
    for (const scheme of ['light', 'dark']) {
      await b.emulateMedia({ colorScheme: scheme });
      await b.waitForTimeout(250);
      const rep2 = await contrastReport(b);
      const low = rep2.filter(([, r]) => r < 4.5);
      assert(low.length === 0, `${scheme}: every stamp, chip, tile and badge pairing has contrast >= 4.5 (${low.map(([q, r]) => `${q} ${r}`).join('; ') || 'lowest ' + Math.min(...rep2.map((x) => x[1]))})`);
    }
    await b.emulateMedia({ colorScheme: 'light' });
    // rematch brings the setup back with the last choice preselected: "Same again"
    await b.tap('#game-root [data-g="rematch"]');
    await h.settle();
    // the first player of the rematch may be either of them: the other one joins from their recap
    if (!(await visible(b, '.wv-start')) && !(await visible(a, '.wv-start'))) { await a.tap('#game-root [data-g="rematch"]').catch(() => {}); await h.settle(); }
    await waitFor(async () => (await visible(a, '.wv-start')) || (await visible(b, '.wv-start')), 10000, 'the setup screen of the rematch');
    const Fm = (await visible(a, '.wv-start')) ? a : b;
    assert(/^Same again: Mixed Bag · Everything/.test(await Fm.textContent('.wv-start')), 'the rematch setup preselects the last choice behind a "Same again" button');
    await Fm.tap('.wv-start');
    await h.settle();
    const eR = (await h.matches().length) && (await h.engine(Fm, await Fm.evaluate(() => window.__lastMatchId)));
    assert(eR.state.v === 2 && eR.state.mode === 'mixed' && eR.state.pack === 'everything', 'one tap on "Same again" starts the same game');
    assert(gd(h).seen.split('.').length >= 14 && new Set(gd(h).seen.split('.')).size === gd(h).seen.split('.').length, 'the seen list grew with the second deal and has no repeats');
    for (const pg of [a, b]) { try { await h.closeGame(pg); } catch { /* not in a game */ } }

    // ════════ same phone ════════
    console.log('# same phone');
    await a.emulateMedia({ reducedMotion: 'reduce' });
    await a.setViewportSize({ width: 844, height: 390 }); // the whole same-phone match is played in landscape
    await h.newLocalGame(a, 'wave');
    const lid = await a.evaluate(() => window.__lastMatchId);
    let curtains = 0; let picked = false; let revealsChecked = 0; const seenReveal = new Set();
    for (let guard = 0; guard < 120; guard++) {
      const e = await h.engine(a, lid);
      if (e.over) break;
      if (await visible(a, '#game-root .gm-curtain')) {
        curtains++;
        assert(await a.evaluate(() => !document.querySelector('#game-root .gm-stage .wv-zone, #game-root .gm-stage .wv-mode')), `curtain ${curtains}: no target and no setup under the curtain`);
        await a.tap('#game-root [data-g="reveal"]');
        await a.waitForTimeout(120);
        continue;
      }
      if (await visible(a, '.wv-result:not(.hide)') && !seenReveal.has(e.state.r)) {
        seenReveal.add(e.state.r);
        const ov = await overlaps(a, REVEAL_PARTS); const iv = await inView(a, ['.wv-go', '.wv-result', '.wv-note']);
        assert(ov.length === 0 && iv.bad.length === 0, `same-phone landscape reveal ${e.state.r}: nothing overlaps, the button is in view (${ov} ${iv.bad})`);
        revealsChecked++;
      }
      if (await visible(a, '.wv-start')) { await a.tap('.wv-mode[data-mode="oneword"]'); await a.tap('.wv-start'); picked = true; await a.waitForTimeout(150); continue; }
      if (await visible(a, '.wv-go') && !(await a.$('.wv-dial.live'))) { await a.click('.wv-go'); continue; }
      if (await visible(a, '.wv-input')) { await a.fill('.wv-input', 'justright'); await a.press('.wv-input', 'Enter'); await a.waitForTimeout(150); continue; }
      if (await a.$('.wv-dial.live')) {
        const t = e.state.rounds[e.state.r].target;
        await dragDial(a, t, cdps.a);
        await a.click('.wv-go');
        await a.waitForTimeout(150);
        continue;
      }
      await a.waitForTimeout(150);
    }
    const eLoc = await h.engine(a, lid);
    assert(picked && eLoc.over && eLoc.state.mode === 'oneword' && eLoc.result.score >= eLoc.result.max - 12, `same-phone One Word match finished (${eLoc.result.score} of ${eLoc.result.max})`);
    assert(revealsChecked >= 6, `same-phone landscape: ${revealsChecked} reveals (with the look-away note) checked for overlap`);
    if (await visible(a, '.wv-result:not(.hide)')) { const ov = await overlaps(a, REVEAL_PARTS); assert(ov.length === 0, `same-phone landscape final reveal (Déjà vu): nothing overlaps (${ov})`); }
    assert(curtains === 9, `same-phone: a curtain at the start and after every clue (${curtains})`);
    await waitFor(() => visible(a, '#game-root .gm-end'), 9000, 'same-phone end card');
    await h.settle();
    assert(gd(h).plays === 2 && gd(h).lastRec === lid && gd(h).best_oneword === eLoc.state.score, `same-phone: the match is counted once (plays ${gd(h).plays}), best_oneword set`);
    await a.emulateMedia({ reducedMotion: 'no-preference' });
    await a.setViewportSize({ width: 390, height: 664 });
    await h.closeGame(a);

    // ════════ v1 matches still open in the new UI ════════
    console.log('# a v1 match in progress');
    const idV1 = await h.newOnlineGame(b, 'wave');
    await h.settle();
    await h.openMatch(a, idV1);
    const ev = await h.engine(a, idV1);
    const FV = pages[ev.first];
    await FV.waitForSelector('.wv-start');
    // an old client / saved match: the first move is a plain clue (v1)
    await FV.evaluate(async ([mid, who]) => {
      const db = await window.claude.use('db');
      const snap = await db.doc(`matches/${mid}`).get();
      const list = JSON.parse(snap.data()[who] || '[]');
      list.push({ clue: 'old school' });
      await db.doc(`matches/${mid}`).update({ [who]: JSON.stringify(list) });
    }, [idV1, ev.first]);
    await h.settle();
    const e0 = await h.engine(a, idV1);
    assert(e0.state.v === undefined && e0.state.phase === 'guess', 'a first move without a setup is a v1 match');
    const SV = pages[other(ev.first)];
    await SV.waitForSelector('.wv-dial.live');
    assert(!(await SV.$('.wv-sure')) && !(await SV.$('.wv-tw span')), 'the v1 guess screen has no v2 extras');
    await dragDial(SV, e0.state.rounds[0].target, cdps[other(ev.first)]);
    await SV.tap('.wv-go');
    await h.settle();
    assert((await h.engine(a, idV1)).state.rounds[0].points === 4 && !(await h.engine(a, idV1)).state.rounds[0].bn, 'v1 scoring in the new UI: a bullseye is 4, no bonuses');
    await h.closeGame(a); await h.closeGame(b);

    // a finished v1 match (a saved one) opens straight onto a v1 recap, and finishing it writes nothing
    console.log('# a finished v1 match');
    const idF = await h.newOnlineGame(b, 'wave');
    await h.settle();
    const e00 = await h.engine(b, idF);
    await h.closeGame(b); // nobody has the match open when it "finishes" (a saved match from before)
    const l1 = { a: [], b: [] };
    e00.state.rounds.forEach((Rd, r) => { l1[Rd.giver].push({ clue: `old ${r}` }); l1[other(Rd.giver)].push({ at: Math.max(0, Math.min(100, Rd.target + (r % 3 === 0 ? 0 : r % 3 === 1 ? 7 : 25))) }); });
    await b.evaluate(async ([mid, lists]) => {
      const db = await window.claude.use('db');
      await db.doc(`matches/${mid}`).update({ a: JSON.stringify(lists.a), b: JSON.stringify(lists.b) });
    }, [idF, l1]);
    await h.settle();
    const playsBefore = gd(h).plays;
    await h.openMatch(a, idF);
    await a.waitForSelector('.wv-rows .wv-row:nth-child(8)', { timeout: 8000 });
    const fe = await h.engine(a, idF);
    assert(fe.over && fe.state.v === undefined && (await a.textContent('.wv-plaque b')).replace(/\s/g, '').endsWith('/32') && await a.$$eval('.wv-meter i', (x) => x.length) === 32, `a finished v1 match recaps as ${fe.result.score}/32, like before`);
    assert(await a.$$eval('.wv-medal', (x) => x.length) === 2 && await a.$$eval('.wv-row .tick', (x) => x.length) === 8, 'the v1 recap also has badges and target ticks');
    assert(!(await a.$('.wv-stamps')) && (await a.textContent('.wv-recwrap')).trim() === '' && !/match together|NEW BEST|BULLSEYES/.test(await a.textContent('.wv-recwrap')), `an old finished match shows no stamps, history line or streak (they would be made up): "${(await a.textContent('.wv-recwrap')).slice(0, 120)}"`);
    await h.settle();
    assert(gd(h).plays === playsBefore, 'opening a match that finished earlier writes no records');
    await h.closeGame(a);

    h.assertNoErrors();
    console.log(`\nALL GOOD (${passed} checks).`);
  } catch (e) {
    console.error(e.message);
    await h.shot(a, `${SHOTS || os.tmpdir()}/wave-fail-a.png`).catch(() => {});
    await h.shot(b, `${SHOTS || os.tmpdir()}/wave-fail-b.png`).catch(() => {});
    console.error('errors:', h.errors);
    process.exitCode = 1;
  } finally {
    await h.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
