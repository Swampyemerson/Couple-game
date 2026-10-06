// Word Duel + Double Agents: rules unit tests, then full games through the real UI on two
// simulated phones (online), one phone (curtain), and screenshots in light and dark.
//   node tools/test/games/words.test.js
//   SHOTS=/some/dir node tools/test/games/words.test.js     (where screenshots go)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'words-shots');
fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── pure rules ───────────────────────────────────────────────────────────
async function unitTests() {
  const core = await import(pathToFileURL(path.join(ROOT, 'js/games/core.js')).href);
  await import(pathToFileURL(path.join(ROOT, 'js/games/wordduel.js')).href);
  await import(pathToFileURL(path.join(ROOT, 'js/games/agents.js')).href);
  const wd = core.gameById('wordduel');
  const ag = core.gameById('agents');
  assert(wd && ag, 'both games register');
  for (const d of [wd, ag]) assert(eq(d.platforms, ['phone', 'computer']) && d.secret && d.kind === 'turns' && d.tags.includes('brainy'), `${d.id}: definition fields`);
  assert(ag.team === true && !wd.team, 'agents is co-op, word duel is versus');

  // Wordle colouring with repeated letters
  const { scoreGuess, lists } = wd._test;
  const cases = [
    ['abbey', 'babes', 'yyggx'], // two b's in each: one exact, one elsewhere
    ['abbey', 'bobby', 'yxgxg'], // three b's guessed, secret has two: the third is grey
    ['abbey', 'abbey', 'ggggg'],
    ['crane', 'eerie', 'xxyxg'], // e exact at the end, the other e's are grey
    ['speed', 'eerie', 'yyxxx'], // two e's in the secret light two guessed e's, the third is grey
    ['llama', 'hello', 'xxyyx'],
    ['robot', 'books', 'ygyxx'], // one o exact, the other o is elsewhere
    ['geese', 'eeeee', 'xggxg'],
  ];
  for (const [s, g, want] of cases) assert(scoreGuess(s, g) === want, `colouring ${g.toUpperCase()} against ${s.toUpperCase()} = ${want}`);
  const { common, valid } = lists();
  assert(common.length >= 2000 && common.length <= 2500, `common word list size ${common.length}`);
  assert(valid.size >= 8000 && valid.size <= 13000, `valid word list size ${valid.size}`);
  assert(common.every((w) => /^[a-z]{5}$/.test(w) && valid.has(w)), 'every common word is a valid 5-letter word');
  for (const w of ['bitch', 'whore', 'pussy', 'nigga', 'fagot', 'chink']) assert(!valid.has(w), `filtered: ${w[0]}…`);
  for (const w of ['fanny', 'horny', 'semen', 'sissy']) assert(!common.includes(w), `not a secret: ${w[0]}…`);
  for (const w of ['slate', 'brine', 'crane', 'babes', 'abbot', 'tabby', 'hobby', 'abbey', 'plumb', 'grape', 'heart']) assert(valid.has(w), `${w} is valid`);
  const fs2 = fs.statSync(path.join(ROOT, 'js/games/wordduel.js')).size;
  assert(fs2 < 110 * 1024, `wordduel.js is ${(fs2 / 1024).toFixed(1)} KB`);

  // Word Duel rules
  const run = (def, moves, setup = { first: 'a', seed: 7 }) => {
    let s = def.init(clone(setup));
    s.seed = setup.seed;
    for (const [w, m] of moves) s = def.apply(clone(s), w, clone(m));
    return s;
  };
  const throws = (fn, re, msg) => { let e = null; try { fn(); } catch (x) { e = x; } assert(e && re.test(e.message), `${msg} (${e ? e.message : 'no error'})`); };
  let s = run(wd, []);
  assert(eq(wd.next(s), ['a', 'b']), 'word duel: both pick secrets at once');
  const s1 = run(wd, [['a', { secret: 'abbey' }], ['b', { secret: 'crane' }]]);
  const s2 = run(wd, [['b', { secret: 'crane' }], ['a', { secret: 'abbey' }]]);
  assert(eq(s1, s2), 'word duel: secret order does not matter');
  throws(() => run(wd, [['a', { secret: 'qqqqq' }]]), /isn’t in the word list/, 'rejects a secret that is not a word');
  throws(() => run(wd, [['a', { secret: 'cat' }]]), /Five letters/, 'rejects a short secret');
  throws(() => run(wd, [['a', { secret: 'abbey' }], ['a', { guess: 'crane' }]]), /Wait for your partner/, 'no guessing before the partner picks');
  throws(() => run(wd, [['a', { secret: 'abbey' }], ['b', { secret: 'crane' }], ['a', { guess: 'zzzzz' }]]), /isn’t in the word list/, 'rejects a guess that is not a word');
  throws(() => run(wd, [['a', { secret: 'abbey' }], ['b', { secret: 'crane' }], ['a', { guess: 'slate' }], ['a', { guess: 'slate' }]]), /already tried/, 'rejects a repeated guess');
  s = run(wd, [['a', { secret: 'abbey' }], ['b', { secret: 'crane' }], ['a', { guess: 'crane' }]]);
  assert(eq(wd.next(s), ['b']), 'a solver stops being listed');
  throws(() => wd.apply(clone(s), 'a', { guess: 'slate' }), /out of guesses/, 'no guessing after solving');
  const fails6 = ['slate', 'brine', 'pound', 'misty', 'jumbo', 'fight'].map((g) => ['b', { guess: g }]);
  s = run(wd, [['a', { secret: 'abbey' }], ['b', { secret: 'crane' }], ['a', { guess: 'slate' }], ['a', { guess: 'crane' }], ...fails6]);
  assert(eq(wd.next(s), []) && wd.result(s).winner === 'a', 'solving beats missing (2 vs 7)');
  s = run(wd, [['a', { secret: 'abbey' }], ['b', { secret: 'crane' }], ['a', { guess: 'crane' }], ['b', { guess: 'abbey' }]]);
  assert(wd.result(s).winner === null && /Dead heat/.test(wd.result(s).text), 'equal guesses is a draw');

  // Double Agents: the key generator, 50 seeds
  const { makeKeys, pickWords, NOUNS } = ag._test;
  assert(NOUNS.length >= 380 && new Set(NOUNS).size === NOUNS.length && NOUNS.every((w) => /^[a-z]{2,8}$/.test(w)), `agents: ${NOUNS.length} distinct nouns, 2-8 letters`);
  let okKeys = true;
  let okWords = true;
  const firstCells = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const k = makeKeys(seed * 7919);
    const cnt = (str, ch) => [...str].filter((c) => c === ch).length;
    const pair = (x, y) => [...Array(25).keys()].filter((i) => k.a[i] === x && k.b[i] === y).length;
    const agents = [...Array(25).keys()].filter((i) => k.a[i] === 'G' || k.b[i] === 'G').length;
    const good = k.a.length === 25 && k.b.length === 25
      && cnt(k.a, 'G') === 9 && cnt(k.a, 'K') === 3 && cnt(k.a, 'N') === 13
      && cnt(k.b, 'G') === 9 && cnt(k.b, 'K') === 3 && cnt(k.b, 'N') === 13
      && pair('G', 'G') === 3 && pair('K', 'K') === 1 && pair('G', 'K') === 1 && pair('K', 'G') === 1
      && pair('G', 'N') === 5 && pair('N', 'G') === 5 && pair('K', 'N') === 1 && pair('N', 'K') === 1 && pair('N', 'N') === 7
      && agents === 15 && eq(makeKeys(seed * 7919), k);
    if (!good) { okKeys = false; console.log('bad key for seed', seed * 7919, k); }
    firstCells.add(k.a + k.b);
    const ws = pickWords(seed * 7919);
    if (ws.length !== 25 || new Set(ws).size !== 25 || ws.some((w, i) => ws.some((o, j) => i !== j && o.includes(w)))) { okWords = false; console.log('bad words', ws); }
  }
  assert(okKeys, 'agents keys: 9/3/13 per side, 3 shared agents, 1 shared assassin, 1+1 agent-assassins, 15 distinct agents (50 seeds)');
  assert(firstCells.size === 50, 'agents keys differ between seeds');
  assert(okWords, 'agents boards: 25 distinct words, none inside another (50 seeds)');

  // Double Agents rules
  s = run(ag, [], { first: 'b', seed: 99 });
  assert(eq(ag.next(s), ['b']) && s.giver === 'b', 'agents: first player gives the first clue');
  const w0 = s.words[0];
  throws(() => run(ag, [['b', { clue: w0, n: 2 }]], { first: 'b', seed: 99 }), /on the board/, 'rejects a clue that is on the board');
  throws(() => run(ag, [['b', { clue: `x${w0}x`, n: 2 }]], { first: 'b', seed: 99 }), /Too close/, 'rejects a clue containing a board word');
  throws(() => run(ag, [['b', { clue: 'big cat', n: 2 }]], { first: 'b', seed: 99 }), /One word/, 'rejects a two-word clue');
  throws(() => run(ag, [['b', { clue: 'qzx', n: 0 }]], { first: 'b', seed: 99 }), /1 to 9/, 'rejects a bad number');
  throws(() => run(ag, [['b', { pick: 3 }]], { first: 'b', seed: 99 }), /clue first/, 'rejects a pick before the clue');
  s = run(ag, [['b', { clue: 'qzx', n: 2 }]], { first: 'b', seed: 99 });
  assert(eq(ag.next(s), ['a']), 'after the clue the partner guesses');
  throws(() => ag.apply(clone(s), 'a', { stop: true }), /at least one/, 'must pick at least one card');
  throws(() => ag.apply(clone(s), 'b', { pick: 3 }), /partner is guessing/, 'the giver cannot pick');
  const kb = s.key.b;
  const assassin = [...kb].indexOf('K');
  const t = ag.apply(clone(s), 'a', { pick: assassin });
  assert(t.over === 'burned' && eq(ag.next(t), []) && ag.result(t).text === 'Burned', 'an assassin on the giver’s key ends it');
  const by = [...kb].indexOf('N');
  const t2 = ag.apply(clone(s), 'a', { pick: by });
  assert(t2.phase === 'clue' && t2.giver === 'a' && t2.miss.b.includes(by), 'a bystander ends the turn and is marked on the giver’s key');
  throws(() => ag.apply(clone(t2), 'b', { pick: 0 }), /Wait for the clue/, 'a pick out of turn is rejected');
  // tokens: 9 turns of one bystander each, then out of time
  let u = run(ag, [], { first: 'a', seed: 5 });
  for (let n = 0; n < 9 && !u.over; n++) {
    const g = u.giver;
    u = ag.apply(clone(u), g, { clue: 'qzx', n: 1 });
    const key = u.key[g];
    const i = [...key].findIndex((r, j) => r === 'N' && !u.miss[g].includes(j));
    u = ag.apply(clone(u), ag.next(u)[0], { pick: i });
  }
  assert(u.over === 'time' && ag.result(u).text === 'Out of time' && ag.result(u).score === 0, 'nine turns without finishing is a loss');
}

