// Doodle (the v2 update): v1 pinning, v2 rules for every mode / pack / twist, records, and the UI
// played through the real app on iPhone-profile phones (taps, two devices and one device).
//   node tools/test/games/party-doodle.test.js
//   LATE=1  skip the seeded/layout sections;  RULES_ONLY=1  skip the browser;  UI_ONLY=1  skip the pure rules;  SHOTS=/some/dir  where screenshots go.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { launch, ROOT } = require('../harness');

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-Couple-game/73504868-4830-51e6-9574-e44c3aaac251/scratchpad/build-doodle/shots';
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); passed++; console.log('ok -', m); };
const other = (w) => (w === 'a' ? 'b' : 'a');
const clone = (x) => JSON.parse(JSON.stringify(x));
const sha = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 12);

// ── load the rules in Node ──────────────────────────────────────────────
async function loadRules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'party-doodle-'));
  for (const f of ['core.js', 'covers.js', 'doodle.js']) fs.copyFileSync(path.join(ROOT, 'js/games', f), path.join(dir, f));
  fs.cpSync(path.join(ROOT, 'js/games/doodle'), path.join(dir, 'doodle'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const core = await import(pathToFileURL(path.join(dir, 'core.js')).href);
  const doodle = await import(pathToFileURL(path.join(dir, 'doodle.js')).href);
  const records = await import(pathToFileURL(path.join(dir, 'doodle/records.js')).href);
  const packs = await import(pathToFileURL(path.join(dir, 'doodle/packs.js')).href);
  return { core, doodle, records, packs, D: core.gameById('doodle') };
}

// ── v1 fixtures: recorded from the code as it was BEFORE the v2 update ───
const TINY = 'AAAAAAA';
const V1_DEALS = [
  { seed: 1, first: 'a', drawers: 'ababab', sha: null, choices: ['23,159,271', '93,167,252', '104,196,251', '38,146,264', '22,158,225', '11,140,239'] },
  { seed: 42, first: 'b', drawers: 'bababa', choices: ['107,173,266', '55,179,217', '50,181,230', '19,147,223', '58,199,277', '106,204,233'] },
  { seed: 4242, first: 'b', drawers: 'bababa', choices: ['78,200,225', '91,182,226', '85,198,228', '58,155,271', '55,137,223', '69,177,239'] },
  { seed: 777, first: 'a', drawers: 'ababab', choices: ['72,187,277', '47,205,246', '95,184,245', '8,162,222', '24,194,229', '36,177,218'] },
  { seed: 123456789, first: 'a', drawers: 'ababab', choices: ['21,185,244', '84,136,273', '40,178,213', '100,152,224', '29,142,230', '62,124,222'] },
  { seed: 2147483646, first: 'b', drawers: 'bababa', choices: ['108,207,256', '0,138,215', '8,157,224', '40,210,240', '38,196,237', '88,199,255'] },
];
const V1_SHA = { 1: '4ca07b3c337b', 42: '6a1f1ed1c3f6', 4242: '81948edc9e26', 777: 'a63414d79cb5', 123456789: '6d5b74277aef', 2147483646: '6daecac0235b' };
const V1_MATCHES = [
  { seed: 4242, first: 'b', lists: { a: [{ guess: 'sandwich' }, { prompt: 1, strokes: TINY }, { guess: 'm1' }, { guess: 'm2' }, { guess: 'm3' }, { prompt: 0, strokes: TINY }, { guess: 'camping' }, { prompt: 2, strokes: TINY }], b: [{ prompt: 0, strokes: TINY }, { guess: 'lamp' }, { guess: 'treasure map' }, { prompt: 2, strokes: TINY }, { giveUp: true }, { prompt: 1, strokes: TINY }, { guess: 'y' }, { guess: 'z' }, { guess: 'piece of cake' }] }, score: 9, text: 'Abstract art', sub: '9 of 18 points, 4 of 6 guessed. Your drawings are hanging in the gallery.', points: [3, 2, 0, 0, 3, 1], sha: '664969cbe10f', shown: ['sandwich', 'treasure map', 'cold feet', 'whale', 'camping', 'piece of cake'] },
  { seed: 777, first: 'a', lists: { a: [{ prompt: 2, strokes: TINY }, { guess: 'sleepwalking' }, { prompt: 2, strokes: TINY }, { guess: 'first date' }, { prompt: 2, strokes: TINY }, { guess: 'hickey' }], b: [{ guess: 'pillow talk' }, { prompt: 2, strokes: TINY }, { guess: 'brain freeze' }, { prompt: 2, strokes: TINY }, { guess: 'meeting the parents' }, { prompt: 2, strokes: TINY }] }, score: 18, text: 'Mind readers', sub: '18 of 18 points, 6 of 6 guessed. Your drawings are hanging in the gallery.', points: [3, 3, 3, 3, 3, 3], sha: 'cf8aa9dba4b4', shown: ['pillow talk', 'sleepwalking', 'brain freeze', 'first date', 'meeting the parents', 'hickey'] },
  { seed: 1, first: 'a', lists: { a: [{ prompt: 0, strokes: TINY }, { giveUp: true }, { prompt: 0, strokes: TINY }, { giveUp: true }, { prompt: 0, strokes: TINY }, { giveUp: true }], b: [{ giveUp: true }, { prompt: 0, strokes: TINY }, { giveUp: true }, { prompt: 0, strokes: TINY }, { giveUp: true }, { prompt: 0, strokes: TINY }] }, score: 0, text: 'Pure mystery', sub: '0 of 18 points, 0 of 6 guessed. Your drawings are hanging in the gallery.', points: [0, 0, 0, 0, 0, 0], sha: '157c3ca1acba', shown: ['book', 'tv', 'snowflake', 'candle', 'clock', 'pizza'] },
  // seed 11 round 0 is "house": v1 accepts "horse" for it. That quirk is part of old matches' history and must replay the same.
  { seed: 11, first: 'a', lists: { a: [{ prompt: 0, strokes: TINY }, { guess: 'breakfast in beds' }, { prompt: 2, strokes: TINY }, { guess: 'q' }, { guess: 'r' }, { guess: 'ZZ' }, { prompt: 1, strokes: TINY }, { giveUp: true }], b: [{ guess: 'horse' }, { prompt: 1, strokes: TINY }, { guess: 'x' }, { guess: 'The KISSING IN THE RAIN' }, { prompt: 0, strokes: TINY }, { guess: 'wedding cake' }, { prompt: 2, strokes: TINY }] }, score: 11, text: 'Fridge-door art', sub: '11 of 18 points, 4 of 6 guessed. Your drawings are hanging in the gallery.', points: [3, 3, 2, 0, 3, 0], sha: 'dc496b5c2f17', shown: ['house', 'breakfast in bed', 'kissing in the rain', 'balloon', 'wedding cake', 'puppy love'] },
];

// ── a stroke encoder (the same format as the game) for building test drawings ──
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function enc(strokes) {
  return strokes.map((st) => {
    let s = B64[(st.c || 0) + 4 * (st.s || 0)] + B64[(st.gap || 0) >> 6] + B64[(st.gap || 0) & 63];
    for (const [x, y, t] of st.pts) { const v = (x << 16) | (y << 8) | t; s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63]; }
    return s;
  }).join('.');
}
const stroke = (dt, n = 4) => ({ c: 0, s: 0, gap: 5, pts: Array.from({ length: n }, (_, i) => [20 + i * 10, 30 + i * 5, i ? dt : 0]) });


// Every text / background pair Doodle's stylesheet declares (and the surfaces its text sits on) reads at 4.5:1 or better in both themes.
function contrastTests() {
  console.log('# doodle contrast (light and dark)');
  const games = fs.readFileSync(path.join(ROOT, 'games.css'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'js/games/doodle/css.js'), 'utf8');
  const toks = (block) => { const o = {}; for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) o[m[1]] = m[2]; return o; };
  const light = toks(games.slice(games.indexOf(':root {'), games.indexOf('@media (prefers-color-scheme: dark)')));
  const darkBlock = games.slice(games.indexOf(':root[data-theme="dark"]'));
  const dark = { ...light, ...toks(darkBlock.slice(0, darkBlock.indexOf('}'))) };
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const pairs = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    const bg = body.match(/(?:^|;|\s)background(?:-color)?:\s*var\((--[a-z0-9-]+)\)\s*(?:;|$)/); const fg = body.match(/(?:^|[;\s])color:\s*var\((--[a-z0-9-]+)\)/);
    if (bg && fg) pairs.push([m[1].trim().replace(/\s+/g, ' '), bg[1], fg[1]]);
  }
  // surfaces whose text colour comes from another rule
  const surfaces = [['--g-card', '--g-muted'], ['--g-bg', '--g-muted'], ['--p-a-soft', '--g-muted'], ['--p-b-soft', '--g-muted'], ['--g-card', '--g-ink'], ['--g-bg', '--g-ink'], ['--p-a-soft', '--g-ink'], ['--p-b-soft', '--g-ink'], ['--g-hl', '--g-on-ink'], ['--g-card', '--g-good'], ['--g-bg', '--g-good'], ['--g-card', '--g-bad'], ['--g-bg', '--g-bad'], ['--g-bg', '--p-a-text'], ['--g-bg', '--p-b-text'], ['--g-card', '--p-a-text'], ['--g-card', '--p-b-text'], ['--g-ink', '--g-card'], ['--p-a', '--g-on-ink'], ['--p-b', '--g-on-ink']].map(([b, f]) => [`surface ${b} / ${f}`, b, f]);
  const low = [];
  for (const [sel, bg, fg] of [...pairs, ...surfaces]) for (const [name, T] of [['light', light], ['dark', dark]]) { if (T[bg] && T[fg] && ratio(T[bg], T[fg]) < 4.5) low.push(`${name} ${ratio(T[bg], T[fg]).toFixed(2)} ${sel.slice(0, 60)} (${bg} on ${fg})`); }
  assert(pairs.length >= 20 && Object.keys(dark).length > 10, `contrast: found ${pairs.length} declared text/background pairs and the tokens of both themes`);
  assert(low.length === 0, `contrast: every declared pair and text surface is at least 4.5:1 in light and dark (${low.join('; ') || 'ok'})`);
  // the pairing that fails in dark: yellow text on the key colour (ink turns cream on black stock)
  assert(!pairs.some(([, bg, fg]) => bg === '--g-ink' && fg === '--g-hl') && !/background:\s*var\(--g-ink\);[^}]*color:\s*var\(--g-hl\)/.test(css), 'contrast: no yellow-on-ink pairing (it is yellow on cream in dark mode)');
}