// ── browser helpers ──────────────────────────────────────────────────────
const toastText = (pg) => pg.evaluate(() => { const t = [...document.querySelectorAll('.toast')]; return t.length ? t[t.length - 1].textContent : ''; });
async function snap(pg, scheme, name, sizes = [[390, 844], [360, 780]]) {
  for (const [w, hgt] of sizes) {
    await pg.setViewportSize({ width: w, height: hgt });
    await pg.waitForTimeout(120);
    await pg.screenshot({ path: path.join(SHOTS, `${scheme}-${name}-${w}.png`), scale: 'css', animations: 'disabled' });
  }
  await pg.setViewportSize({ width: 390, height: 664 });
  await pg.waitForTimeout(60);
}
const tapKeys = async (pg, word) => { for (const ch of word) await pg.click(`.g-wd-key[data-k="${ch}"]`); };
const tapEnter = (pg) => pg.click('.g-wd-key[data-k="enter"]');
// The hub re-renders when results sync, which can detach the card the harness just found: retry.
async function retry(fn) { for (let n = 0; ; n++) { try { return await fn(); } catch (e) { if (n >= 2 || !/not attached|detached/i.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 300)); } } }
const newLocal = (h, pg, game) => retry(() => h.newLocalGame(pg, game));
const newOnline = (h, pg, game) => retry(() => h.newOnlineGame(pg, game));
const reveal = async (pg) => { await pg.waitForSelector('#game-root .gm-curtain:not([hidden])'); await pg.click('#game-root [data-g="reveal"]'); await pg.waitForTimeout(80); };

// ── Word Duel, online ────────────────────────────────────────────────────
async function wordDuelOnline(h, scheme, full) {
  const { a, b } = h;
  const id = await newOnline(h, a, 'wordduel');
  await h.openMatch(b, id);
  await h.settle();
  assert(await a.isVisible('.g-wd-key[data-k="q"]'), 'word duel: keyboard shows for picking');
  if (full) {
    await tapKeys(a, 'qqqqq');
    await tapEnter(a);
    await a.waitForTimeout(60);
    assert(await a.$('.g-wd-row.is-draft.shake'), 'invalid secret shakes the row');
    assert(/isn’t in the word list/.test(await toastText(a)), 'invalid secret shows a toast');
    assert((await h.engine(a, id)).lists.a.length === 0, 'invalid secret is not played');
    for (let i = 0; i < 5; i++) await a.click('.g-wd-key[data-k="back"]');
  }
  await tapKeys(a, 'abbey');
  await snap(a, scheme, 'wd-1-pick');
  await tapEnter(a);
  await h.settle();
  await snap(a, scheme, 'wd-2-picked');
  // Sydney types on a laptop keyboard, with a typo
  await b.keyboard.type('cranx');
  await b.keyboard.press('Backspace');
  await b.keyboard.type('e');
  await b.keyboard.press('Enter');
  await h.settle();
  let e = await h.engine(a, id);
  assert(e.state.secret.a === 'abbey' && e.state.secret.b === 'crane', 'both secrets locked in (on-screen and physical keyboards)');
  assert(eq(e.acts, ['a', 'b']), 'both solve at the same time');

  // Emerson: slate, brine, crane (3). Sydney: babes, abbot, tabby, hobby, abbey (5).
  await tapKeys(a, 'slate'); await tapEnter(a); await a.waitForTimeout(250);
  await b.keyboard.type('babes'); await b.keyboard.press('Enter'); await b.waitForTimeout(250);
  if (full) {
    await b.keyboard.type('zzzzz'); await b.keyboard.press('Enter'); await b.waitForTimeout(60);
    assert(/isn’t in the word list/.test(await toastText(b)), 'invalid guess rejected with a toast');
    for (let i = 0; i < 5; i++) await b.keyboard.press('Backspace');
  }
  await tapKeys(a, 'brine'); await tapEnter(a);
  await h.settle();
  await a.waitForTimeout(1300);
  if (full) {
    const fb = await a.$$eval('.g-wd-board .g-wd-row:nth-child(1) .g-wd-tile', (ts) => ts.map((t) => (t.className.match(/m-([gyx])/) || [])[1]).join(''));
    assert(fb === 'xxgxg', `SLATE against CRANE shows ${fb}`);
    const keyE = await a.getAttribute('.g-wd-key[data-k="e"]', 'class');
    assert(/m-g/.test(keyE), 'keyboard colours E as right spot');
    // Sydney sees Emerson's progress as colour only
    const minis = await b.$$eval('.g-wd-strip .g-wd-m', (ms) => ms.length);
    const coloured = await b.$$eval('.g-wd-strip .g-wd-m[class*="m-"]', (ms) => ms.length);
    assert(minis === 30 && coloured === 10, 'partner progress shows 2 colour-only rows');
    const bText = await b.evaluate(() => document.querySelector('#game-root').innerText.toUpperCase());
    assert(!bText.includes('SLATE') && !bText.includes('BRINE'), 'partner guesses stay hidden');
  }
  await snap(a, scheme, 'wd-3-solve');
  await snap(b, scheme, 'wd-3-solve-b');
  await tapKeys(a, 'crane'); await tapEnter(a);
  await h.settle();
  await a.waitForTimeout(1500);
  e = await h.engine(a, id);
  assert(e.state.guesses.a.length === 3 && !e.acts.includes('a'), 'Emerson solved in 3 and is done');
  assert(await a.isHidden('.g-wd-key'), 'keyboard goes away once you are done');
  if (full) {
    const before = (await h.engine(a, id)).lists.a.length;
    await a.keyboard.type('hello'); await a.keyboard.press('Enter'); await a.waitForTimeout(150);
    assert((await h.engine(a, id)).lists.a.length === before, 'typing after you are done does nothing');
    const blind = await a.$$eval('.g-wd-duo .g-wd-col:nth-child(2) .g-wd-board:not(.g-wd-target) .g-wd-tile', (ts) => ts.filter((t) => t.textContent.trim()).length);
    assert(blind === 0, 'while waiting, partner rows have no letters');
  }
  await snap(a, scheme, 'wd-4-waiting');
  for (const g of ['abbot', 'tabby', 'hobby']) { await b.keyboard.type(g); await b.keyboard.press('Enter'); await b.waitForTimeout(250); }
  await h.settle();
  await b.keyboard.type('abbey'); await b.keyboard.press('Enter');
  await h.settle();
  await b.waitForTimeout(2400);
  const ea = await h.engine(a, id);
  const eb = await h.engine(b, id);
  assert(ea.over && eb.over && eq(ea.state, eb.state) && eq(ea.result, eb.result), 'word duel: both phones agree');
  assert(ea.result.winner === 'a', 'fewer guesses wins (3 vs 5)');
  assert(await a.isVisible('#game-root .gm-end') && await b.isVisible('#game-root .gm-end'), 'end card on both phones');
  const rec = h.results().filter((r) => r.game === 'wordduel');
  assert(rec.length >= 1 && rec[rec.length - 1].winner === 'a', 'word duel result recorded');
  await snap(b, scheme, 'wd-5-endcard');
  await b.click('#game-root [data-g="end-look"]');
  const cols = await b.$$eval('.g-wd-duo .g-wd-col', (cs) => cs.length);
  const letters = await b.$$eval('.g-wd-duo .g-wd-tile', (ts) => ts.filter((t) => t.textContent.trim()).length);
  assert(cols === 2 && letters === 5 + 15 + 5 + 25, 'end view: both words and both guess grids');
  await snap(b, scheme, 'wd-6-end');
  await snap(b, scheme, 'wd-6-end-laptop', [[1280, 800]]);
  await h.closeGame(a);
  await h.closeGame(b);
}