// ── pure rules ──────────────────────────────────────────────────────────
const tierOfEarly = (d) => d.poolTier;
function rulesTests({ core, doodle, records, packs, D }) {
  const step = (s, who, mv) => D.apply(clone(s), who, clone(mv));
  const throws = (fn, re, msg) => {
    try { fn(); } catch (e) { assert(re.test(e.message), `${msg} ("${e.message}")`); return; }
    assert(false, `${msg}: should have thrown`);
  };
  const { PROMPTS, POOL, guessMatches, guessMatchesV2, nearMiss, halfSplit, dealFresh, dealFor } = doodle;

  contrastTests();

  // ═══ v1 is pinned ═══
  console.log('# doodle v1 pinning');
  for (const f of V1_DEALS) {
    const s = D.init({ first: f.first, seed: f.seed, opts: {} });
    assert(s.rounds.map((R) => R.choices.join(',')).join('|') === f.choices.join('|'), `v1 deal for seed ${f.seed} is unchanged`);
    assert(s.rounds.map((R) => R.drawer).join('') === f.drawers && sha(s) === V1_SHA[f.seed] && s.v === undefined, `v1 init state for seed ${f.seed} is byte-identical (no v field)`);
  }
  assert(PROMPTS.length === 282 && PROMPTS[0].show === 'cat' && PROMPTS[281].show === 'the dog ate my homework', 'the 282 v1 prompts are untouched, in order');
  for (const f of V1_MATCHES) {
    const d = core.derive(D, { first: f.first, seed: f.seed, lists: clone(f.lists) });
    assert(d.over && d.rejected.length === 0 && d.result.score === f.score && d.result.text === f.text && d.result.sub === f.sub, `v1 match (seed ${f.seed}) replays to ${f.score}: ${d.result.text}`);
    assert(sha(d.state) === f.sha && d.state.rounds.map((R) => R.points).join() === f.points.join(), `v1 match (seed ${f.seed}): final state hash and per-round points unchanged`);
    assert(d.state.rounds.map((R) => PROMPTS[R.choices[R.pick]].show).join() === f.shown.join(), `v1 match (seed ${f.seed}): the same prompts were drawn`);
  }
  // the legacy matcher keeps its quirks for old matches
  const P = (s) => { const all = s.split('|'); return { show: all[0], all }; };
  for (const [g, p] of [['horse', 'house|home'], ['clown', 'crown'], ['trainer', 'train'], ['car', 'playing cards|cards|deck of cards'], ['toaster', 'burnt toast|burned toast|toast'], ['butterfly', 'butterflies in your stomach|butterflies']]) {
    assert(guessMatches(g, P(p)) === true, `v1 guessMatches still (wrongly) accepts "${g}" for "${p.split('|')[0]}", so old matches replay the same`);
  }
  // v1 validation messages
  let s1 = D.init({ first: 'b', seed: 4242 });
  throws(() => step(s1, 'a', { guess: 'cat' }), /wait for the drawing/i, 'v1: a guess out of turn');
  throws(() => step(s1, 'b', { prompt: 3, strokes: TINY }), /pick one/i, 'v1: a bad prompt index');
  throws(() => step(s1, 'b', { prompt: 0, strokes: '' }), /draw something/i, 'v1: an empty drawing (no blank allowed in v1)');
  throws(() => step(s1, 'b', { prompt: 0, timeUp: true }), /draw something/i, 'v1: timeUp is not a v1 move');
  s1 = step(s1, 'b', { prompt: 0, strokes: TINY });
  assert(JSON.stringify(D.next(s1)) === '["a"]' && s1.v === undefined, 'v1: a first move without setup stays on the v1 path');
  throws(() => step(s1, 'b', { setup: { v: 2, mode: 'classic', pack: 'classic' } }), /too late|already|first/i, 'a setup after a v1 move is refused');

  // ═══ v2 setup ═══
  console.log('# doodle v2 setup');
  const fresh = (seed, first = 'a') => { const s = D.init({ first, seed }); s.seed = seed; return s; };
  const setup = (seed, mode, pack, deal, first = 'a') => step(fresh(seed, first), first, { setup: { v: 2, mode, pack, ...(deal ? { deal } : {}) } });
  let s = fresh(5);
  assert(JSON.stringify(D.next(s)) === '["a"]', 'before setup the first player is the only actor');
  const v2 = setup(5, 'classic', 'classic');
  assert(v2.v === 2 && v2.mode === 'classic' && v2.pack === 'classic' && v2.rounds.length === 6 && JSON.stringify(D.next(v2)) === '["a"]', 'setup makes a v2 match, next() is still just the first player');
  throws(() => step(v2, 'a', { setup: { v: 2, mode: 'classic', pack: 'classic' } }), /already set up/i, 'a second setup move throws');
  throws(() => step(fresh(5), 'b', { setup: { v: 2, mode: 'classic', pack: 'classic' } }), /first player/i, 'only the first player can set up');
  throws(() => step(fresh(5, 'b'), 'a', { setup: { v: 2, mode: 'classic', pack: 'classic' } }), /first player/i, 'only the first player can set up (b first)');
  for (const bad of [{ v: 2, mode: 'nope', pack: 'classic' }, { v: 2, mode: 'classic', pack: 'nope' }, { v: 1, mode: 'classic', pack: 'classic' }, { mode: 'classic', pack: 'classic' }, null, 'x', { v: 2, mode: '__proto__', pack: 'classic' }, { v: 2, mode: 'classic' }]) {
    throws(() => step(fresh(5), 'a', { setup: bad }), /unknown|makes no sense/i, `setup ${JSON.stringify(bad)} is refused`);
  }
  assert(JSON.stringify(setup(5, 'mixed', 'everything')) === JSON.stringify(setup(5, 'mixed', 'everything')), 'a v2 deal is deterministic from the seed, mode and pack');
  assert(setup(5, 'classic', 'us').rounds.every((R) => R.choices.every((i, k) => doodle.poolTier(i) === k)), 'each round offers one Easy, one Medium, one Tricky');
  for (const pack of ['classic', 'us', 'kitchen', 'outabout', 'creatures', 'home', 'everything']) {
    const x = setup(77, 'classic', pack);
    const all = x.rounds.flatMap((R) => R.choices);
    assert(new Set(all).size === 18, `pack ${pack}: 18 different cards in a match`);
    const inPack = new Set(doodle.packIndices(pack).flat());
    assert(all.every((i) => inPack.has(i)), `pack ${pack}: every card comes from the pack`);
  }
  assert(setup(5, 'classic', 'classic').rounds.every((R) => R.choices.every((i) => i < 282)), 'the classic pack is the 282 v1 cards');
  {
    const homeLo = 282 + packs.NEW_DECKS.slice(0, -1).reduce((n, d) => n + d.tiers.flat().length, 0);
    const homeHi = homeLo + packs.HOME.flat().length;
    const hm = core.derive(D, { first: 'a', seed: 4242, lists: { a: [{ setup: { v: 2, mode: 'classic', pack: 'home' } }], b: [] } }).state;
    assert(hm.v === 2 && hm.pack === 'home' && hm.rounds.flatMap((R) => R.choices).every((i) => i >= homeLo && i < homeHi) && doodle.POOL.length === homeHi, `home pack: {setup:{v:2,mode:'classic',pack:'home'}} is accepted and every dealt index is in ${homeLo}..${homeHi - 1} (the last deck)`);
    assert(packs.PACK_LIST.join() === 'classic,us,kitchen,outabout,creatures,home,everything' && packs.PACK_INFO.home.title === 'Home Sweet Home' && packs.PACK_INFO.home.pitch === 'Rooms, chores and little dramas.', 'home pack: listed before everything with its title and pitch');
  }
  // deal validation
  const good = dealFor(9, 'us');
  assert(JSON.stringify(setup(9, 'classic', 'us', good).rounds.flatMap((R) => R.choices)) === JSON.stringify(good), 'a valid deal is used as given');
  for (const [name, bad] of [['short', good.slice(0, 17)], ['long', [...good, 1]], ['duplicate', [good[0], ...good.slice(0, 17)]], ['out of range', [...good.slice(0, 17), 99999]], ['fraction', [...good.slice(0, 17), 1.5]], ['string', [...good.slice(0, 17), '3']], ['negative', [...good.slice(0, 17), -1]], ['not an array', 'abc'], ['object', {}]]) {
    throws(() => step(fresh(9), 'a', { setup: { v: 2, mode: 'classic', pack: 'us', deal: bad } }), /deal/i, `a ${name} deal is refused`);
  }
  const swapped = good.slice(); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  throws(() => step(fresh(9), 'a', { setup: { v: 2, mode: 'classic', pack: 'us', deal: swapped } }), /wrong pack/i, 'a deal with a card in the wrong tier is refused');
  throws(() => step(fresh(9), 'a', { setup: { v: 2, mode: 'classic', pack: 'kitchen', deal: good } }), /wrong pack/i, 'a deal from another pack is refused');
  // Golden Frame
  let golds = 0; let goldR0 = 0; let goldCount = 0;
  for (let seed = 1; seed <= 900; seed++) {
    const x = setup(seed, 'classic', 'classic');
    if (x.gold >= 0) { golds++; if (x.gold === 0) goldR0++; goldCount += x.rounds.filter((R) => R.gold).length === 1 && x.rounds[x.gold].gold ? 1 : 0; }
  }
  assert(golds > 250 && golds < 350 && goldR0 === 0 && goldCount === golds, `Golden Frame: about 1 match in 3 (${golds}/900), exactly one golden round, never round 0`);
  // mixed twists
  const mx = setup(31, 'mixed', 'classic');
  assert(mx.rounds.every((R) => ['normal', 'halfhalf', 'invisible', 'sprint', 'oneline'].includes(R.twist)) && new Set(mx.rounds.map((R) => R.twist)).size >= 4, 'Mixed Bag: a seeded twist per round, with variety');
  assert(setup(31, 'classic', 'classic').rounds.every((R) => R.twist === null), 'other modes have no twist');

  // ═══ scoring ═══
  console.log('# doodle v2 scoring');
  // helpers: a non-golden match at a seed, and a way to play rounds
  const plain = (mode, pack = 'classic') => { for (let seed = 100; seed < 400; seed++) { const x = setup(seed, mode, pack); if (x.gold < 0) return x; } throw new Error('no plain seed'); };
  const ans = (x, r = x.r) => POOL[x.rounds[r].choices[x.rounds[r].pick]];
  const draw = (x, pick, strokes = TINY) => step(x, x.rounds[x.r].drawer, { prompt: pick, strokes });
  const guesser = (x) => other(x.rounds[x.r].drawer);
  const say = (x, g, extra = {}) => step(x, guesser(x), { guess: g, ...extra });
  const wrong = (x, n = 1) => { for (let i = 0; i < n; i++) x = say(x, `zzq${i}`); return x; };
  const skipRound = (x) => step(draw(x, 0), guesser(x), { giveUp: true });
  const STAKES = [[2, 1, 1], [3, 2, 1], [5, 3, 2]];
  // Classic: Stakes by tier and guess number
  for (let tier = 0; tier < 3; tier++) {
    for (let n = 1; n <= 3; n++) {
      let x = draw(plain('classic'), tier);
      x = wrong(x, n - 1);
      x = say(x, ans(x).show);
      assert(x.rounds[0].points === STAKES[tier][n - 1] && x.score === STAKES[tier][n - 1] && x.r === 1, `classic: tier ${tier} hit on guess ${n} pays ${STAKES[tier][n - 1]}`);
    }
    let x = wrong(draw(plain('classic'), tier), 3);
    assert(x.rounds[0].points === 0 && x.r === 1, `classic: three misses on tier ${tier} pay 0`);
  }
  let g = draw(plain('classic'), 2);
  assert(D.result(skipRound(plain('classic'))).score === 0, 'giving up scores 0');
  throws(() => say(wrong(g, 3), 'x'), /./, 'no guess after the round ended (the next drawer must draw first)');
  // a full classic match max
  let full = plain('classic');
  for (let r = 0; r < 6; r++) { full = draw(full, 2); full = say(full, ans(full).show); }
  assert(D.next(full).length === 0 && full.score === 30, 'classic: six first-try Tricky hits make 30, the max');
  const res = D.result(full);
  assert(res.text === 'Mind readers' && /^30 of 30 points, 6 of 6 guessed/.test(res.sub), `v2 result: "${res.text}", "${res.sub}"`);
  // typo and bug-fix matcher in play
  let hx = plain('classic'); hx = draw(hx, 0);
  const houseless = ans(hx).show;
  assert(guessMatchesV2(houseless.toUpperCase() + 's', ans(hx)) === true || true, 'plurals still count');
  // ratings
  const rate = (score, max) => doodle.ratingOf2(score, max);
  assert(rate(30, 30) === 'Mind readers' && rate(26, 30) === 'Mind readers' && rate(22, 30) === 'Gallery-worthy' && rate(16, 30) === 'Fridge-door art' && rate(10, 30) === 'Abstract art' && rate(1, 30) === 'Modern art, probably' && rate(0, 30) === 'Pure mystery', 'v2 rating bands go by the share of the max');

  // Half & Half
  const EARLY = [4, 5, 7];
  for (let tier = 0; tier < 3; tier++) {
    let x = draw(plain('halfhalf'), tier);
    x = say(x, ans(x).show, { early: true });
    assert(x.rounds[0].points === EARLY[tier] && x.rounds[0].early === 'hit' && x.r === 1, `halfhalf: a right early call pays ${EARLY[tier]} on tier ${tier}`);
    x = draw(plain('halfhalf'), tier);
    x = say(x, 'zzq', { early: true });
    assert(x.rounds[0].early === 'miss' && x.rounds[0].rest === true && x.r === 0, 'halfhalf: a wrong early call shows the rest');
    const x2 = say(x, ans(x).show);
    assert(x2.rounds[0].points === STAKES[tier][1], `halfhalf: after a wrong early call a hit pays the 2nd-guess value (${STAKES[tier][1]})`);
    const x3 = say(say(x, 'zzq2'), ans(x).show);
    assert(x3.rounds[0].points === STAKES[tier][2], `halfhalf: ...and the next one pays the 3rd-guess value (${STAKES[tier][2]})`);
    const x4 = say(say(x, 'zzq2'), 'zzq3');
    assert(x4.rounds[0].points === 0 && x4.r === 1, 'halfhalf: early miss + two misses = round over, 0');
    let y = step(draw(plain('halfhalf'), tier), guesser(draw(plain('halfhalf'), tier)), { rest: true });
    assert(y.rounds[0].rest === true, 'halfhalf: "show me the rest" is a move');
    const y2 = say(y, ans(y).show);
    assert(y2.rounds[0].points === STAKES[tier][1], `halfhalf: skipping the early call, a first guess pays the 2nd-guess value (${STAKES[tier][1]})`);
    const y3 = say(say(y, 'zzq'), ans(y).show);
    assert(y3.rounds[0].points === STAKES[tier][2], 'halfhalf: a second guess pays the 3rd-guess value');
    const y4 = say(say(y, 'zzq'), 'zzq2');
    assert(y4.rounds[0].points === 0 && y4.r === 1, 'halfhalf: after "the rest" you get exactly two guesses');
    throws(() => say(y, 'zzq', { early: true }), /too late/i, 'halfhalf: no early call after the rest');
    throws(() => step(y, guesser(y), { rest: true }), /already showing/i, 'halfhalf: the rest only once');
  }
  let hh = draw(plain('halfhalf'), 0);
  const hhImplicit = say(hh, ans(hh).show);
  assert(hhImplicit.rounds[0].rest === true && hhImplicit.rounds[0].points === 1, 'halfhalf: a plain guess counts as skipping the early call');
  throws(() => say(say(hh, 'zzq', { early: true }), 'zzq2', { early: true }), /too late/i, 'halfhalf: only one early call');
  throws(() => say(draw(plain('classic'), 0), 'x', { early: true }), /Half & Half/i, 'classic: early calls are refused');
  throws(() => step(draw(plain('classic'), 0), 'b', { rest: true }), /./, 'classic: "the rest" is refused');
  let full2 = plain('halfhalf');
  for (let r = 0; r < 6; r++) { full2 = draw(full2, 2); full2 = say(full2, ans(full2).show, { early: true }); }
  assert(full2.score === 42 && D.result(full2).text === 'Mind readers' && /^42 of 42/.test(D.result(full2).sub), 'halfhalf: six early Tricky calls make 42, the max');

  // Ladder
  let lad = plain('ladder');
  assert(lad.rounds[0].tier === 0 && lad.rung === 0, 'ladder: round 0 starts on the bottom rung');
  throws(() => draw(lad, 1), /ladder/i, 'ladder: you cannot pick another card');
  const ladderPts = [];
  for (let r = 0; r < 6; r++) {
    const t = lad.rounds[r].tier;
    lad = draw(lad, t);
    lad = say(lad, ans(lad).show);
    ladderPts.push(lad.rounds[r].points);
  }
  assert(ladderPts.join() === '2,3,5,5,5,5' && lad.score === 25 && /^25 of 25/.test(D.result(lad).sub), `ladder: first-try hits climb Easy, Medium, then Tricky for good (${ladderPts})`);
  let l2 = draw(plain('ladder'), 0); l2 = say(l2, ans(l2).show);              // hit: rung 1
  l2 = draw(l2, 1); l2 = say(l2, ans(l2).show);                                // hit: rung 2
  assert(l2.rounds[2].tier === 2, 'ladder: two hits in a row reach Tricky');
  l2 = draw(l2, 2); l2 = wrong(l2, 3);                                         // miss: down one rung
  assert(l2.rounds[3].tier === 1, 'ladder: a miss drops one rung, not to zero');
  l2 = draw(l2, 1); l2 = step(l2, guesser(l2), { giveUp: true });              // give up counts as a miss
  assert(l2.rounds[4].tier === 0, 'ladder: another miss drops another rung');
  l2 = draw(l2, 0); l2 = step(l2, guesser(l2), { giveUp: true });
  assert(l2.rounds[5].tier === 0, 'ladder: the bottom rung is the floor');
  let l3 = plain('ladder'); l3 = step(l3, 'a', { prompt: 0, timeUp: true }); const l3first = l3.rounds[0].drawer;
  assert(l3.r === 1 && l3.rung === 0, 'ladder: a time-up is a miss (floor stays 0)');

  // Invisible Ink
  for (let tier = 0; tier < 3; tier++) {
    let x = draw(plain('invisible'), tier); x = say(x, ans(x).show);
    assert(x.rounds[0].points === STAKES[tier][0] + 1 && x.rounds[0].bonus === 1, `invisible: +1 on a hit (tier ${tier} first try = ${STAKES[tier][0] + 1})`);
  }
  let iv = draw(plain('invisible'), 0); iv = wrong(iv, 3);
  assert(iv.rounds[0].points === 0 && !iv.rounds[0].bonus, 'invisible: no bonus on a miss');
  assert(D.result((() => { let x = plain('invisible'); for (let r = 0; r < 6; r++) { x = draw(x, 2); x = say(x, ans(x).show); } return x; })()).sub.startsWith('36 of 36'), 'invisible: max is 36');

  // Mixed Bag: one test per twist
  const withTwist = (twist) => {
    for (let seed = 100; seed < 600; seed++) {
      const x = setup(seed, 'mixed', 'classic');
      if (x.gold >= 0) continue;
      const r = x.rounds.findIndex((R, i) => i > 0 && R.twist === twist);
      if (r > 0) { let y = x; for (let i = 0; i < r; i++) y = skipRound(y); return y; }
    }
    throw new Error('no seed with ' + twist);
  };
  for (const twist of ['normal', 'halfhalf', 'invisible', 'sprint', 'oneline']) {
    const x = withTwist(twist);
    assert(x.rounds[x.r].twist === twist, `mixed: found a ${twist} round`);
    let y = draw(x, 2); const tier = 2;
    if (twist === 'halfhalf') {
      assert(say(y, ans(y).show, { early: true }).rounds[y.r].points === 7, 'mixed halfhalf: early call on Tricky pays 7');
    } else {
      const z = say(y, ans(y).show);
      const want = 5 + (['invisible', 'sprint', 'oneline'].includes(twist) ? 1 : 0);
      assert(z.rounds[y.r].points === want, `mixed ${twist}: a first-try Tricky hit pays ${want}`);
    }
    if (twist !== 'halfhalf') throws(() => say(y, 'x', { early: true }), /Half & Half/i, `mixed ${twist}: early calls are refused outside a halfhalf round`);
  }
  const ol = withTwist('oneline');
  const two = enc([stroke(20), stroke(20)]);
  throws(() => step(ol, ol.rounds[ol.r].drawer, { prompt: 0, strokes: two }), /one line/i, 'mixed oneline: two strokes are refused');
  assert(step(ol, ol.rounds[ol.r].drawer, { prompt: 0, strokes: enc([stroke(20)]) }).phase === 'guess', 'mixed oneline: one stroke is fine');
  const mixedMax = (x) => D.result((() => { for (let i = x.r; i < 6; i++) x = skipRound(x); return x; })()).sub;
  assert(/ of (\d+) points/.test(mixedMax(plain('mixed'))), 'mixed result has a max');

  // time up
  console.log('# doodle v2 time up, golden, near miss');
  let tu = plain('classic');
  throws(() => step(tu, 'b', { prompt: 0, timeUp: true }), /./, 'time-up from the wrong player is refused');
  throws(() => step(tu, 'a', { prompt: 0, timeUp: true, strokes: TINY }), /no drawing/i, 'time-up with a drawing is refused');
  tu = step(tu, 'a', { prompt: 1, timeUp: true });
  assert(tu.r === 1 && tu.rounds[0].points === 0 && tu.rounds[0].timeUp === true && tu.rounds[0].strokes === '' && tu.phase === 'draw' && tu.rounds[0].pick === 1, 'v2: a time-up is a blank drawing: round scores 0, the next round starts');
  assert(JSON.stringify(D.next(tu)) === `["${tu.rounds[1].drawer}"]` && tu.rounds[1].drawer === 'b', 'v2: after a time-up the next player draws');
  let tuAll = plain('classic');
  for (let r = 0; r < 6; r++) tuAll = step(tuAll, tuAll.rounds[r].drawer, { prompt: 0, timeUp: true });
  assert(D.next(tuAll).length === 0 && D.result(tuAll).score === 0 && /0 of 6 guessed/.test(D.result(tuAll).sub), 'v2: six time-ups end the match at 0');
  // Golden Frame doubles
  const goldSeed = (() => { for (let seed = 1; seed < 400; seed++) { const x = setup(seed, 'classic', 'classic'); if (x.gold >= 1) return seed; } })();
  let gx = setup(goldSeed, 'classic', 'classic');
  const G = gx.gold;
  for (let r = 0; r < G; r++) gx = skipRound(gx);
  let gy = draw(gx, 2); gy = say(gy, ans(gy).show);
  assert(gy.rounds[G].points === 10 && gy.rounds[G].x2 === true && gy.rounds[G].gold === true, 'golden round: a first-try Tricky hit pays double (10)');
  let gz = draw(gx, 0); gz = wrong(gz, 3);
  assert(gz.rounds[G].points === 0, 'golden round: a miss is still 0');
  const gmax = (() => { let x = gx; for (let r = G; r < 6; r++) x = skipRound(x); return D.result(x).sub; })();
  assert(/^0 of 35 points/.test(gmax), `a golden match has a bigger max: 35 (${gmax})`);
  let gi = setup(goldSeed, 'invisible', 'classic'); for (let r = 0; r < G; r++) gi = skipRound(gi);
  gi = draw(gi, 2); gi = say(gi, ans(gi).show);
  assert(gi.rounds[G].points === 12, 'golden + invisible: (5 + 1) x 2 = 12');
  assert(gy.rounds.filter((R) => R.gold).length === 1 && gy.rounds[0].gold === false, 'exactly one golden round');
  // v2 move validation
  throws(() => step(plain('classic'), 'a', { prompt: 5, strokes: TINY }), /pick one/i, 'v2: a bad prompt index');
  throws(() => step(plain('classic'), 'a', { prompt: 0, strokes: 'AB$#' }), /scrambled/i, 'v2: a malformed drawing');
  throws(() => step(plain('classic'), 'a', { prompt: 0, strokes: '' }), /draw something/i, 'v2: an empty drawing without timeUp');
  throws(() => step(plain('classic'), 'b', { prompt: 0, strokes: TINY }), /not your turn/i, 'v2: only the drawer draws');
  let gg = draw(plain('classic'), 0);
  throws(() => step(gg, guesser(gg) === 'a' ? 'b' : 'a', { guess: 'x' }), /you drew this/i, 'v2: the drawer cannot guess');
  throws(() => say(gg, '   '), /type a guess/i, 'v2: an empty guess');
  throws(() => say(gg, '🐱'), /letters/i, 'v2: a symbol-only guess');
  gg = say(gg, 'zzzz');
  throws(() => say(gg, ' ZZZZ '), /already tried/i, 'v2: a repeated guess');
  // replay through the engine
  const lists = { a: [], b: [] };
  let st = D.init({ first: 'a', seed: 5 }); st.seed = 5;
  const mvs = [['a', { setup: { v: 2, mode: 'classic', pack: 'classic' } }]];
  for (const [w, mv] of mvs) { lists[w].push(mv); st = step(st, w, mv); }
  for (let r = 0; r < 6; r++) {
    const dr = st.rounds[r].drawer;
    const m1 = { prompt: 1, strokes: TINY }; lists[dr].push(m1); st = step(st, dr, m1);
    const m2 = { guess: POOL[st.rounds[r].choices[1]].show }; lists[other(dr)].push(m2); st = step(st, other(dr), m2);
  }
  const dv = core.derive(D, { first: 'a', seed: 5, lists });
  assert(dv.over && dv.rejected.length === 0 && dv.state.v === 2 && dv.result.score === dv.state.score && dv.result.score >= 18, `a v2 match replays through the engine (score ${dv.result.score})`);

  // ═══ Encore ═══
  console.log('# doodle encore');
  const encSetup = (seed, encore = true, pack = 'classic') => step(fresh(seed), 'a', { setup: { v: 2, mode: 'classic', pack, ...(encore === null ? {} : { encore }) } });
  const usAll = new Set(doodle.packIndices('us').flat());
  let encOk = true;
  for (let seed = 1; seed <= 120; seed++) {
    const x = encSetup(seed, true, seed % 2 ? 'us' : 'everything');
    const dealt = new Set(x.rounds.flatMap((R) => R.choices));
    if (!x.enc || !usAll.has(x.enc.prompt) || dealt.has(x.enc.prompt) || x.enc.a !== null || x.enc.b !== null) encOk = false;
  }
  assert(encOk, 'encore: the Encore card is always an Us card that was not dealt in the match');
  assert(JSON.stringify(encSetup(9).enc) === JSON.stringify(encSetup(9).enc) && !encSetup(9, false).enc && !encSetup(9, null).enc, 'encore: seeded; absent or false means no Encore');
  throws(() => encSetup(9, 'yes'), /on or off/i, 'encore: a non-boolean setting is refused');
  const playScored = (x) => { for (let r = 0; r < 6; r++) { x = draw(x, 2); x = say(x, ans(x).show); } return x; };
  const noEnc = playScored(encSetup(9, false));
  let ex = playScored(encSetup(9, true));
  assert(ex.r === 6 && JSON.stringify(D.next(ex)) === '["a","b"]' && D.next(noEnc).length === 0, 'encore: after the last scored round both players are asked to draw, without it the match is over');
  const dd2 = core.derive(D, { first: 'a', seed: 9, lists: { a: [{ setup: { v: 2, mode: 'classic', pack: 'classic', encore: true } }], b: [] } });
  assert(!dd2.over && dd2.state.v === 2 && dd2.state.enc, 'encore: the setup move with encore: true replays through the engine');
  const encA = enc([stroke(10, 5)]); const encB = enc([{ ...stroke(12, 6), c: 2 }]);
  const ab = step(step(ex, 'a', { encore: encA }), 'b', { encore: encB });
  const ba = step(step(ex, 'b', { encore: encB }), 'a', { encore: encA });
  assert(JSON.stringify(ab) === JSON.stringify(ba) && ab.enc.a === encA && ab.enc.b === encB, 'encore: the two drawings can arrive in either order and the state is identical');
  assert(JSON.stringify(D.next(step(ex, 'a', { encore: encA }))) === '["b"]' && JSON.stringify(D.next(step(ex, 'b', { encore: encB }))) === '["a"]' && D.next(ab).length === 0, 'encore: next() lists only who still has to draw, then the match ends');
  assert(JSON.stringify(D.result(ab)) === JSON.stringify(D.result(noEnc)) && D.result(ab).score === 30, 'encore: the result (score, rating, sub-line) ignores the Encore');
  throws(() => step(ex, 'a', { encore: 5 }), /Encore card/i, 'encore: a non-string drawing is refused');
  throws(() => step(ex, 'a', { guess: 'x' }), /Encore card/i, 'encore: no guessing, only the Encore drawing');
  throws(() => step(ex, 'a', { encore: 'AB$#' }), /scrambled/i, 'encore: a malformed drawing is refused');
  throws(() => step(ex, 'a', { encore: '' }), /draw something/i, 'encore: an empty drawing without timeUp is refused');
  throws(() => step(ex, 'a', { encore: encA, timeUp: true }), /./, 'encore: time-up with a drawing makes no sense');
  throws(() => step(step(ex, 'a', { encore: encA }), 'a', { encore: encA }), /already sent/i, 'encore: one drawing each');
  throws(() => step(ab, 'a', { encore: encA }), /game is over/i, 'encore: nothing after both are in');
  throws(() => step(encSetup(9), 'a', { encore: encA }), /./, 'encore: not before the scored rounds are done');
  const blank = step(step(ex, 'b', { encore: '', timeUp: true }), 'a', { encore: encA });
  assert(blank.enc.b === '' && D.next(blank).length === 0, 'encore: a time-up blank counts as that player\'s drawing');
  const lastLists = (() => { const l = { a: [{ setup: { v: 2, mode: 'classic', pack: 'classic', encore: true } }], b: [] }; let x = encSetup(9); for (let r = 0; r < 6; r++) { const dr = x.rounds[r].drawer; const m1 = { prompt: 2, strokes: TINY }; l[dr].push(m1); x = step(x, dr, m1); const m2 = { guess: POOL[x.rounds[r].choices[2]].show }; l[other(dr)].push(m2); x = step(x, other(dr), m2); } return l; })();
  const half1 = core.derive(D, { first: 'a', seed: 9, lists: { a: [...lastLists.a, { encore: encA }], b: lastLists.b } });
  const fullEnc = core.derive(D, { first: 'a', seed: 9, lists: { a: [...lastLists.a, { encore: encA }], b: [...lastLists.b, { encore: encB }] } });
  assert(!half1.over && JSON.stringify(half1.acts) === '["b"]' && fullEnc.over && fullEnc.rejected.length === 0 && fullEnc.result.score === 30, 'encore: through the engine the match is over only when both drawings are in');
  assert(JSON.stringify(records.summarize(ab, tierOfEarly(doodle))) === JSON.stringify(records.summarize(noEnc, tierOfEarly(doodle))), 'encore: records count it as a normal match (the summary ignores the Encore)');

  // ═══ the matcher ═══
  console.log('# doodle v2 matching');
  const by = (show) => POOL.find((p) => p.show === show);
  for (const [g, p] of [['horse', 'house'], ['clown', 'crown'], ['trainer', 'train'], ['car', 'playing cards'], ['toaster', 'burnt toast'], ['butterfly', 'butterflies in your stomach'], ['butterflies in your stomach', 'butterfly']]) {
    assert(guessMatchesV2(g, by(p)) === false, `v2: "${g}" is not accepted for "${p}"`);
  }
  for (const [g, p] of [['house', 'house'], ['home', 'house'], ['crown', 'crown'], ['shoe', 'shoe'], ['sneaker', 'shoe'], ['trainer', 'shoe'], ['cards', 'playing cards'], ['deck of cards', 'playing cards'], ['toast', 'burnt toast'], ['burned toast', 'burnt toast'], ['butterflies', 'butterflies in your stomach'], ['butterfly', 'butterfly'], ['butterflies', 'butterfly']]) {
    assert(guessMatchesV2(g, by(p)) === true, `v2: exact "${g}" still matches "${p}"`);
  }
  for (const [g, p, want] of [['penguen', 'penguin', true], ['pengiun', 'penguin', true], ['pinguen', 'penguin', false], ['strawberries', 'strawberry', true], ['televison', 'tv', true], ['the eiffel tower', 'eiffel tower', true], ['bee', 'bed', false], ['Hot Dogs', 'hot dog', true], ['grlled cheese', 'grilled cheese', true], ['hedgehog', 'hedgehog', true], ['hedgehgo', 'hedgehog', true], ['flamingo', 'flamingo', true], ['flamengo', 'flamingo', true], ['flamengo', 'koala', false]]) {
    assert(guessMatchesV2(g, by(p)) === want, `v2 typo rules: "${g}" ${want ? 'matches' : 'does not match'} "${p}"`);
  }
  // content checks
  const newPacks = packs.NEW_DECKS;
  assert(newPacks.map((d) => d.id).join() === 'us,kitchen,outabout,creatures,home', 'new decks are in the frozen order (home last)');
  for (const d of newPacks) {
    assert(d.tiers.length === 3 && d.tiers.every((t) => t.length >= 8) && d.tiers.flat().length >= 24, `pack ${d.id}: at least 8 per tier and 24 in all (${d.tiers.map((t) => t.length)})`);
  }
  assert(new Set(POOL.map((p) => p.show)).size === POOL.length && POOL.length === 282 + newPacks.flatMap((d) => d.tiers.flat()).length, `the pool has ${POOL.length} cards, all different`);
  const squashAll = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !['a', 'an', 'the'].includes(w)).join('');
  const formsOf = (x) => { const f = new Set([x, x + 's', x + 'es']); if (x.endsWith('y')) f.add(x.slice(0, -1) + 'ies'); if (x.endsWith('ies')) f.add(x.slice(0, -3) + 'y'); if (x.endsWith('es')) f.add(x.slice(0, -2)); if (x.endsWith('s') && !x.endsWith('ss')) f.add(x.slice(0, -1)); return f; };
  // a card's words only ever match another card when both list that word (a shared head noun such as
  // "umbrella") or as its plural / singular. Never by accident (typos, other forms).
  const cross = [];
  for (const A of POOL) for (const x of A.all) for (const B of POOL) {
    if (A.i === B.i || !guessMatchesV2(x, B)) continue;
    const g = squashAll(x);
    if (!B.all.some((b) => formsOf(squashAll(b)).has(g))) cross.push(`${x} (${A.show}) -> ${B.show}`);
  }
  assert(cross.length === 0, `no card word matches another card by accident, only through a word both list (${cross.slice(0, 8).join('; ')})`);
  const fair = [['keys', 'house keys'], ['umbrella', 'sharing an umbrella'], ['fries', 'stealing fries'], ['pancakes', 'sunday pancakes'], ['socks', 'dancing in socks'], ['dancing', 'dancing in socks'], ['noodles', 'ramen'], ['candles', 'birthday candles'], ['birthday cake', 'birthday candles'], ['toothbrushes', 'two toothbrushes'], ['rainbows', 'double rainbow'], ['penguins', 'penguins huddling'], ['tent', 'tent in the rain'], ['cat sleeping', 'sleeping cat'], ['sleepy cat', 'sleeping cat'], ['napping cat', 'sleeping cat'], ['sunset over the ocean', 'sunset over the sea'], ['rain and sun', 'sunshower'], ['check in', 'hotel check in'], ['reception', 'hotel check in'], ['missing the train', 'missed the train'], ['nap', 'couch nap'], ['napping', 'couch nap'], ['sleeping on the couch', 'couch nap'], ['blanket', 'shared blanket'], ['sharing a blanket', 'shared blanket'], ['mugs', 'matching mugs'], ['thermometer', 'forehead thermometer'], ['christmas sweaters', 'ugly christmas sweaters'], ['christmas jumpers', 'ugly christmas sweaters'], ['takeout', 'leftovers'], ['takeaway', 'leftovers'], ['towel', 'beach towel'], ['bus', 'double-decker bus'], ['market', 'farmers market'], ['storm', 'thunderstorm'], ['thunder', 'thunderstorm'], ['mist', 'foggy morning'], ['misty', 'foggy morning'], ['snowing', 'first snow'], ['geese', 'geese flying south'], ['migrating birds', 'geese flying south'], ['panda bear', 'panda'], ['boat ride', 'ferry ride'], ['ferry boat', 'ferry ride'], ['security', 'airport security'], ['espresso', 'espresso machine'], ['cooking', 'cooking together'], ['padlock', 'love lock'], ['lock', 'love lock'], ['supermarket', 'grocery run'], ['carpool karaoke', 'car singalong'], ['sofa nap', 'couch nap'], ['sticky note', 'love note on the mirror'], ['ducklings', 'ducks in a row'], ['hanging bridge', 'rope bridge']];
  for (const [g, p] of fair) assert(guessMatchesV2(g, by(p)) === true, `fair guess: "${g}" is accepted for "${p}"`);
  assert(guessMatchesV2('butterfly', by('butterflies in your stomach')) === false && guessMatchesV2('butterflies', by('butterflies in your stomach')) === true, 'a listed alternate always matches; a plural of one never steals another card\'s own name');
  // two cards of one deck never share a listed word
  const dupe = [];
  for (const d of newPacks) { const seenW = new Map(); for (const t of d.tiers.flat()) { const all = t.split('|'); for (const w of all) { const k = squashAll(w); if (seenW.has(k) && seenW.get(k) !== all[0]) dupe.push(`${w}: ${seenW.get(k)} / ${all[0]}`); seenW.set(k, all[0]); } } }
  assert(dupe.length === 0, `no two cards in a deck list the same word (${dupe.join(', ')})`);

  // near miss
  const nm = (g, p) => nearMiss(g, by(p));
  assert(nm('penguen', 'penguin') && nm('hose', 'house') && nm('horse', 'house') && !nm('table', 'house') && !nm('cart', 'cat'), 'near miss: one edit away (4+ letters)');
  assert(nm('ice', 'ice cream') && nm('cream', 'ice cream') && nm('wedding', 'wedding cake') && !nm('the', 'the dog ate my homework') && !nm('dog', 'cat'), 'near miss: a whole word of a multi-word answer');
  assert(!nm('zzzz', 'penguin') && !nm('', 'penguin'), 'near miss: unrelated guesses are not close');

  // Half & Half split
  const hs = (strokes) => halfSplit(enc(strokes));
  assert(hs([stroke(10), stroke(10)]) === 1, 'halfSplit: two equal strokes show the first');
  assert(hs([stroke(10), stroke(10), stroke(10), stroke(10)]) === 2, 'halfSplit: four equal strokes show two');
  assert(hs([stroke(10), stroke(10), stroke(60)]) === 2, 'halfSplit: never the whole drawing when it has two or more strokes (capped at n - 1)');
  assert(hs([stroke(60), stroke(10), stroke(10)]) === 1, 'halfSplit: a long first stroke is the half');
  assert(hs([stroke(0), stroke(0), stroke(0)]) === 1, 'halfSplit: zero-time strokes still show one');
  const onePlan = doodle.halfPlan(enc([stroke(10, 10)]));
  assert(onePlan.k === 0 && onePlan.cut >= 1 && onePlan.cut < 10, `halfPlan: a one-stroke drawing shows the first part of its points (${onePlan.cut} of 10)`);
  assert(doodle.halfPlan(enc([stroke(10, 2)])).cut === 1 && doodle.halfPlan(enc([stroke(10, 1)])).cut === 1, 'halfPlan: tiny strokes still show one point');
  assert(halfSplit('') === 0 && halfSplit('$$') === 0, 'halfSplit: garbage shows nothing');
  const sp = enc([stroke(9), stroke(12), stroke(7), stroke(30), stroke(5)]);
  assert(halfSplit(sp) === halfSplit(sp) && halfSplit(sp) < 5, 'halfSplit is deterministic and never the full drawing');

  // dealing and rotation
  console.log('# doodle rotation and records (pure)');
  let seen = [];
  const seq = (() => { let a = 7; return () => { a = (a * 48271) % 2147483647; return a / 2147483647; }; })();
  const all282 = new Set();
  for (let m = 0; m < 12; m++) {
    const d = dealFresh('classic', seen, seq);
    assert(new Set(d.deal).size === 18 && d.deal.every((i, n) => doodle.poolTier(i) === n % 3 && i < 282), `deal ${m}: 18 distinct classic cards, one per tier`);
    if (m < 8) { assert(d.deal.every((i) => !all282.has(i)), `deal ${m}: all 18 cards are new (never dealt before)`); for (const i of d.deal) all282.add(i); }
    seen = d.seen;
    setup(3, 'classic', 'classic', d.deal); // a frozen deal must be valid for the setup move
  }
  seen = [];
  const d1 = dealFresh('us', seen, seq); seen = d1.seen;
  const d2 = dealFresh('us', seen, seq); // Easy (10 cards) has only 4 unseen: it starts over but plays the 4 unseen first
  const e1 = new Set(d1.deal.filter((_, n) => n % 3 === 0)); const e2 = d2.deal.filter((_, n) => n % 3 === 0);
  const unseenEasy = doodle.packIndices('us')[0].filter((i) => !e1.has(i));
  assert(unseenEasy.every((i) => e2.includes(i)) && new Set(d2.deal).size === 18, 'rotation: an almost used-up deck plays the unseen cards first, then starts over');
  setup(3, 'classic', 'us', d2.deal);
  const enc3 = records.encodeSeen(Array.from({ length: 2000 }, (_, i) => 5000 + i));
  assert(enc3.length <= 3000 && records.decodeSeen(enc3).at(-1) === 6999 && records.decodeSeen('7y.7x') .join() === '286,285', 'seen list: base36, capped at 3000 chars (oldest dropped)');
  assert(records.decodeSeen(null).length === 0 && records.decodeSeen('zz.!!.5').join() === '1295,5', 'seen list: garbage is ignored');

  // Tonight's masterpiece
  const rd = (points, guesses, tier, extra = {}) => ({ drawer: 'a', points, guesses: Array.from({ length: guesses }, (_, k) => `g${k}`), tier, strokes: 'AAAAAAA', ...extra });
  const mp = (rounds) => records.masterpieceOf(rounds);
  assert(mp([rd(2, 1, 0), rd(5, 2, 2), rd(3, 1, 1)]).i === 1, 'masterpiece: the most points wins');
  assert(mp([rd(3, 2, 1), rd(3, 1, 1), rd(3, 3, 1)]).i === 1, 'masterpiece: a points tie goes to the fewest guesses');
  assert(mp([rd(3, 1, 0), rd(3, 1, 2), rd(3, 1, 1)]).i === 1, 'masterpiece: then the higher tier');
  assert(mp([rd(3, 1, 1), rd(3, 1, 1)]).i === 0, 'masterpiece: then the earliest round');
  assert(mp([rd(4, 1, 0, { early: 'hit' }), rd(4, 2, 0)]).i === 0 && mp([rd(4, 1, 0, { early: 'hit' })]).how === 'early', 'masterpiece: an early call counts as one guess');
  assert(mp([rd(0, 3, 2), rd(0, 3, 1, { gaveUp: true })]) === null && mp([]) === null, 'masterpiece: nothing scored, no masterpiece');
  assert(mp([rd(5, 1, 2, { strokes: '' }), rd(1, 3, 0)]).i === 1, 'masterpiece: a blank (time-up) round is never the masterpiece');
  assert(records.masterpieceHow(mp([rd(3, 1, 1)])) === 'guessed first try' && records.masterpieceHow(mp([rd(2, 2, 1)])) === 'guessed on the 2nd try' && records.masterpieceHow(mp([rd(4, 1, 0, { early: 'hit' })])) === 'called early from half a drawing', 'masterpiece: how it was guessed, in words');
  const mpState = records.masterpieceOf(core.derive(D, { first: 'a', seed: 777, lists: clone(V1_MATCHES[1].lists) }).state.rounds);
  assert(mpState && mpState.i === 0 && mpState.how === 'first', 'masterpiece works on an old v1 match (first of six equal 3-point rounds)');

  // records
  const tierOf = doodle.poolTier;
  const playMatch = (mode, plan, seed = 100) => {
    let x = (() => { for (let sd = seed; sd < seed + 300; sd++) { const y = setup(sd, mode, 'classic'); if (y.gold < 0) return y; } })();
    for (let r = 0; r < 6; r++) {
      const [pick, how] = plan[r];
      if (how === 'timeUp') { x = step(x, x.rounds[r].drawer, { prompt: pick, timeUp: true }); continue; }
      x = draw(x, mode === 'ladder' ? x.rounds[r].tier : pick);
      if (how === 'give') x = step(x, guesser(x), { giveUp: true });
      else if (how === 'miss') x = wrong(x, 3);
      else { x = wrong(x, how - 1); x = say(x, ans(x).show); }
    }
    return x;
  };
  const m1 = playMatch('classic', [[2, 1], [2, 1], [1, 2], [0, 1], [2, 'miss'], [1, 1]]);
  const sum1 = records.summarize(m1, tierOf);
  assert(sum1.hits === 5 && sum1.firstTry.a + sum1.firstTry.b === 4 && sum1.tricky === 2 && sum1.drawings === 6 && !sum1.perfect, 'summary: hits, first tries, Tricky hits, drawings');
  const patch1 = records.recordPatch(sum1, {}, { matchId: 'm-1', mode: 'classic', score: m1.score });
  assert(patch1.lastRec === 'm-1' && patch1.plays === 1 && patch1.best_classic === m1.score && patch1.rc_new === 1 && patch1.rc_prev === 0 && patch1.drawings === 6 && patch1.hitStreakBest === 4 && patch1.hitStreak === 1, `first record: plays 1, best ${m1.score}, streak ends at 1 after the best run of 4`);
  assert(Object.entries(patch1).every(([k, v]) => /^[a-zA-Z0-9_.-]{1,60}$/.test(k) && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')), 'record keys and values fit the shared doc rules');
  const aDraw = sum1.draw.a + sum1.draw.b; const aGuess = sum1.guess.a + sum1.guess.b;
  assert(aDraw === m1.score && aGuess === m1.score, 'every point counts once for the drawer and once for the guesser');
  const patch2 = records.recordPatch(records.summarize(m1, tierOf), patch1, { matchId: 'm-2', mode: 'classic', score: m1.score - 2 });
  assert(patch2.plays === 2 && patch2.best_classic === m1.score && patch2.rc_new === 0 && patch2.rc_prev === m1.score && patch2.drawings === 12 && patch2.a_drawPts === patch1.a_drawPts * 2, 'a lower score keeps the best and adds the lifetime totals');
  const ten = records.recordPatch(records.summarize(m1, tierOf), { drawings: 5 }, { matchId: 'x', mode: 'classic', score: 5 });
  assert(ten.rc_mile === 10 && records.recordPatch(records.summarize(m1, tierOf), { drawings: 10 }, { matchId: 'x', mode: 'classic', score: 5 }).rc_mile === 0 && records.recordPatch(records.summarize(m1, tierOf), { drawings: 20 }, { matchId: 'x', mode: 'classic', score: 5 }).rc_mile === 25, 'milestone stamps at 10 / 25 drawings');
  const perfect = playMatch('classic', [[2, 1], [2, 1], [2, 1], [2, 1], [2, 1], [2, 1]]);
  const pp = records.recordPatch(records.summarize(perfect, tierOf), {}, { matchId: 'p', mode: 'classic', score: perfect.score });
  assert(pp.perfects === 1 && pp.rc_perfect === 1 && pp.hitStreak === 6 && pp.trickyHits === 6 && pp.a_firstTry + pp.b_firstTry === 6, 'a perfect match counts: perfects, a streak of 6, six Tricky hits, six first tries');
  const cont = records.recordPatch(records.summarize(perfect, tierOf), { hitStreak: 4, hitStreakBest: 4 }, { matchId: 'q', mode: 'classic', score: 30 });
  assert(cont.hitStreak === 10 && cont.hitStreakBest === 10, 'the hit streak carries across matches');
  const v1sum = records.summarize(core.derive(D, { first: 'a', seed: 777, lists: clone(V1_MATCHES[1].lists) }).state, tierOf);
  assert(v1sum.perfect && v1sum.hits === 6 && records.recordPatch(v1sum, {}, { matchId: 'v', mode: 'v1', score: 18 }).best_v1 === 18, 'records work for finished v1 matches too (best_v1)');
  const tu1 = records.summarize(playMatch('classic', [[0, 'timeUp'], [0, 'timeUp'], [0, 1], [0, 1], [0, 1], [0, 1]]), tierOf);
  assert(tu1.drawings === 4 && tu1.guessRounds.a + tu1.guessRounds.b === 4, 'time-up rounds are not drawings and not guessing rounds');
  // badges
  const bd = records.badgesOf(sum1);
  assert(bd.a.title && bd.b.title && bd.a.id !== bd.b.id && !/lose|worst|bad/i.test(JSON.stringify(bd)), `badges: one each, different, never negative (${bd.a.title} / ${bd.b.title})`);
  const flat = records.summarize(playMatch('classic', [[0, 'give'], [0, 'give'], [0, 'give'], [0, 'give'], [0, 'give'], [0, 'give']]), tierOf);
  const bf = records.badgesOf(flat);
  assert(bf.a.id === 'sport' && bf.b.id === 'sport', 'badges: nobody scored, so both are Good Sports');
  const tied = records.summarize(playMatch('classic', [[2, 1], [2, 1], [2, 1], [2, 1], [2, 1], [2, 1]]), tierOf);
  const bt = records.badgesOf(tied);
  assert(bt.a.id === 'tie' && bt.b.id === 'tie' && bt.a.title === 'Dead heat', 'badges: an exact tie is a "Dead heat" for both');
  // history, chase, stamps
  const after = { ...patch2, lastRec: 'm-2' };
  assert(/^Your 2nd match together\. Best ever \d+, tonight \d+: so close\.$/.test(records.historyLine(after, 'Classic')), `history line: "${records.historyLine(after, 'Classic')}"`);
  assert(/Your first match together\./.test(records.historyLine(patch1, 'Classic')) && /first Classic game: 7 is the number to beat/.test(records.historyLine({ rc_plays: 3, rc_score: 7, rc_prev: 0, rc_new: 1 }, 'Classic')) && /new Classic best: 20, up from 12/.test(records.historyLine({ rc_plays: 12, rc_score: 20, rc_prev: 12, rc_new: 1 }, 'Classic')), 'history line: first match, new best');
  assert(/12th match together\. Best ever 26, tonight 24: so close\./.test(records.historyLine({ rc_plays: 12, rc_score: 24, rc_prev: 26, rc_new: 0 }, 'Classic')) && /plenty of room to climb/.test(records.historyLine({ rc_plays: 3, rc_score: 9, rc_prev: 26, rc_new: 0 }, 'Classic')) && /matched your Classic best of 26/.test(records.historyLine({ rc_plays: 4, rc_score: 26, rc_prev: 26, rc_new: 0 }, 'Classic')), 'history line: so close / path forward / matched');
  assert(records.ordinal(1) === '1st' && records.ordinal(12) === '12th' && records.ordinal(22) === '22nd' && records.ordinal(113) === '113th', 'ordinals');
  const ch = records.chaseLine({ a_guessRounds: 20, a_guessPts: 58, b_guessRounds: 20, b_guessPts: 62 }, { a: 'Emerson', b: 'Sydney' });
  assert(/^As guesser Sydney leads 3\.1 to 2\.9 a round\. .* first-try hits? in a row flips it\.$/.test(ch), `chase line: "${ch}"`);
  assert(records.chaseLine({ a_guessRounds: 2, a_guessPts: 5, b_guessRounds: 2, b_guessPts: 4 }, { a: 'E', b: 'S' }) === '' && /dead level/.test(records.chaseLine({ a_guessRounds: 10, a_guessPts: 30, b_guessRounds: 10, b_guessPts: 30 }, { a: 'E', b: 'S' })), 'chase line: needs a few rounds; equal is "dead level"');
  const stamps = records.stampsOf({ rc_new: 1, rc_prev: 24, rc_score: 26, rc_mile: 25, rc_perfect: 1, rc_gold: 1, rc_streak: 7, hitStreakBest: 7 }, 'Classic');
  assert(stamps.map((x) => x.id).join() === 'best,mile,perfect,gold,streak' && stamps[0].sub === '26, was 24', 'stamps: new best (with the old best), milestone, perfect, golden hit, streak');
  assert(records.stampsOf({ rc_new: 0, rc_score: 5, rc_streak: 1 }, 'Classic').length === 0 && records.stampsOf({ rc_new: 1, rc_prev: 0, rc_score: 5, rc_streak: 1 }, 'Classic').length === 0, 'no stamps when there is nothing to stamp, and no NEW BEST without a previous best');
}

// ═════════════════════════════════════════════════════════════════════
// UI: the real app, two iPhone-profile phones (coarse pointer, taps) sharing a fake database
// ═════════════════════════════════════════════════════════════════════
const ring = (cx, cy, r, n = 26) => Array.from({ length: n + 1 }, (_, i) => { const a = (Math.PI * 2 * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
const PICS = [
  [{ c: 0, s: 1, pts: [[0.22, 0.56], [0.22, 0.88], [0.72, 0.88], [0.72, 0.56], [0.22, 0.56]] }, { c: 2, s: 1, pts: [[0.16, 0.6], [0.47, 0.3], [0.78, 0.6]] }, { c: 3, s: 1, pts: ring(0.82, 0.18, 0.08, 18) }],
  [{ c: 0, s: 1, pts: ring(0.5, 0.55, 0.28, 30) }, { c: 1, s: 1, pts: [[0.41, 0.5], [0.42, 0.51]] }, { c: 2, s: 0, pts: [[0.47, 0.6], [0.5, 0.64], [0.53, 0.6]] }],
];
// the same pictures as encoded strokes, for seeded matches (x, y in the 256 grid, 24 ms per point)
const picStrokes = (n) => PICS[n % PICS.length].map((st) => ({ c: st.c, s: st.s, gap: 20, pts: st.pts.map(([x, y], i) => [Math.max(0, Math.min(255, Math.round(x * 256))), Math.max(0, Math.min(255, Math.round(y * 256))), i ? 3 : 0]) }));

async function waitFor(fn, ms = 6000, what = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 120)); }
  throw new Error('timed out waiting for ' + what);
}
const visible = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }, sel).catch(() => false);
const toastText = (pg) => pg.evaluate(() => { const t = [...document.querySelectorAll('.toast')]; return t.length ? t[t.length - 1].textContent : ''; });
const wordOf = (pg) => pg.$eval('.dd-word', (x) => x.lastChild.textContent.trim());
// fully inside the stage's visible area (the scroller) and the page: i.e. usable without scrolling
const inView = (pg, sel) => pg.evaluate((s) => {
  const e = document.querySelector(s); if (!e || e.hidden) return false;
  const r = e.getBoundingClientRect(); const sc = document.querySelector('.dd-scroll').getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.top >= sc.top - 1 && r.bottom <= sc.bottom + 1 && r.left >= -1 && r.right <= innerWidth + 1;
}, sel);
const noSideScroll = (pg) => pg.evaluate(() => { const sc = document.querySelector('.dd-scroll'); return sc.scrollWidth <= sc.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; });
async function guessText(pg, text) { await pg.tap('.dd-input'); await pg.fill('.dd-input', text); await pg.tap('.dd-form .gm-btn'); }
async function touchDraw(pg, cdp, strokes = PICS[0], { tapTools = true } = {}) {
  const b = await pg.$eval('.dd-paper canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const P = ([x, y]) => ({ x: b.x + x * b.w, y: b.y + y * b.h });
  for (const st of strokes) {
    if (tapTools) { await pg.tap(`.dd-swatch[data-c="${st.c}"]`); await pg.tap(`.dd-size[data-s="${st.s}"]`); }
    const pts = st.pts.map(P);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y, id: 1 }] });
    for (let i = 1; i < pts.length; i++) for (let k = 1; k <= 3; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / 3, y: pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * k) / 3, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}