// ── Word Duel, one phone ─────────────────────────────────────────────────
async function wordDuelLocal(h, scheme) {
  const { a } = h;
  const before = h.results().length;
  await h.settle();
  await newLocal(h, a, 'wordduel');
  assert(await a.isVisible('#game-root .gm-curtain'), 'same phone: curtain before the first secret');
  await snap(a, scheme, 'wd-7-curtain', [[390, 844]]);
  await reveal(a);
  await a.keyboard.type('plumb'); await a.keyboard.press('Enter');
  await reveal(a);
  await a.keyboard.type('grape'); await a.keyboard.press('Enter');
  await reveal(a);
  await a.keyboard.type('crane'); await a.keyboard.press('Enter'); await a.waitForTimeout(300);
  await a.keyboard.type('grape'); await a.keyboard.press('Enter');
  await a.waitForTimeout(1500);
  assert(await a.isVisible('.g-wd-actions [data-act="commit"]'), 'same phone: the finishing guess reveals before passing the phone');
  assert(await a.isHidden('#game-root .gm-curtain'), 'no curtain until you pass');
  await snap(a, scheme, 'wd-8-local-pass');
  await a.click('.g-wd-actions [data-act="commit"]');
  await a.waitForTimeout(80);
  assert(await a.isVisible('#game-root .gm-curtain'), 'curtain before Sydney solves');
  await reveal(a);
  await a.keyboard.type('plumb'); await a.keyboard.press('Enter');
  await a.waitForTimeout(2300);
  assert(await a.isVisible('#game-root .gm-end'), 'same-phone word duel ends');
  const end = await a.textContent('#game-root .gm-end-head');
  assert(/Sydney/.test(end), `Sydney wins 1 to 2 (${end})`);
  await h.closeGame(a);
  await h.settle();
  assert(h.results().length === before + 1, 'same-phone word duel result recorded');
}

// ── Double Agents, online ────────────────────────────────────────────────
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
  await pg.click(`.g-ag-card[data-i="${i}"]`);
  if (viaButton) await pg.click('.g-ag-dock [data-act="pick"]');
  else await pg.click(`.g-ag-card[data-i="${i}"]`);
}
async function agentsOnline(h, scheme, full) {
  const { a, b } = h;
  const P = { a, b };
  const id = await newOnline(h, a, 'agents');
  await h.openMatch(b, id);
  await h.settle();
  let e = await h.engine(a, id);
  let s = e.state;
  const G1 = s.giver;
  const R1 = G1 === 'a' ? 'b' : 'a';
  assert(G1 === e.first, 'agents: first player gives the first clue');
  // key visibility
  const giverMarks = await P[G1].$$eval('.g-ag-card.k-G', (cs) => cs.map((c) => Number(c.dataset.i)));
  const wantG = [...s.key[G1]].map((r, i) => (r === 'G' ? i : -1)).filter((i) => i >= 0);
  assert(eq(giverMarks.sort((x, y) => x - y), wantG), 'the giver sees their own 9 agents');
  assert((await P[G1].$$('.g-ag-card.k-K')).length === 3, 'and their 3 assassins');
  assert((await P[R1].$$('.g-ag-card.k-G, .g-ag-card.k-K')).length === 0, 'the guesser sees no key by default');
  await P[R1].click('.g-ag-dock [data-act="mine"]');
  const mine = await P[R1].$$eval('.g-ag-card.k-G', (cs) => cs.map((c) => Number(c.dataset.i)));
  const wantR = [...s.key[R1]].map((r, i) => (r === 'G' ? i : -1)).filter((i) => i >= 0);
  assert(eq(mine.sort((x, y) => x - y), wantR), '"Show my key" shows the guesser’s own key, never the giver’s');
  await snap(P[R1], scheme, 'ag-1-waiting-mykey');
  await P[R1].click('.g-ag-dock [data-act="mine"]');
  if (full) {
    // rejects
    await giveClue(P[G1], s.words[3]);
    await P[G1].waitForTimeout(60);
    assert(/on the board/.test(await toastText(P[G1])), 'a clue on the board is rejected');
    await giveClue(P[G1], 'big cat');
    await P[G1].waitForTimeout(60);
    assert(/One word/.test(await toastText(P[G1])), 'a two-word clue is rejected');
    assert(await P[R1].getAttribute('.g-ag-card[data-i="0"]', 'aria-disabled') === 'true', 'cards are locked for the guesser before the clue');
    await P[R1].click('.g-ag-card[data-i="0"]', { force: true });
    await P[R1].click('.g-ag-card[data-i="0"]', { force: true });
    await P[R1].waitForTimeout(100);
    assert((await h.engine(a, id)).lists.a.length + (await h.engine(a, id)).lists.b.length === 0, 'picking before the clue (out of turn) does nothing');
    await P[G1].fill('.g-ag-input', '');
  }
  await snap(P[G1], scheme, 'ag-2-clue');
  // Turn 1: G1 clues, R1 finds two agents then ends the turn
  await giveClue(P[G1], safeClue(s), 2);
  await h.settle();
  e = await h.engine(P[R1], id);
  s = e.state;
  assert(e.acts[0] === R1 && s.log.length === 1, 'clue sent, partner guesses');
  assert((await P[R1].textContent('.g-ag-slip')).toUpperCase().includes(s.log[0].clue.toUpperCase()), 'the guesser sees the clue');
  if (full) {
    await P[G1].click(`.g-ag-card[data-i="${[...s.key[G1]].indexOf('G')}"]`, { force: true });
    await P[G1].waitForTimeout(80);
    assert((await h.engine(a, id)).state.found.every((x) => !x), 'the giver cannot pick (out of turn)');
    assert(await P[R1].isDisabled('.g-ag-dock [data-act="stop"]'), 'End turn is locked until the first pick');
  }
  const agentsOf = (st, w) => [...st.key[w]].map((r, i) => (r === 'G' && !st.found[i] ? i : -1)).filter((i) => i >= 0);
  let todo = agentsOf(s, G1);
  await pickCard(P[R1], todo[0], true);
  await h.settle();
  await snap(P[R1], scheme, 'ag-3-guess');
  await pickCard(P[R1], todo[1], false);
  await h.settle();
  await snap(P[G1], scheme, 'ag-4-watch');
  await P[R1].click('.g-ag-dock [data-act="stop"]');
  await h.settle();
  e = await h.engine(a, id);
  s = e.state;
  assert(s.found.filter(Boolean).length === 2 && s.giver === R1 && s.phase === 'clue', 'two agents found; the clue passes to the other player');
  // Turn 2: R1 clues, G1 finds one agent then hits a bystander
  await giveClue(P[R1], safeClue(s), 1);
  await h.settle();
  s = (await h.engine(a, id)).state;
  todo = agentsOf(s, R1);
  await pickCard(P[G1], todo[0], false);
  await h.settle();
  const bys = [...s.key[R1]].findIndex((r, i) => r === 'N' && !s.found[i] && !s.miss[R1].includes(i));
  await pickCard(P[G1], bys, true);
  await h.settle();
  s = (await h.engine(a, id)).state;
  assert(s.miss[R1].includes(bys) && s.phase === 'clue' && s.giver === G1, 'a bystander ends the turn');
  assert(await P[R1].$(`.g-ag-card[data-i="${bys}"] .g-ag-tag`), 'the bystander is marked on the board');
  // Turn 3: G1 clues, R1 finds all of G1's remaining agents (turn ends by itself)
  await giveClue(P[G1], safeClue(s), 3);
  await h.settle();
  s = (await h.engine(a, id)).state;
  for (const i of agentsOf(s, G1)) { await pickCard(P[R1], i, false); await h.settle(); }
  s = (await h.engine(a, id)).state;
  assert(s.giver === R1 && s.phase === 'clue' && s.turns === 3, 'all of a key’s agents found ends the turn');
  // Turn 4: R1 clues, G1 finds the rest
  await giveClue(P[R1], safeClue(s), 4);
  await h.settle();
  s = (await h.engine(a, id)).state;
  for (const i of agentsOf(s, R1)) { await pickCard(P[G1], i, false); await h.settle(); }
  await a.waitForTimeout(1500);
  const ea = await h.engine(a, id);
  const eb = await h.engine(b, id);
  assert(ea.over && eb.over && eq(ea.state, eb.state) && eq(ea.result, eb.result), 'double agents: both phones agree');
  assert(ea.result.text === 'Mission complete' && ea.result.score === 15, 'all 15 agents: mission complete');
  assert(await a.isVisible('#game-root .gm-end') && await b.isVisible('#game-root .gm-end'), 'end card on both phones');
  const rec = h.results().filter((r) => r.game === 'agents');
  assert(rec.length >= 1 && rec[rec.length - 1].winner === 'team' && rec[rec.length - 1].score === 15, 'team result recorded with score 15');
  await snap(a, scheme, 'ag-5-endcard');
  await a.click('#game-root [data-g="end-look"]');
  await a.click('.g-ag-dock [data-act="key"][data-w="b"]');
  await snap(a, scheme, 'ag-6-end');
  await snap(a, scheme, 'ag-6-end-laptop', [[1280, 800]]);
  await h.closeGame(a);
  await h.closeGame(b);
}