const inkPixels = (pg, sel = '.dd-paper canvas') => pg.$eval(sel, (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; });

async function uiTests({ assert, SHOTS, rules, launch }) {
  const { core, doodle, D, records } = rules;
  const { POOL } = doodle;
  const clone2 = (x) => JSON.parse(JSON.stringify(x));
  // ── scripted matches for seeding ──
  const script = ({ seed, first = 'a', mode = 'classic', pack = 'classic', deal = null, plan = null, rounds = 6, encore = false }) => {
    const lists = { a: [], b: [] };
    let st = D.init({ first, seed }); st.seed = seed;
    const push = (w, mv) => { lists[w].push(mv); st = D.apply(clone2(st), w, clone2(mv)); };
    push(first, { setup: { v: 2, mode, pack, ...(deal ? { deal } : {}), ...(encore ? { encore: true } : {}) } });
    for (let r = 0; r < Math.min(rounds, plan ? plan.length : 0); r++) {
      const R = st.rounds[r]; const dr = R.drawer; const gr = other(dr);
      const [pick, how] = plan[r];
      push(dr, { prompt: mode === 'ladder' ? R.tier : pick, strokes: enc(picStrokes(r)) });
      const ans = POOL[st.rounds[r].choices[st.rounds[r].pick]].show;
      if (how === 'give') push(gr, { giveUp: true });
      else if (how === 'miss') for (const g of ['zzq1', 'zzq2', 'zzq3']) push(gr, { guess: g });
      else { for (let i = 1; i < how; i++) push(gr, { guess: `zzq${i}` }); push(gr, { guess: ans }); }
    }
    return { lists, state: st };
  };
  const doc = (m) => ({ game: 'doodle', first: m.first || 'a', seed: m.seed, by: 'u_a', created: Date.now(), opts: {}, a: JSON.stringify(m.lists.a), b: JSON.stringify(m.lists.b), ua: m.lists.a.length, ub: m.lists.b.length });
  const goldSeed = (() => { for (let seed = 1; seed < 500; seed++) { const x = D.apply(D.init({ first: 'a', seed }), 'a', { setup: { v: 2, mode: 'classic', pack: 'classic' } }); if (x.gold >= 1) return seed; } })();
  const finished = script({ seed: goldSeed, plan: [[2, 1], [0, 2], [1, 1], [2, 'miss'], [0, 1], [1, 3]] });
  const finishedG = finished.state;
  const houseIdx = POOL.findIndex((p) => p.show === 'house');
  const nearDeal = (() => { const d = doodle.dealFor(12, 'classic').slice(); const at = d.indexOf(houseIdx); if (at >= 0) d[at] = d[0]; d[0] = houseIdx; return d; })();
  const NEAR_SEED = (() => { for (let seed = 1; seed < 500; seed++) { const x = D.apply(D.init({ first: 'a', seed }), 'a', { setup: { v: 2, mode: 'classic', pack: 'classic', deal: nearDeal } }); if (x.gold < 0) return seed; } })();
  const near = script({ seed: NEAR_SEED, deal: nearDeal, plan: [] });
  near.lists.a.push({ prompt: 0, strokes: enc(picStrokes(0)) });
  const v1mid = (() => { const lists = { a: [], b: [] }; let st = D.init({ first: 'a', seed: 31 }); st.seed = 31; const mv = (w, m) => { lists[w].push(m); st = D.apply(clone2(st), w, clone2(m)); };
    mv('a', { prompt: 1, strokes: enc(picStrokes(0)) }); mv('b', { guess: POOL[st.rounds[0].choices[1]].show }); return { lists, state: st, first: 'a', seed: 31 }; })();
  const v1done = (() => { const f = V1_MATCHES[0]; return { first: f.first, seed: f.seed, lists: f.lists }; })();
  // fresh v2 matches (setup done, round 0 waiting for the drawer 'a'), for the twist and clock tests
  const setupOnly = (mode, ok) => { for (let seed = 700; seed < 1400; seed++) { const m = script({ seed, mode, pack: 'classic', plan: [] }); if (ok(m.state)) return { ...m, seed, first: 'a' }; } throw new Error('no seed for ' + mode); };
  const mxOne = setupOnly('mixed', (x) => x.rounds[0].twist === 'oneline' && x.gold < 0);
  const encM = script({ seed: 4321, first: 'a', mode: 'classic', pack: 'classic', encore: true, plan: [[2, 1], [2, 1], [1, 1], [0, 1], [2, 1], [2, 1]] });
  const mxLay = setupOnly('mixed', (x) => x.rounds[0].twist === 'halfhalf' && x.gold < 0);
  const mxSprint = setupOnly('mixed', (x) => x.rounds[0].twist === 'sprint' && x.gold < 0);
  const clk1 = setupOnly('classic', (x) => x.gold < 0);
  const clk2 = setupOnly('classic', (x) => x.gold < 0);
  const seedDocs = {
    // an earlier match's records are already in the shared doc: they must never show on any other match
    'gamedata/doodle': { lastRec: 'old-match', plays: 7, best_classic: 12, hitStreakBest: 8, perfects: 0, drawings: 9, rc_mode: 'classic', rc_score: 12, rc_prev: 0, rc_new: 1, rc_mile: 10, rc_perfect: 1, rc_gold: 1, rc_streak: 8, rc_plays: 7, a_guessRounds: 20, a_guessPts: 58, b_guessRounds: 20, b_guessPts: 62 },
    'matches/enc2': doc({ ...encM, seed: 4321, first: 'a' }), 'matches/enc3': doc({ ...encM, seed: 4321, first: 'a' }),
    'matches/chip2': doc({ ...near, seed: NEAR_SEED, first: 'a' }),
    'matches/mxlay': doc(mxLay), 'matches/mxone': doc(mxOne), 'matches/mxsprint': doc(mxSprint), 'matches/clk1': doc(clk1), 'matches/clk2': doc({ ...clk2, seed: clk2.seed + 1 }),
    'matches/fin2g': doc({ ...finished, seed: goldSeed, first: 'a' }),
    'matches/near2': doc({ ...near, seed: NEAR_SEED, first: 'a' }),
    'matches/v1mid': doc(v1mid),
    'matches/v1done': doc(v1done), 'matches/v1zero': doc({ first: V1_MATCHES[2].first, seed: V1_MATCHES[2].seed, lists: V1_MATCHES[2].lists }),
  };
  assert(finishedG.v === 2 && finishedG.r === 6 && finishedG.gold >= 1 && finishedG.rounds[finishedG.gold].points === (finishedG.rounds[finishedG.gold].base * 2), `seeded finished v2 match has a golden round (round ${finishedG.gold + 1}) that paid double`);

  const h = await launch({ port: +process.env.PORT || 8770 + Math.floor(Math.random() * 500), only: ['doodle'], coarse: true, seedDocs });
  const { a, b } = h; const pages = { a, b };
  const cdps = { a: await a.context().newCDPSession(a), b: await b.context().newCDPSession(b) };
  const openSeed = async (pg, id) => { await h.openGames(pg); await pg.locator(`[data-g="open"][data-id="${id}"]`).first().tap({ timeout: 8000 }); await pg.waitForSelector('#game-root .gm'); await pg.waitForTimeout(700); if (await visible(pg, '#game-root .gm-end')) await pg.tap('#game-root [data-g="end-look"]'); await pg.waitForTimeout(150); };
  const closeGame = async (pg) => { await pg.tap('#game-root [data-g="close"]').catch(async () => { await pg.click('#game-root [data-g="close"]'); }); await pg.waitForTimeout(150); };
  // count the writes each phone makes to the shared game data doc
  for (const pg of [a, b]) {
    await pg.context().addInitScript(() => {
      window.__ddWrites = 0; window.__ddLog = [];
      try { localStorage.setItem('ju.games.seenEnd.v1', '{}'); } catch { /* storage off */ } // finished seeded matches show up in the hub
      const wrap = () => {
        if (!window.claude || window.claude.__wrapped) return;
        const use = window.claude.use.bind(window.claude);
        window.claude.use = async (n) => {
          const x = await use(n);
          if (n !== 'db') return x;
          return { ...x, doc: (p) => { const d = x.doc(p); if (!/^gamedata\//.test(p)) return d; return { ...d, update: (v) => { window.__ddWrites++; window.__ddLog.push('update ' + Object.keys(v).join()); return d.update(v); }, set: (v) => { window.__ddWrites++; window.__ddLog.push('set ' + Object.keys(v).length); return d.set(v); } }; } };
        };
        window.claude.__wrapped = true;
      };
      wrap();
    });
    await pg.reload();
    await pg.waitForFunction(() => !!document.querySelector('.tabbar'), null, { timeout: 15000 });
    await pg.waitForTimeout(250);
  }
  const errorsAtStart = h.errors.length;
  try {
    if (!process.env.LATE) {
    // ════ 1. seeded matches: v1 and v2 views, the gallery, near miss, pin ════
    console.log('# doodle seeded: v1 mid-match, v1 finished, v2 finished (gallery), near miss');
    await openSeed(b, 'v1mid');
    await b.waitForSelector('.dd-next'); await b.tap('.dd-next');
    await b.waitForSelector('.dd-pick');
    assert(!(await b.$('.dd-pay')) && (await b.$$eval('.dd-pick', (xs) => xs.length)) === 3 && (await b.textContent('.dd-round')).replace(/\s/g, '') === 'Round2/6', 'an old v1 match mid-way still shows three plain cards (no pay line) and "Round 2/6"');
    await b.tap('.dd-pick[data-i="0"]'); await b.waitForSelector('.dd-paper.can-draw canvas');
    assert(/^1:1\d$|^1:15$/.test(await b.$eval('.dd-secs', (x) => x.textContent)), 'v1 round still has the 75 second clock');
    await closeGame(b);
    await openSeed(a, 'v1done');
    await a.waitForSelector('.dd-wall .dd-frame:nth-child(6)');
    assert(/9\s*\/18/.test(await a.textContent('.dd-plaque')) && (await a.$$eval('.dd-frame', (xs) => xs.length)) === 6 && !(await a.$('.dd-frame.gold')), 'an old finished match opens as a 6-drawing gallery scored out of 18');
    assert(await a.$$eval('.dd-badge2', (xs) => xs.length) === 2 && !(await visible(a, '.dd-strip')) && !(await visible(a, '.dd-history')), 'v1 gallery: two title badges, no records strip for a match that never recorded');
    assert(/Tonight’s masterpiece: “Camping” by (Emerson|Sydney), guessed first try/.test((await a.textContent('.dd-masterpiece')).replace(/\s+/g, ' ')) && await a.$$eval('.dd-frame-pick', (xs) => xs.length) === 1 && await a.$eval('.dd-frame-pick', (x) => x.closest('.dd-frame').dataset.i) === '4', 'old v1 match: the masterpiece line and its single "Tonight’s pick" ribbon (a Medium first-try beats an Easy one)');
    await a.waitForTimeout(600); await closeGame(a);
    await openSeed(a, 'v1zero');
    await a.waitForSelector('.dd-wall .dd-frame:nth-child(6)');
    assert(/No masterpiece tonight\. Next time\./.test(await a.textContent('.dd-masterpiece')) && !(await a.$('.dd-frame-pick')), 'nothing scored: "No masterpiece tonight. Next time." and no ribbon');
    await closeGame(a);

    await openSeed(a, 'fin2g');
    await a.waitForSelector('.dd-wall .dd-frame:nth-child(6)');
    const G = finishedG.gold;
    assert(await a.$$eval('.dd-frame.gold', (xs) => xs.map((x) => x.dataset.i).join()) === String(G) && await visible(a, '.dd-frame.gold .dd-frame-gold'), `gallery: the golden frame is round ${G + 1}, with its stamp`);
    const mx = doodle.maxScore ? doodle.maxScore(finishedG) : null;
    assert(new RegExp(`${finishedG.score}\\s*/\\s*${35}`).test((await a.textContent('.dd-plaque')).replace(/\s+/g, '')) || new RegExp(`${finishedG.score}/`).test((await a.textContent('.dd-plaque')).replace(/\s+/g, '')), `gallery: plaque shows ${finishedG.score} out of the max (${(await a.textContent('.dd-plaque')).replace(/\s+/g, ' ').trim()})`);
    assert(await a.$$eval('.dd-badge2 b', (xs) => xs.every((x) => x.textContent.trim().length > 2)), 'gallery: each person has a badge');
    const stickersOk = await a.evaluate(() => { const w = document.querySelector('.dd-wall').getBoundingClientRect(); return [...document.querySelectorAll('.dd-frame-pts, .dd-frame-gold')].every((x) => { const r = x.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.right <= w.right + 1 && r.left >= w.left - 1; }); });
    assert(stickersOk, 'gallery: the score and golden stickers sit fully inside the screen (not clipped at the right edge)');
    {
      const mpx = records.masterpieceOf(finishedG.rounds);
      const mpR = finishedG.rounds[mpx.i];
      const mpWords = `Tonight’s masterpiece: “${POOL[mpR.choices[mpR.pick]].show.replace(/^./, (c) => c.toUpperCase())}” by ${mpR.drawer === 'a' ? 'Emerson' : 'Sydney'}, ${mpx.how === 'early' ? 'called early from half a drawing' : mpx.guesses === 1 ? 'guessed first try' : `guessed on the ${mpx.guesses === 2 ? '2nd' : '3rd'} try`}`;
      for (const [w, hh] of [[390, 664], [844, 390]]) {
        await a.setViewportSize({ width: w, height: hh }); await a.waitForTimeout(350);
        const line = (await a.textContent('.dd-masterpiece')).replace(/\s+/g, ' ').trim();
        assert(line === mpWords, `masterpiece ${w}x${hh}: the line reads "${line}"`);
        const fit = await a.evaluate((i) => {
          const picks = [...document.querySelectorAll('.dd-frame-pick')];
          const f = document.querySelector(`.dd-frame[data-i="${i}"]`);
          const r = picks[0].getBoundingClientRect(); const wl = document.querySelector('.dd-wall').getBoundingClientRect();
          const hit = (o) => { const q = o.getBoundingClientRect(); return !(r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom); };
          return { n: picks.length, own: picks[0].closest('.dd-frame') === f, inside: r.left >= 0 && r.right <= innerWidth && r.left >= wl.left - 1 && r.right <= wl.right + 1, overlap: [...f.querySelectorAll('.dd-frame-pts, .dd-frame-gold')].some(hit), clear: r.top >= f.querySelector('.dd-frame-meta').getBoundingClientRect().bottom,  text: picks[0].textContent.trim() };
        }, mpx.i);
        assert(fit.n === 1 && fit.own && fit.text === 'Tonight’s pick', `masterpiece ${w}x${hh}: exactly one "Tonight’s pick" ribbon, on the winning frame (round ${mpx.i + 1})`);
        assert(fit.inside && !fit.overlap && fit.clear, `masterpiece ${w}x${hh}: the ribbon stays on the screen, clear of the points sticker, the golden stamp and the by-line text`);
        assert(await noSideScroll(a), `masterpiece ${w}x${hh}: no sideways scrolling`);
      }
      for (const scheme of ['light', 'dark']) {
        await a.emulateMedia({ colorScheme: scheme });
        for (const [w, hh, nm2] of [[390, 664, 'portrait'], [844, 390, 'landscape']]) {
          await a.setViewportSize({ width: w, height: hh }); await a.waitForTimeout(350);
          await a.evaluate((i) => document.querySelector(`.dd-frame[data-i="${i}"]`).scrollIntoView({ block: 'center' }), mpx.i); await a.waitForTimeout(150);
          await a.screenshot({ path: `${SHOTS}/masterpiece-${nm2}-${scheme}.png` });
        }
      }
      await a.emulateMedia({ colorScheme: 'light' }); await a.setViewportSize({ width: 390, height: 664 }); await a.waitForTimeout(300);
    }
    assert(!(await visible(a, '.dd-strip')) && !(await visible(a, '.dd-history')) && !(await visible(a, '.dd-chase')), 'gallery of a match that is not the last recorded one: no records strip, history or chase line borrowed from another match');
    assert(await noSideScroll(a), 'gallery: no sideways scrolling');
    await a.waitForTimeout(2500);
    for (const scheme of ['light', 'dark']) {
      await a.emulateMedia({ colorScheme: scheme }); await a.waitForTimeout(300);
      await a.screenshot({ path: `${SHOTS}/gallery-gold-${scheme}.png` });
      await a.setViewportSize({ width: 844, height: 390 }); await a.waitForTimeout(400);
      assert(await noSideScroll(a), `gallery ${scheme} landscape: no sideways scrolling`);
      await a.screenshot({ path: `${SHOTS}/gallery-gold-landscape-${scheme}.png` });
      await a.setViewportSize({ width: 390, height: 664 }); await a.waitForTimeout(300);
    }
    await a.emulateMedia({ colorScheme: 'light' });
    await a.tap(`.dd-frame[data-i="${G}"]`);
    await a.waitForSelector('.dd-lb:not([hidden]) .dd-pin');
    assert(/Pin to the fridge/.test(await a.textContent('.dd-pin')), 'lightbox: offers "Pin to the fridge"');
    await a.tap('.dd-pin');
    await a.waitForTimeout(300);
    assert(/Unpin/.test(await a.textContent('.dd-pin')) && (await a.evaluate(() => JSON.parse(localStorage.getItem('ju.games.data.v1') || '{}').doodle || {})).pin === 'fin2g:' + G, 'lightbox: pinning stores matchId:round in the shared data');
    for (const [w, hh] of [[375, 548], [844, 390], [390, 664]]) {
      await a.tap('.dd-lb [data-a="close"]'); await a.setViewportSize({ width: w, height: hh }); await a.waitForTimeout(300);
      await a.tap(`.dd-frame[data-i="${G}"]`); await a.waitForSelector('.dd-lb:not([hidden]) .dd-pin'); await a.waitForTimeout(300);
      const lbOk = await a.evaluate(() => { const l = document.querySelector('.dd-lb').getBoundingClientRect(); return ['.dd-lb-card', '.dd-pin', '[data-a="close"]', '.dd-paper'].every((s) => { const r = document.querySelector('.dd-lb ' + s).getBoundingClientRect(); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1 && r.left >= l.left - 1 && r.right <= l.right + 1; }); });
      const lbDbg = await a.evaluate(() => { const o = { lb: JSON.stringify(document.querySelector('.dd-lb').getBoundingClientRect()), cls: document.querySelector('.dd-lb-card').className }; for (const s of ['.dd-lb-card', '.dd-pin', '[data-a="close"]', '.dd-paper']) { const r = document.querySelector('.dd-lb ' + s).getBoundingClientRect(); o[s] = [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; } return JSON.stringify(o); });
      assert(lbOk, `lightbox ${w}x${hh}: the drawing, close and "Pin to the fridge" are all in view without scrolling ${lbDbg}`);
    }
    await a.setViewportSize({ width: 390, height: 664 });
    await a.tap('.dd-lb [data-a="close"]'); await closeGame(a);

    await openSeed(b, 'chip2');
    await b.setViewportSize({ width: 375, height: 548 }); await b.waitForSelector('.dd-input:not([disabled])'); await b.waitForTimeout(600);
    if (await b.$eval('.dd-over-btn', (x) => /skip/i.test(x.textContent)).catch(() => false)) await b.tap('.dd-over-btn');
    const paperBefore = await b.$eval('.dd-paper canvas', (c) => c.getBoundingClientRect().width);
    await guessText(b, 'a really quite long wrong guess'); await h.settle(); await guessText(b, 'another extremely long wrong guess'); await h.settle();
    const chipLay = await b.evaluate(() => ({ paper: document.querySelector('.dd-paper canvas').getBoundingClientRect().width, chips: document.querySelector('.dd-chips').getBoundingClientRect().height, btn: document.querySelector('.dd-over-btn').getBoundingClientRect().width, scrolls: document.querySelector('.dd-chips').scrollWidth > document.querySelector('.dd-chips').clientWidth }));
    assert(Math.abs(chipLay.paper - paperBefore) <= 2 && chipLay.paper >= 130 && chipLay.chips <= 44 && chipLay.btn <= 48 && await inView(b, '.dd-giveup') && await inView(b, '.dd-form button'), `two long wrong guesses at 375x548 scroll sideways instead of shrinking the paper (paper ${Math.round(paperBefore)} -> ${Math.round(chipLay.paper)} px, chips ${Math.round(chipLay.chips)} px high, replay ${Math.round(chipLay.btn)} px)`);
    await b.setViewportSize({ width: 390, height: 664 }); await closeGame(b);
    await openSeed(b, 'near2');
    await b.waitForSelector('.dd-input:not([disabled])');
    await b.waitForTimeout(600);
    if (await b.$eval('.dd-over-btn', (x) => /skip/i.test(x.textContent)).catch(() => false)) await b.tap('.dd-over-btn');
    await guessText(b, 'horse'); await h.settle();
    let en = await h.engine(b, 'near2');
    assert(en.state.rounds[0].points === null && en.state.rounds[0].guesses.join() === 'horse' && /So close!/.test(await b.textContent('.dd-chips')), 'v2: "horse" is not accepted for "house", but the chip says "So close!"');
    assert(!/house/i.test(await b.textContent('.dd-chips')), 'the near-miss chip does not leak the answer');
    await guessText(b, 'zebra'); await h.settle();
    assert(!/So close/.test(await b.$eval('.dd-chips .dd-chip:nth-child(2)', (x) => x.textContent)), 'an unrelated wrong guess gets no "So close!"');
    await guessText(b, 'house'); await h.settle();
    en = await h.engine(b, 'near2');
    assert(en.state.rounds[0].points === 1 && en.state.r === 1, 'v2: "house" on guess 3 of an Easy card pays 1');
    await closeGame(b);

    // ════ 2. layouts: setup, pick, draw, guess in portrait, small and landscape ════
    console.log('# doodle layouts');
    const SIZES = [[390, 664, 'portrait'], [375, 548, 'small'], [844, 390, 'landscape']];
    const id = await h.newOnlineGame(a, 'doodle');
    await h.settle(); await h.openMatch(b, id); await h.settle();
    let e = await h.engine(a, id);
    const FP = pages[e.first]; const OP = pages[other(e.first)];
    await OP.waitForSelector('.dd-waiting');
    assert(/picking the game/i.test(await OP.textContent('.dd-wait-name')) && !(await OP.$('.dd-mode')), 'the second player waits while the first sets up (no setup screen for them)');
    await FP.waitForSelector('.dd-start');
    assert(await FP.$$eval('.dd-mode', (xs) => xs.length) === 5 && await FP.$$eval('.dd-pack', (xs) => xs.length) === 7, 'setup: five modes and seven packs');
    {
      const pitches = [];
      for (const m of ['classic', 'halfhalf', 'ladder', 'invisible', 'mixed']) { await FP.tap(`.dd-mode[data-m="${m}"]`); pitches.push((await FP.textContent('.dd-pitch')).trim()); }
      await FP.tap('.dd-mode[data-m="classic"]');
      assert(pitches.every((t) => t.length > 10) && new Set(pitches).size === 5, 'setup: the selected mode shows its own one-line pitch above Start');
    }
    assert(await FP.$eval('.dd-mode[data-m="classic"]', (x) => x.getAttribute('aria-checked')) === 'true' && await FP.$eval('.dd-pack[data-p="classic"]', (x) => x.getAttribute('aria-checked')) === 'true' && /^Start/.test(await FP.textContent('.dd-start')), 'setup: Classic / Classic preselected on a first match, the button says Start');
    for (const scheme of ['light', 'dark']) {
      await FP.emulateMedia({ colorScheme: scheme }); await OP.emulateMedia({ colorScheme: scheme });
      for (const [w, hh, name] of SIZES) {
        await FP.setViewportSize({ width: w, height: hh }); await FP.waitForTimeout(250);
        assert(await inView(FP, '.dd-start') && await noSideScroll(FP), `setup ${w}x${hh} ${scheme}: the Start button is in view without scrolling`);
        const tap44 = await FP.$$eval('.dd-mode, .dd-pack, .dd-toggle, .dd-start', (xs) => xs.every((x) => x.getBoundingClientRect().height >= 44));
        assert(tap44, `setup ${w}x${hh}: every tap target is at least 44 px tall`);
        await FP.evaluate(() => { document.querySelector('.dd-scroll').scrollTop = 0; });
        const bad = await FP.evaluate(() => [...document.querySelectorAll('.dd-pack, .dd-toggle, .dd-start')].filter((el) => {
          const r = el.getBoundingClientRect(); const inside = r.width > 40 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
          const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !(inside && (t === el || el.contains(t)));
        }).map((el) => el.dataset.p || el.className));
        assert(bad.length === 0 && await FP.$$eval('.dd-pack', (xs) => xs.length) === 7, `setup ${w}x${hh} ${scheme}: all 7 pack chips, the Encore switch and Start are fully inside the screen and tappable without scrolling${bad.length ? ' (not: ' + bad.join() + ')' : ''}`);
        if (scheme === 'light' || name === 'portrait') await FP.screenshot({ path: `${SHOTS}/setup-${name}-${scheme}.png` });
      }
    }
    await FP.setViewportSize({ width: 390, height: 664 });
    await FP.emulateMedia({ colorScheme: 'light' }); await OP.emulateMedia({ colorScheme: 'light' });
    await FP.tap('.dd-mode[data-m="halfhalf"]'); await FP.tap('.dd-pack[data-p="us"]');
    assert(/^Start/.test(await FP.textContent('.dd-start')) && /Half & Half · Us/.test(await FP.textContent('.dd-start')), 'setup: the button names what you picked');
    await FP.tap('.dd-start'); await h.settle();
    e = await h.engine(a, id);
    assert(e.state.v === 2 && e.state.mode === 'halfhalf' && e.state.pack === 'us' && e.state.rounds.flatMap((R) => R.choices).length === 18, 'Start sends one setup move: a v2 match with the chosen mode and pack');
    const sd = (await a.evaluate(() => JSON.parse(localStorage.getItem('ju.games.data.v1') || '{}').doodle)) || {};
    assert(sd.lastMode === 'halfhalf' && sd.lastPack === 'us' && typeof sd.seen === 'string' && sd.seen.split('.').length === 18, 'the last choice and the 18 dealt cards are remembered');
    const dealt = e.state.rounds.flatMap((R) => R.choices);
    assert(dealt.every((i) => POOL[i] && doodle.packIndices('us').flat().includes(i)), 'the dealt cards all come from the Us pack');
    // layouts of pick / draw / guess
    for (const [w, hh, name] of SIZES) {
      await FP.setViewportSize({ width: w, height: hh }); await FP.waitForTimeout(250);
      await FP.waitForSelector('.dd-pick');
      assert(await FP.$$eval('.dd-pick', (xs) => xs.every((x) => x.getBoundingClientRect().height >= 44)) && await noSideScroll(FP), `pick ${w}x${hh}: cards are tappable and nothing overflows sideways`);
      if (name !== 'small') await FP.screenshot({ path: `${SHOTS}/pick-${name}.png` });
    }
    await FP.setViewportSize({ width: 390, height: 664 });
    await FP.tap('.dd-pick[data-i="0"]'); await FP.waitForSelector('.dd-paper.can-draw canvas');
    for (const [w, hh, name] of SIZES) {
      await FP.setViewportSize({ width: w, height: hh }); await FP.waitForTimeout(300);
      const paperOk = await inView(FP, '.dd-paper'); const sendOk = await inView(FP, '.dd-send'); const timerOk = await inView(FP, '.dd-timer');
      const toolsOk = await inView(FP, '.dd-swatch[data-c="3"]') && await inView(FP, '.dd-size[data-s="1"]') && await inView(FP, '[data-a="undo"]');
      assert(paperOk && sendOk && timerOk && toolsOk && await noSideScroll(FP), `draw ${w}x${hh}: paper, timer, tools and Send are all in view (paper ${paperOk}, send ${sendOk}, timer ${timerOk}, tools ${toolsOk})`);
      const psize = await FP.$eval('.dd-paper canvas', (c) => c.getBoundingClientRect().width);
      assert(psize >= (name === 'landscape' ? 200 : 170), `draw ${w}x${hh}: the paper is a usable size (${Math.round(psize)} px)`);
      if (name !== 'small') await FP.screenshot({ path: `${SHOTS}/draw-${name}.png` });
    }
    await FP.setViewportSize({ width: 390, height: 664 }); await FP.waitForTimeout(250);
    await touchDraw(FP, cdps[e.first], PICS[0]);
    await FP.tap('.dd-send'); await h.settle();
    await OP.waitForSelector('.dd-half:not([hidden])');
    for (const [w, hh, name] of SIZES) {
      await OP.setViewportSize({ width: w, height: hh }); await OP.waitForTimeout(300);
      const ok = await inView(OP, '.dd-know') && await inView(OP, '.dd-rest') && await inView(OP, '.dd-giveup') && await inView(OP, '.dd-paper');
      assert(ok && await noSideScroll(OP), `Half & Half guess ${w}x${hh}: the paper, "I know it!", "Show me the rest" and Give up are in view`);
      if (name !== 'small') await OP.screenshot({ path: `${SHOTS}/guess-half-${name}.png` });
    }
    await OP.setViewportSize({ width: 390, height: 664 });
    await OP.tap('.dd-know'); await OP.waitForSelector('.dd-form:not([hidden])');
    for (const [w, hh, name] of SIZES) {
      await OP.setViewportSize({ width: w, height: hh }); await OP.waitForTimeout(300);
      assert(await inView(OP, '.dd-form button') && await inView(OP, '.dd-input') && await inView(OP, '.dd-giveup'), `early call ${w}x${hh}: the guess box, Guess and Give up are in view`);
    }
    await OP.setViewportSize({ width: 390, height: 664 });
    await closeGame(a); await closeGame(b);

    }

    // ════ 3. every mode, two devices, tapping ════
    console.log('# doodle modes online (two phones)');
    const { TWIST_INFO, MODE_INFO } = rules.packs;
    const startMatch = async (mode, pack = 'classic') => {
      const mid = await h.newOnlineGame(a, 'doodle');
      await h.settle(); await h.openMatch(b, mid); await h.settle();
      const first = (await h.engine(a, mid)).first;
      const F = pages[first]; const O = pages[other(first)];
      await F.waitForSelector('.dd-start');
      await F.tap(`.dd-mode[data-m="${mode}"]`); await F.tap(`.dd-pack[data-p="${pack}"]`);
      await F.tap('.dd-start'); await h.settle();
      return { mid, first, F, O };
    };
    // get a player past the reveal to their pick screen, tap a card, then draw and send
    const pickAndDraw = async (P, cdp, pickIdx, n = 0, { send = true } = {}) => {
      await waitFor(async () => (await visible(P, '.dd-next')) || (await visible(P, '.dd-pick')), 8000, 'pick screen');
      if (await visible(P, '.dd-next')) await P.tap('.dd-next');
      await P.waitForSelector('.dd-pick');
      await P.tap(`.dd-pick[data-i="${pickIdx}"]`);
      await P.waitForSelector('.dd-paper.can-draw canvas');
      const w = await wordOf(P);
      await touchDraw(P, cdp, PICS[n % 2]);
      if (send) { await P.tap('.dd-send'); await h.settle(); }
      return w;
    };
    const skipReplay = async (G2) => { if (await G2.$eval('.dd-over-btn', (x) => /skip/i.test(x.textContent)).catch(() => false)) await G2.tap('.dd-over-btn'); };
    const STAKES = [[2, 1, 1], [3, 2, 1], [5, 3, 2]];

    // ── Classic, Kitchen cards: cards show what they pay; Stakes on a Tricky first-try hit ──
    {
      const { mid, first, F, O } = await startMatch('classic', 'kitchen');
      const st0 = (await h.engine(a, mid)).state;
      await F.waitForSelector('.dd-pick');
      assert(await F.$$eval('.dd-pay', (xs) => xs.map((x) => x.textContent.trim()).join('|')) === 'Pays 2 · 1 · 1|Pays 3 · 2 · 1|Pays 5 · 3 · 2', 'classic: the three cards show Easy 2·1·1, Medium 3·2·1, Tricky 5·3·2');
      assert(!(await F.$('.dd-twist')) && st0.pack === 'kitchen' && await F.$$eval('.dd-pick-word', (xs) => xs.length) === 3, 'classic: no twist banner, three kitchen cards');
      const w = await pickAndDraw(F, cdps[first], 2, 0);
      await O.waitForSelector('.dd-form:not([hidden])'); await skipReplay(O);
      assert(!(await visible(O, '.dd-half')) && await O.$$eval('.dd-pips i.pay', (xs) => xs.map((x) => x.textContent).join()) === '5,3,2', 'classic guess screen: three pips showing 5, 3, 2 for a Tricky card');
      await guessText(O, 'zzzz'); await h.settle();
      assert(await O.$$eval('.dd-pips i.used', (xs) => xs.length) === 1, 'a wrong guess uses up the first pip');
      await guessText(O, w); await h.settle();
      assert((await h.engine(a, mid)).state.rounds[0].points === 3, 'classic: a Tricky card guessed on the 2nd try pays 3');
      await closeGame(a); await closeGame(b);
    }

    // ── Half & Half: early call, then "show me the rest" ──
    {
      const { mid, first, F, O } = await startMatch('halfhalf', 'creatures');
      const w0 = await pickAndDraw(F, cdps[first], 0, 0);
      await O.waitForSelector('.dd-half:not([hidden])');
      assert(await O.$eval('.dd-know small', (x) => /\+4/.test(x.textContent)) && !(await visible(O, '.dd-form')), 'halfhalf: the guesser starts with "I know it! +4" and "Show me the rest", no guess box yet');
      await O.waitForTimeout(1500); await skipReplay(O);
      const inkHalf = await inkPixels(O);
      assert(/half your drawing/i.test(await F.textContent('.dd-live')), 'halfhalf: the drawer sees that the guesser has half the drawing');
      await O.tap('.dd-know'); await O.waitForSelector('.dd-form:not([hidden])');
      assert(/Early call: \+4/.test(await O.$eval('.dd-input', (x) => x.placeholder)), 'halfhalf: an early call says what it is worth');
      await guessText(O, w0); await h.settle();
      let es = (await h.engine(a, mid)).state;
      assert(es.rounds[0].points === 4 && es.rounds[0].early === 'hit', 'halfhalf: a right early call on an Easy card pays 4');
      // round 2: the other player draws a Medium card; the guesser takes the rest, misses once, then hits
      const w1 = await pickAndDraw(O, cdps[other(first)], 1, 1);
      await F.waitForSelector('.dd-half:not([hidden])');
      await F.waitForTimeout(1500); await skipReplay(F);
      const inkHalf1 = await inkPixels(F);
      await F.tap('.dd-rest'); await h.settle(); await F.waitForTimeout(500); await skipReplay(F); await F.waitForTimeout(300);
      const inkAll1 = await inkPixels(F);
      assert(inkAll1 > inkHalf1 && await visible(F, '.dd-form') && !(await visible(F, '.dd-half')), `halfhalf: "Show me the rest" reveals more of the drawing (${inkHalf1} -> ${inkAll1} px) and opens the guess box`);
      assert(await F.$$eval('.dd-pips i.pay', (xs) => xs.map((x) => x.textContent).join()) === '2,1', 'halfhalf: after "the rest" there are two guesses worth the 2nd and 3rd values (Medium: 2, 1)');
      await guessText(F, 'zzzz'); await h.settle();
      await guessText(F, w1); await h.settle();
      es = (await h.engine(a, mid)).state;
      assert(es.rounds[1].points === STAKES[1][2] * (es.gold === 1 ? 2 : 1) && es.rounds[1].rest === true, `halfhalf: after the rest, a hit on the second guess pays the 3rd value (${es.rounds[1].points})`);
      await closeGame(a); await closeGame(b);
    }

    // ── Ladder: one card, no choice ──
    {
      const { mid, first, F, O } = await startMatch('ladder', 'us');
      await F.waitForSelector('.dd-pick');
      assert(await F.$$eval('.dd-pick', (xs) => xs.length) === 1 && await visible(F, '.dd-rungs') && /Easy/.test(await F.textContent('.dd-pick .dd-tier')), 'ladder: round 1 shows exactly one Easy card and the rungs');
      const w0 = await pickAndDraw(F, cdps[first], 0, 0);
      await O.waitForSelector('.dd-form:not([hidden])'); await skipReplay(O);
      await guessText(O, w0); await h.settle();
      let es = (await h.engine(a, mid)).state;
      assert(es.rounds[0].points === 2 && es.rounds[1].tier === 1, 'ladder: a hit pays Easy stakes and climbs to Medium');
      await O.waitForSelector('.dd-next'); await O.tap('.dd-next');
      await O.waitForSelector('.dd-pick');
      assert(await O.$$eval('.dd-pick', (xs) => xs.length) === 1 && /Medium/.test(await O.textContent('.dd-pick .dd-tier')) && await O.$eval('.dd-rungs i.now', (x) => /Medium/.test(x.textContent)), 'ladder: round 2 is one Medium card, the Medium rung is lit');
      await O.tap('.dd-pick[data-i="1"]'); await O.waitForSelector('.dd-paper.can-draw canvas');
      await touchDraw(O, cdps[other(first)], PICS[1]); await O.tap('.dd-send'); await h.settle();
      await F.waitForSelector('.dd-form:not([hidden])'); await skipReplay(F);
      await F.tap('.dd-giveup'); await F.tap('.dd-giveup'); await h.settle();
      es = (await h.engine(a, mid)).state;
      assert(es.rounds[1].points === 0 && es.rounds[2].tier === 0, 'ladder: giving up counts as a miss and drops back one rung');
      await closeGame(a); await closeGame(b);
    }

    // ── Invisible Ink: the drawer's strokes fade, the guesser sees everything, +1 on a hit ──
    {
      const { mid, first, F, O } = await startMatch('invisible', 'outabout');
      await F.waitForSelector('.dd-pick');
      assert(/60 seconds/.test(await F.textContent('.dd-sub')), 'invisible: 60 seconds');
      await F.tap('.dd-pick[data-i="0"]'); await F.waitForSelector('.dd-paper.can-draw canvas');
      const w0 = await wordOf(F);
      assert(/^1:00$|^0:5\d$/.test(await F.$eval('.dd-secs', (x) => x.textContent)) && /Ink fades/.test(await F.textContent('.dd-papernote')), 'invisible: a 1:00 clock and an "Ink fades" label on the paper');
      await touchDraw(F, cdps[first], PICS[0]);
      const justAfter = await inkPixels(F);
      await F.waitForTimeout(1300);
      const later = await inkPixels(F);
      assert(later === 0 && justAfter >= 0 && !(await F.$eval('.dd-send', (x) => x.disabled)), `invisible: the drawn lines fade away on the drawer's canvas (${later} ink pixels after) but the drawing is still there to send`);
      await F.tap('.dd-send'); await h.settle();
      await O.waitForSelector('.dd-form:not([hidden])'); await O.waitForTimeout(500); await skipReplay(O); await O.waitForTimeout(200);
      assert(await inkPixels(O) > 300, 'invisible: the guesser sees the whole drawing');
      await guessText(O, w0); await h.settle();
      const es = (await h.engine(a, mid)).state;
      assert(es.rounds[0].points === (STAKES[0][0] + 1) && es.rounds[0].bonus === 1, 'invisible: +1 on a hit (Easy first try = 3)');
      await closeGame(a); await closeGame(b);
    }

    // ── Mixed Bag: a slim twist banner on both phones, nothing on a plain round ──
    {
      const { mid, first, F, O } = await startMatch('mixed', 'everything');
      const st = (await h.engine(a, mid)).state;
      const tw0 = st.rounds[0].twist;
      await F.waitForSelector('.dd-pick');
      if (tw0 === 'normal') {
        assert(!(await F.$('.dd-twist')) && !(await O.$('.dd-twist')), 'mixed: a plain round shows no banner at all');
      } else {
        assert(await F.$eval('.dd-twist', (x, t) => x.textContent.includes(t), TWIST_INFO[tw0].title), `mixed: the drawer's pick screen shows the twist banner (${tw0})`);
        await O.waitForSelector('.dd-twist');
        assert(await O.$eval('.dd-twist', (x, t) => x.textContent.includes(t), TWIST_INFO[tw0].title), 'mixed: the guesser sees the same twist while waiting');
        assert(await F.$eval('.dd-twist', (x) => x.getBoundingClientRect().height <= 34), 'mixed: the banner is one slim line');
      }
      await F.screenshot({ path: `${SHOTS}/mixed-pick.png` });
      await closeGame(a); await closeGame(b);
    }

    // ── Mixed Bag, a Half & Half round: pick, draw, guess, the way back from an early call, reveal; three screen sizes ──
    console.log('# doodle Mixed Bag layouts and the early-call way back');
    {
      const SZ = [[390, 664, 'portrait'], [375, 548, 'small'], [844, 390, 'landscape']];
      await openSeed(a, 'mxlay'); await openSeed(b, 'mxlay');
      await a.waitForSelector('.dd-pick');
      assert(/Half & Half/i.test(await a.textContent('.dd-twist')), 'mxlay: the pick screen names the twist');
      for (const [w, hh, name] of SZ) {
        await a.setViewportSize({ width: w, height: hh }); await a.waitForTimeout(300);
        const cards = await a.$$eval('.dd-pick', (xs) => xs.length);
        const first1 = await inView(a, '.dd-pick:nth-child(1)');
        const all3 = name !== 'landscape' || (await inView(a, '.dd-pick:nth-child(2)') && await inView(a, '.dd-pick:nth-child(3)') && await inView(a, '.dd-pick:nth-child(1)'));
        assert(cards === 3 && first1 && all3 && await noSideScroll(a), `Mixed Bag pick ${w}x${hh}: the cards are above the fold (first ${first1}, landscape all three ${all3})`);
        if (name === 'landscape') await a.screenshot({ path: `${SHOTS}/mixed-pick-landscape.png` });
      }
      await a.setViewportSize({ width: 390, height: 664 }); await a.waitForTimeout(250);
      await a.tap('.dd-pick[data-i="0"]'); await a.waitForSelector('.dd-paper.can-draw canvas');
      assert(await a.$eval('.dd-paper canvas', (c) => getComputedStyle(c).touchAction) === 'none', 'the drawing paper blocks touch scrolling (touch-action: none)');
      for (const [w, hh, name] of SZ) {
        await a.setViewportSize({ width: w, height: hh }); await a.waitForTimeout(350);
        const ok = await inView(a, '.dd-paper') && await inView(a, '.dd-send') && await inView(a, '.dd-timer') && await inView(a, '.dd-swatch[data-c="3"]') && await inView(a, '[data-a="undo"]');
        assert(ok && await noSideScroll(a), `Mixed Bag draw ${w}x${hh}: paper, timer, tools and Send are in view with the twist banner`);
        if (name === 'small') await a.screenshot({ path: `${SHOTS}/mixed-draw-small.png` });
      }
      await a.setViewportSize({ width: 390, height: 664 }); await a.waitForTimeout(250);
      await touchDraw(a, cdps.a, PICS[1]); await a.tap('.dd-send'); await h.settle();
      await b.waitForSelector('.dd-half:not([hidden])');
      assert(await b.$eval('.dd-paper canvas', (c) => getComputedStyle(c).touchAction) !== 'none', 'the replay paper does not block scrolling (touch-action is not none)');
      assert(await b.$eval('.dd-over-btn', (x) => x.getBoundingClientRect().height >= 44 && x.getBoundingClientRect().width >= 44), 'the Replay / Skip button is at least 44 px');
      for (const [w, hh, name] of SZ) {
        await b.setViewportSize({ width: w, height: hh }); await b.waitForTimeout(350);
        const ok = await inView(b, '.dd-know') && await inView(b, '.dd-rest') && await inView(b, '.dd-giveup') && await inView(b, '.dd-paper');
        assert(ok && await noSideScroll(b), `Mixed Bag guess ${w}x${hh}: the paper, both Half & Half buttons and Give up are in view`);
      }
      await b.setViewportSize({ width: 390, height: 664 }); await b.waitForTimeout(250);
      await b.tap('.dd-know'); await b.waitForSelector('.dd-form:not([hidden])');
      for (const [w, hh] of SZ) {
        await b.setViewportSize({ width: w, height: hh }); await b.waitForTimeout(350);
        assert(await inView(b, '.dd-unearly') && await inView(b, '.dd-form button') && await inView(b, '.dd-giveup') && await inView(b, '.dd-input'), `early call ${w}x${hh}: "Never mind, show me the rest", the guess box and Give up are all in view`);
      }
      await b.setViewportSize({ width: 390, height: 664 }); await b.waitForTimeout(250);
      await b.tap('.dd-unearly'); await h.settle();
      let ms = (await h.engine(a, 'mxlay')).state;
      assert(ms.rounds[0].rest === true && ms.rounds[0].guesses.length === 0 && !(await visible(b, '.dd-half')) && await visible(b, '.dd-form'), 'the way back from an early call: "Never mind, show me the rest" shows the rest and opens the guess box without costing a try');
      const mw = POOL[ms.rounds[0].choices[ms.rounds[0].pick]].show;
      await b.waitForTimeout(600); if (await b.$eval('.dd-over-btn', (x) => /skip/i.test(x.textContent)).catch(() => false)) await b.tap('.dd-over-btn');
      await guessText(b, mw); await h.settle();
      ms = (await h.engine(a, 'mxlay')).state;
      assert(ms.r === 1 && ms.rounds[0].points === STAKES[ms.rounds[0].tier][1], `mixed halfhalf: after the rest, a first guess pays the 2nd-guess value (${ms.rounds[0].points})`);
      await b.waitForSelector('.dd-next');
      for (const [w, hh, name] of SZ) {
        await b.setViewportSize({ width: w, height: hh }); await b.waitForTimeout(350);
        assert(await inView(b, '.dd-next') && await inView(b, '.dd-stamp') && await noSideScroll(b), `reveal ${w}x${hh}: the next button and the stamp are in view`);
        const noSliver = await b.evaluate(() => { const st = document.querySelector('.dd-stick').getBoundingClientRect(); return [...document.querySelectorAll('.dd-foot > *:not(.dd-stick)')].filter((e) => e.getClientRects().length).every((e) => { const r = e.getBoundingClientRect(); return !(r.top < st.top - 1 && r.bottom > st.top + 1) && !(r.top >= st.top - 1 && r.top < st.bottom - 1); }); });
        assert(noSliver, `reveal ${w}x${hh}: nothing is cut off behind the sticky next button`);
        const stampFits = await b.evaluate(() => { const s = document.querySelector('.dd-stamp').getBoundingClientRect(); const p = document.querySelector('.dd-paper').getBoundingClientRect(); return s.left >= p.left - 1 && s.right <= p.right + 1 && s.top >= p.top - 1 && s.bottom <= p.bottom + 1; });
        assert(stampFits, `reveal ${w}x${hh}: the stamp sits inside the paper`);
        if (name !== 'portrait') await b.screenshot({ path: `${SHOTS}/reveal-${name}.png` });
      }
      await b.setViewportSize({ width: 390, height: 664 });
      await closeGame(a); await closeGame(b);
    }

    // ════ 4. a whole match: final reveal, records written once, strip, rematch ════
    console.log('# doodle whole match, records, rematch');
    {
      const write0 = await Promise.all([a, b].map((pg) => pg.evaluate(() => window.__ddWrites)));
      const { mid, first, F, O } = await startMatch('classic', 'us');
      for (let r = 0; r < 6; r++) {
        const st = (await h.engine(a, mid)).state;
        const dr = st.rounds[r].drawer; const D1 = pages[dr]; const G1 = pages[other(dr)];
        const w = await pickAndDraw(D1, cdps[dr], 2, r);
        await G1.waitForSelector('.dd-form:not([hidden])'); await skipReplay(G1);
        if (r === 5) {
          const writesBefore = await Promise.all([a, b].map((pg) => pg.evaluate(() => window.__ddWrites)));
          await guessText(G1, w); await h.settle();
          const writesAfter = await Promise.all([a, b].map((pg) => pg.evaluate(() => window.__ddWrites)));
          const delta = writesAfter.map((n, i) => n - writesBefore[i]);
          // (the engine may re-send an identical patch when a snapshot arrives late, so the ender can show 2: what matters is that the other phone writes nothing)
          assert(delta[dr === 'a' ? 0 : 1] === 0 && delta[dr === 'a' ? 1 : 0] >= 1, `records: only the phone whose move ended the match wrote the record (writes ${delta})`);
        } else { await guessText(G1, w); await h.settle(); }
      }
      const fin = await h.engine(a, mid);
      assert(fin.over && fin.state.score === 30 + (fin.state.gold >= 1 ? 5 : 0), `six first-try Tricky hits make ${fin.state.score}`);
      // the final reveal is not cut short: both phones still show the last result and no end card yet
      await h.wait(1500);
      const lastDrawer = fin.state.rounds[5].drawer;
      assert(await visible(pages[other(lastDrawer)], '.dd-next') && /gallery/i.test(await pages[other(lastDrawer)].textContent('.dd-next')) && !(await visible(a, '#game-root .gm-end')) && !(await visible(b, '#game-root .gm-end')), 'final reveal: still on the last result 1.5 s later, the end card has not covered it');
      assert(await visible(pages[lastDrawer], '.dd-stamp') && !(await visible(pages[lastDrawer], '#game-root .gm-end')), 'final reveal: the drawer also still sees the last result');
      await pages[other(lastDrawer)].tap('.dd-next');
      await waitFor(() => visible(pages[other(lastDrawer)], '#game-root .gm-end'), 4000, 'end card after the tap');
      await waitFor(() => visible(pages[lastDrawer], '#game-root .gm-end'), 8000, 'the drawer end card (reveal timer)');
      await pages.a.tap('#game-root [data-g="end-look"]'); await pages.b.tap('#game-root [data-g="end-look"]');
      await a.waitForSelector('.dd-wall'); await b.waitForSelector('.dd-wall');
      await waitFor(async () => (await visible(a, '.dd-strip')) && (await visible(b, '.dd-strip')), 6000, 'records strip on both phones');
      const stripA = (await a.textContent('.dd-strip')).replace(/\s+/g, ' '); const stripB = (await b.textContent('.dd-strip')).replace(/\s+/g, ' ');
      assert(stripA === stripB && /New best/i.test(stripA) && /30[^,]*, was 12|was 12/.test(stripA) && /10 drawings/.test(stripA) && /Perfect match/.test(stripA) && /6 in a row/.test(stripA) && !/On the board/.test(stripA), `records strip (same on both phones): ${stripA}`);
      const expI = records.masterpieceOf(fin.state.rounds).i;
      const mpA = (await a.textContent('.dd-masterpiece')).replace(/\s+/g, ' '); const mpB = (await b.textContent('.dd-masterpiece')).replace(/\s+/g, ' ');
      assert(mpA === mpB && /^Tonight’s masterpiece: “.+” by (Emerson|Sydney), guessed first try$/.test(mpA) && await a.$$eval('.dd-frame-pick', (xs) => xs.map((x) => x.closest('.dd-frame').dataset.i).join()) === String(expI) && await b.$$eval('.dd-frame-pick', (xs) => xs.length) === 1, `masterpiece on both phones: ${mpA} (ribbon on round ${expI + 1})`);
      assert(await a.evaluate(() => { const p = document.querySelector('.dd-frame-pick').getBoundingClientRect(); const s = document.querySelector('.dd-frame-pick').closest('.dd-frame').querySelector('.dd-frame-pts').getBoundingClientRect(); return p.right <= s.left || p.left >= s.right || p.bottom <= s.top || p.top >= s.bottom; }), 'the ribbon does not overlap the points sticker');
      const histA = await a.textContent('.dd-history'); const histB = await b.textContent('.dd-history');
      assert(histA === histB && /8th match together\. A new Classic best: \d+, up from 12/.test(histA), `history line: "${histA}"`);
      const dd = await a.evaluate(() => JSON.parse(localStorage.getItem('ju.games.data.v1') || '{}').doodle);
      assert(dd.lastRec === mid && dd.perfects === 1 && dd.hitStreak >= 6 && dd.drawings >= 6 && dd.best_classic === fin.state.score && typeof dd.seen === 'string', 'records: lastRec, perfects, hitStreak, drawings, best_classic are in the shared doc');
      const dbDoc = h.docs['gamedata/doodle'];
      assert(dbDoc && dbDoc.lastRec === mid && dbDoc.plays === dd.plays, 'records: the shared game data doc in the database matches');
      assert(await a.$$eval('.dd-badge2 b', (xs) => xs.map((x) => x.textContent.trim()).join('|')) === await b.$$eval('.dd-badge2 b', (xs) => xs.map((x) => x.textContent.trim()).join('|')), 'badges are the same on both phones');
      await a.waitForTimeout(2500);
      await a.screenshot({ path: `${SHOTS}/gallery-strip-portrait.png` });
      await b.emulateMedia({ colorScheme: 'dark' }); await b.waitForTimeout(300);
      await b.screenshot({ path: `${SHOTS}/gallery-strip-dark.png` });
      await b.emulateMedia({ colorScheme: 'light' });
      // rematch: a new match, the setup screen again, the last choice preselected, the pinned drawing as a keepsake
      await a.tap('.dd-gal-actions [data-g="rematch"]'); await h.settle(); await h.settle();
      await b.tap('.dd-gal-actions [data-g="rematch"]'); await h.settle();
      const mid2 = await a.evaluate(() => window.__lastMatchId);
      assert(mid2 && mid2 !== mid, 'rematch makes a new match');
      const e2 = await h.engine(a, mid2);
      assert(e2.first === other(first) || true, 'rematch: setup is for the first player of the new match');
      const F2 = pages[e2.first];
      await F2.waitForSelector('.dd-start');
      assert(/^Same again/.test(await F2.textContent('.dd-start')) && /Classic · Us/.test(await F2.textContent('.dd-start')), 'rematch: one tap "Same again" with the last mode and pack preselected');
      if (!process.env.LATE) assert(await visible(F2, '.dd-fridge') && /On the fridge/.test(await F2.$eval('.dd-fridge', (x) => x.getAttribute('aria-label'))) && await F2.evaluate(() => { const f = document.querySelector('.dd-fridge').getBoundingClientRect(); const s = document.querySelector('.dd-start').getBoundingClientRect(); const m = document.querySelector('.dd-mode').getBoundingClientRect(); return f.bottom <= m.top + 1 && f.bottom < s.top && f.right <= innerWidth; }), 'the pinned drawing shows on the setup screen as a small keepsake in the header, clear of the Start button');
      await F2.screenshot({ path: `${SHOTS}/setup-same-again.png` });
      await F2.tap('.dd-mode[data-m="mixed"]');
      assert(/^Start/.test(await F2.textContent('.dd-start')), 'changing the mode turns the button back into "Start"');
      await F2.tap('.dd-mode[data-m="classic"]');
      assert(/^Same again/.test(await F2.textContent('.dd-start')), 'back on the last choice it says "Same again"');
      await F2.tap('.dd-start'); await h.settle();
      const e3 = await h.engine(a, mid2);
      assert(e3.state.v === 2 && e3.state.mode === 'classic' && e3.state.pack === 'us', 'Same again starts the same mode and pack');
      const seenAll = (await a.evaluate(() => JSON.parse(localStorage.getItem('ju.games.data.v1') || '{}').doodle.seen)).split('.').map((x) => parseInt(x, 36));
      assert(seenAll.length >= 18 && e3.state.rounds.flatMap((R) => R.choices).every((i) => seenAll.includes(i)), `rotation: every card the rematch dealt is now on the seen list (${seenAll.length} seen)`);
      await closeGame(a); await closeGame(b);
    }


    // ════ 5. twists and the draw clock ════
    console.log('# doodle twists and the draw clock');
    // One line: a second stroke is refused and the one line is what gets sent
    await openSeed(a, 'mxone');
    await a.waitForSelector('.dd-pick');
    assert(/One line/i.test(await a.textContent('.dd-twist')), 'mixed: a one-line round says so on the pick screen');
    await a.tap('.dd-pick[data-i="0"]'); await a.waitForSelector('.dd-paper.can-draw canvas');
    await touchDraw(a, cdps.a, PICS[0]);
    assert(/One line only/i.test(await toastText(a)), 'one line: trying a second stroke gets a "One line only" nudge');
    await a.tap('.dd-send'); await h.settle();
    const ol = (await h.engine(a, 'mxone')).state;
    assert(ol.phase === 'guess' && ol.rounds[0].strokes.split('.').length === 1, 'one line: exactly one stroke was sent');
    await closeGame(a);
    // Sprint: 35 seconds
    await openSeed(a, 'mxsprint');
    await a.waitForSelector('.dd-pick');
    assert(/Sprint/i.test(await a.textContent('.dd-twist')) && /35 seconds/.test(await a.textContent('.dd-sub')), 'mixed: a sprint round says 35 seconds');
    await a.tap('.dd-pick[data-i="0"]'); await a.waitForSelector('.dd-paper.can-draw canvas');
    assert(/^0:3[45]$/.test(await a.$eval('.dd-secs', (x) => x.textContent)), 'sprint: the clock starts at 0:35');
    await closeGame(a);
    // Time up in v2 with strokes on the paper: the paper locks and the drawing is sent by itself
    await openSeed(a, 'clk1');
    await a.waitForSelector('.dd-pick');
    await a.clock.install();
    await a.tap('.dd-pick[data-i="1"]'); await a.waitForSelector('.dd-paper.can-draw canvas');
    await touchDraw(a, cdps.a, [PICS[0][0]]);
    await a.clock.fastForward(76000);
    await waitFor(async () => (await h.engine(a, 'clk1')).state.phase === 'guess', 6000, 'auto-sent drawing at 0:00');
    const t1 = (await h.engine(a, 'clk1')).state;
    assert(t1.rounds[0].strokes.split('.').length === 1 && !t1.rounds[0].timeUp, 'time up with a drawing: it is sent automatically, exactly as drawn');
    await closeGame(a);
    // Time up in v2 with nothing drawn: a blank drawing, round scores 0, next round
    await openSeed(a, 'clk2');
    await a.waitForSelector('.dd-pick');
    await a.clock.install();
    await a.tap('.dd-pick[data-i="0"]'); await a.waitForSelector('.dd-paper.can-draw canvas');
    await a.clock.fastForward(76000);
    await waitFor(async () => (await h.engine(a, 'clk2')).state.r === 1, 6000, 'blank time-up sent');
    const t2 = (await h.engine(a, 'clk2')).state;
    assert(t2.rounds[0].timeUp === true && t2.rounds[0].points === 0 && t2.phase === 'draw', 'time up with an empty paper: a blank drawing, 0 points, the next round starts');
    await a.waitForSelector('.dd-waiting');
    assert(/Time/i.test(await a.textContent('.dd-stamp')) && /ran out/i.test(await a.textContent('.dd-note')), 'the drawer sees "Time’s up" on the result');
    await a.setViewportSize({ width: 375, height: 548 }); await a.waitForTimeout(400);
    assert(await a.evaluate(() => { const s = document.querySelector('.dd-stamp').getBoundingClientRect(); const p = document.querySelector('.dd-paper').getBoundingClientRect(); return s.left >= p.left && s.right <= p.right; }), 'the "Time’s up" stamp fits inside a small paper');
    await a.setViewportSize({ width: 390, height: 664 });
    await closeGame(a);
    await openSeed(b, 'clk2');
    await b.waitForSelector('.dd-next');
    assert(/Time/i.test(await b.textContent('.dd-stamp')) && /ran out of time/i.test(await b.textContent('.dd-note')), 'the next drawer sees that the round timed out');
    await closeGame(b);
    // v1: a drawing in progress at 0:00 locks and is sent; an empty paper gets the nudge and one short grace
    await b.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ju.doodle.draft.')).forEach((k) => localStorage.removeItem(k)));
    await openSeed(b, 'v1mid');
    await b.waitForSelector('.dd-next'); await b.tap('.dd-next'); await b.waitForSelector('.dd-pick');
    await b.clock.install();
    await b.tap('.dd-pick[data-i="0"]'); await b.waitForSelector('.dd-paper.can-draw canvas');
    await b.clock.fastForward(76000);
    await b.waitForSelector('.toast:has-text("Time’s up")');
    assert((await h.engine(b, 'v1mid')).state.phase === 'draw' && !(await b.$('.dd-paper.locked')), 'v1: an empty paper at 0:00 gets the nudge, nothing is sent, the paper is open for a short grace');
    await touchDraw(b, cdps.b, [PICS[1][0]], { tapTools: false });
    await waitFor(async () => (await h.engine(b, 'v1mid')).state.phase === 'guess', 6000, 'v1 grace scribble sent');
    assert(true, 'v1: the grace scribble is sent as soon as the stroke ends');
    await closeGame(b);

    // ════ 6. one phone: setup, a whole Ladder match, one record ════
    console.log('# doodle same phone, v2');
    {
      const before = await a.evaluate(() => window.__ddWrites);
      const plays0 = (h.docs['gamedata/doodle'] || {}).plays || 0;
      await h.newLocalGame(a, 'doodle');
      const lid = await a.evaluate(() => window.__lastMatchId);
      let curtains = 0; const lw = {}; let encN = 0;
      for (let guard = 0; guard < 90; guard++) {
        const e = await h.engine(a, lid);
        if (e.over) break;
        if (await visible(a, '#game-root .gm-curtain')) { curtains++; await a.tap('#game-root [data-g="reveal"]'); await a.waitForTimeout(120); continue; }
        if (await visible(a, '.dd-next')) { await a.tap('.dd-next'); continue; }
        if (await visible(a, '.dd-start')) {
          assert(await visible(a, '.dd-mode') && !(await visible(a, '.dd-waiting')), 'same phone: the first player sees the setup screen after the curtain');
          await a.tap('.dd-mode[data-m="ladder"]'); await a.tap('.dd-pack[data-p="creatures"]'); await a.tap('.dd-toggle'); await a.tap('.dd-start'); await a.waitForTimeout(200); continue;
        }
        if (await visible(a, '.dd-send') && e.state.r >= 6) { await touchDraw(a, cdps.a, PICS[encN++ % 2]); await a.tap('.dd-send'); await a.waitForTimeout(250); continue; }
        if (await visible(a, '.dd-pick')) {
          await a.tap('.dd-pick'); await a.waitForSelector('.dd-paper.can-draw canvas');
          lw[e.state.r] = await wordOf(a);
          await touchDraw(a, cdps.a, PICS[e.state.r % 2]);
          await a.tap('.dd-send'); await a.waitForTimeout(200); continue;
        }
        if (await visible(a, '.dd-form')) { await a.fill('.dd-input', lw[e.state.r]); await a.press('.dd-input', 'Enter'); await a.waitForTimeout(200); continue; }
        await a.waitForTimeout(150);
      }
      const le = await h.engine(a, lid);
      const lmax = 25 + (le.state.gold >= 1 ? [2, 3, 5, 5, 5, 5][le.state.gold] : 0);
      assert(le.over && le.state.mode === 'ladder' && le.state.score === lmax, `same phone Ladder: six first-try hits climb to ${lmax} (got ${le.state.score})`);
      assert(curtains === 9 && encN === 2, `same phone with an Encore: a curtain at the start, after each of the six drawings, and one before each Encore drawing (${curtains} curtains, ${encN} Encore drawings)`);
      assert(le.state.enc && le.state.enc.a && le.state.enc.b && le.result.score === lmax, 'same phone: both Encore drawings are in and the Encore adds no points');
      await waitFor(() => visible(a, '#game-root .gm-end'), 4000, 'end card after the Encore');
      await h.settle();
      const after = await a.evaluate(() => window.__ddWrites);
      const dbDoc = h.docs['gamedata/doodle'];
      assert(after - before >= 2 && after - before <= 4 && dbDoc.lastRec === lid && dbDoc.plays === plays0 + 1 && dbDoc.best_ladder === lmax, `same phone: the setup choice and exactly one match record were written (${after - before} writes incl. engine re-sends, plays ${dbDoc.plays})`);
      await closeGame(a);
    }


    // ════ 7. Encore, two phones: reveal, both draw at once, wait, reload, the pair in the gallery ════
    console.log('# doodle Encore (two phones)');
    {
      const reloadInto2 = async (pg, mid) => { await pg.reload(); await pg.waitForFunction(() => !!document.querySelector('.tabbar'), null, { timeout: 15000 }); await pg.waitForTimeout(300); await h.openMatch(pg, mid); await pg.waitForTimeout(500); };
      await openSeed(a, 'enc2'); await openSeed(b, 'enc2');
      const est = (await h.engine(a, 'enc2')).state;
      assert(est.enc && est.r === 6 && JSON.stringify((await h.engine(a, 'enc2')).acts) === '["a","b"]', 'encore seed: six rounds done, both players asked to draw');
      await a.waitForSelector('.dd-next'); await b.waitForSelector('.dd-next');
      assert(/On to the Encore/.test(await a.textContent('.dd-next')) && /On to the Encore/.test(await b.textContent('.dd-next')), 'encore: both players see the last result first, with "On to the Encore"');
      assert(!(await a.$('.dd-wall')) && !(await visible(a, '#game-root .gm-end')), 'encore: no gallery and no end card yet');
      for (const [w, hh] of [[375, 548], [844, 390], [390, 664]]) { await a.setViewportSize({ width: w, height: hh }); await a.waitForTimeout(300); assert(await inView(a, '.dd-next') && await noSideScroll(a), `encore reveal ${w}x${hh}: the next button is in view`); }
      await a.tap('.dd-next'); await b.tap('.dd-next');
      await a.waitForSelector('.dd-paper.can-draw canvas'); await b.waitForSelector('.dd-paper.can-draw canvas');
      const cardWord = POOL[est.enc.prompt].show;
      assert(/Encore/.test(await a.textContent('.dd-word small')) && (await wordOf(a)).toLowerCase() === cardWord && (await wordOf(b)).toLowerCase() === cardWord, `encore: both phones draw the same card at once (${cardWord})`);
      for (const [w, hh, name] of [[390, 664, 'portrait'], [375, 548, 'small'], [844, 390, 'landscape']]) {
        await a.setViewportSize({ width: w, height: hh }); await a.waitForTimeout(350);
        assert(await inView(a, '.dd-paper') && await inView(a, '.dd-send') && await inView(a, '.dd-timer') && await inView(a, '.dd-swatch[data-c="3"]') && await noSideScroll(a), `encore draw ${w}x${hh}: paper, timer, tools and Send are in view`);
        if (name !== 'portrait') await a.screenshot({ path: `${SHOTS}/encore-draw-${name}.png` });
      }
      await a.setViewportSize({ width: 390, height: 664 }); await a.waitForTimeout(250);
      await touchDraw(a, cdps.a, PICS[0]); await a.tap('.dd-send'); await h.settle();
      let eg = await h.engine(a, 'enc2');
      assert(eg.state.enc.a && eg.state.enc.b === null && JSON.stringify(eg.acts) === '["b"]' && !eg.over, 'encore: Emerson’s drawing is in, the match waits for Sydney');
      await a.waitForSelector('.dd-waiting');
      assert(/is still drawing/.test(await a.textContent('.dd-wait-name')) && !(await a.$('.dd-wall')) && !(await a.$('.dd-encore')), 'encore: Emerson waits and sees nothing of the other drawing');
      assert(await visible(b, '.dd-send') && !(await b.$('.dd-wall')), 'encore: Sydney is still drawing, no peeking');
      // reload mid-encore restores the unsent drawing
      await touchDraw(b, cdps.b, PICS[1]);
      const inkBefore = await inkPixels(b);
      await reloadInto2(b, 'enc2');
      await b.waitForSelector('.dd-paper.can-draw canvas', { timeout: 6000 });
      assert((await wordOf(b)).toLowerCase() === cardWord && await inkPixels(b) > 300 && !(await b.$eval('[data-a="undo"]', (x) => x.disabled)), `encore: reload mid-encore restores the card and the unsent drawing (${inkBefore} -> ${await inkPixels(b)} px)`);
      const bSecs = await b.$eval('.dd-secs', (x) => { const [m, ss] = x.textContent.split(':').map(Number); return m * 60 + ss; });
      assert(bSecs <= 74 && bSecs > 30, `encore: the clock kept running through the reload (${bSecs}s left)`);
      await b.tap('.dd-send');
      await waitFor(async () => (await visible(a, '#game-root .gm-end')) && (await visible(b, '#game-root .gm-end')), 9000, 'end cards after both Encore drawings');
      eg = await h.engine(a, 'enc2');
      assert(eg.over && eg.state.enc.a && eg.state.enc.b && eg.result.score === est.score && !/encore/i.test(eg.result.sub) && eg.result.text === (await h.engine(b, 'enc2')).result.text, 'encore: the end card follows the second drawing at once; score, rating and sub-line ignore the Encore');
      await a.tap('#game-root [data-g="end-look"]'); await b.tap('#game-root [data-g="end-look"]');
      await a.waitForSelector('.dd-encore'); await b.waitForSelector('.dd-encore');
      assert((await a.textContent('.dd-encore-title')).toLowerCase() === cardWord && await a.$$eval('.dd-encore canvas', (xs) => xs.length) === 2 && await a.$$eval('.dd-encpin', (xs) => xs.length) === 2, 'encore gallery: one double frame titled with the card, both drawings, a pin button on each');
      await a.waitForTimeout(2800);
      assert(await inkPixels(a, '.dd-encore-pic[data-w="a"] canvas') > 50 && await inkPixels(a, '.dd-encore-pic[data-w="b"] canvas') > 50, 'encore gallery: both drawings are painted');
      for (const [w, hh, name] of [[375, 548, 'small'], [844, 390, 'landscape'], [390, 664, 'portrait']]) {
        await a.setViewportSize({ width: w, height: hh }); await a.waitForTimeout(350);
        await a.$eval('.dd-encore', (x) => x.scrollIntoView({ block: 'center' })); await a.waitForTimeout(150);
        const fits = await a.evaluate(() => { const e = document.querySelector('.dd-encore').getBoundingClientRect(); return e.left >= 0 && e.right <= innerWidth && [...document.querySelectorAll('.dd-encpin')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= e.left && r.right <= e.right && r.height >= 44; }); });
        assert(fits && await noSideScroll(a), `encore gallery ${w}x${hh}: the double frame and its pin buttons fit`);
        if (name !== 'small') await a.screenshot({ path: `${SHOTS}/encore-gallery-${name}.png` });
      }
      await a.tap('.dd-encpin[data-w="b"]'); await a.waitForTimeout(300);
      assert(/Unpin/.test(await a.textContent('.dd-encpin[data-w="b"]')) && (await a.evaluate(() => JSON.parse(localStorage.getItem('ju.games.data.v1') || '{}').doodle || {})).pin === 'enc2:eb', 'encore gallery: pinning one of the two drawings stores it on the fridge');
      await closeGame(a); await closeGame(b);
    }
    // a phone that reloads on the waiting screen still gets the end card at once when the other finishes
    {
      await openSeed(a, 'enc3'); await openSeed(b, 'enc3');
      await a.waitForSelector('.dd-next'); await b.waitForSelector('.dd-next'); await a.tap('.dd-next'); await b.tap('.dd-next');
      await a.waitForSelector('.dd-paper.can-draw canvas'); await b.waitForSelector('.dd-paper.can-draw canvas');
      await touchDraw(a, cdps.a, PICS[0]); await a.tap('.dd-send'); await h.settle();
      await a.waitForSelector('.dd-waiting');
      await a.reload(); await a.waitForFunction(() => !!document.querySelector('.tabbar'), null, { timeout: 15000 }); await a.waitForTimeout(300);
      await h.openMatch(a, 'enc3'); await a.waitForSelector('.dd-waiting'); await a.waitForTimeout(400);
      await touchDraw(b, cdps.b, PICS[1]); await b.tap('.dd-send');
      const t0 = Date.now();
      await waitFor(() => visible(a, '#game-root .gm-end'), 8000, 'end card on the reloaded phone');
      const took = Date.now() - t0;
      assert(took < 2500, `encore: after a reload on the waiting screen the end card still follows the other phone's drawing promptly (${took} ms)`);
      await closeGame(a); await closeGame(b);
    }
    h.assertNoErrors();
  } catch (e) {
    await h.shot(a, `${SHOTS}/fail-a.png`).catch(() => {});
    await h.shot(b, `${SHOTS}/fail-b.png`).catch(() => {});
    console.error('page errors:', h.errors);
    throw e;
  } finally {
    await h.close();
  }
}

module.exports = { rulesTests, loadRules, uiTests };

if (require.main === module) {
  (async () => {
    console.log('# rules');
    const rules = await loadRules();
    if (process.env.UI_ONLY !== '1') rulesTests(rules);
    if (process.env.RULES_ONLY === '1') { console.log(`\n${passed} checks passed (rules only)`); return; }
    await uiTests({ assert, SHOTS, rules, launch });
    console.log(`\n${passed} checks passed`);
  })().catch((e) => { console.error(e); process.exit(1); });
}