// ── Double Agents, one phone ─────────────────────────────────────────────
async function agentsLocal(h, scheme) {
  const { a } = h;
  const before = h.results().length;
  await h.settle();
  await newLocal(h, a, 'agents');
  const id = await a.evaluate(() => window.__lastMatchId);
  assert(await a.isVisible('#game-root .gm-curtain'), 'same phone: curtain before the first clue');
  await reveal(a);
  let e = await h.engine(a, id);
  let s = e.state;
  const g = s.giver;
  assert((await a.$$('.g-ag-card.k-G')).length === 9, 'same phone: the giver sees their key after the curtain');
  await giveClue(a, safeClue(s), 2);
  await a.waitForTimeout(80);
  assert(await a.isVisible('#game-root .gm-curtain'), 'curtain before the guesser');
  assert(await a.evaluate(() => getComputedStyle(document.querySelector('.g-agents')).visibility === 'hidden'), 'the board is hidden behind the curtain');
  await reveal(a);
  assert((await a.$$('.g-ag-card.k-G, .g-ag-card.k-K')).length === 0, 'the guesser does not see the giver’s key');
  await snap(a, scheme, 'ag-7-local-guess', [[390, 844], [1280, 800]]);
  const agent = [...s.key[g]].indexOf('G');
  await pickCard(a, agent, false);
  await a.waitForTimeout(100);
  const killer = [...s.key[g]].indexOf('K');
  await pickCard(a, killer, true);
  await a.waitForTimeout(1600);
  assert(await a.isVisible('#game-root .gm-end'), 'same-phone agents ends');
  assert(/Burned/.test(await a.textContent('#game-root .gm-end-head')), 'an assassin burns the mission');
  await snap(a, scheme, 'ag-8-burned');
  await h.closeGame(a);
  await h.settle();
  const r = h.results();
  assert(r.length === before + 1 && r[r.length - 1].score === 1, 'same-phone agents result recorded (1 agent found)');
}

(async () => {
  try { await unitTests(); } catch (e) { console.error(e.message); fails++; }
  for (const scheme of ['light', 'dark']) {
    const full = scheme === 'light';
    const h = await launch({ port: scheme === 'light' ? 8830 : 8831, only: ['wordduel', 'agents'], colorScheme: scheme });
    try {
      await wordDuelOnline(h, scheme, full);
      await wordDuelLocal(h, scheme);
      await agentsOnline(h, scheme, full);
      await agentsLocal(h, scheme);
      h.assertNoErrors();
      console.log(`ok - no page errors (${scheme})`);
    } catch (e) {
      fails++;
      console.error(e.message);
      await h.shot(h.a, path.join(SHOTS, `fail-${scheme}-a.png`)).catch(() => {});
      await h.shot(h.b, path.join(SHOTS, `fail-${scheme}-b.png`)).catch(() => {});
      console.error('errors:', h.errors);
    } finally {
      await h.close();
    }
  }
  console.log(fails ? `\n${fails} FAILED` : `\nALL GOOD (screenshots in ${SHOTS})`);
  process.exitCode = fails ? 1 : 0;
})();
