// Unit tests for the RELAY remote module (role swap). Pure functions only; the panel needs a DOM and is covered by browser tests.
const util = await import(new URL('../../../../js/games/defuse/util.js', import.meta.url));
const { RELAY } = await import(new URL('../../../../js/games/defuse/relay.js', import.meta.url));
const { stream, int, sample } = util;

const LABELS = ['RDY', 'PWR', 'AUX', 'LNK', 'SYS', 'CLR', 'IGN', 'MSA'];
const PORTS = ['DVI', 'PS2', 'RJ45', 'SERIAL'];
function edge(seed) {
  const r = stream(seed, 'edge');
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let serial = ''; for (let i = 0; i < 5; i++) serial += ch[int(r, ch.length)];
  serial += int(r, 10);
  return { serial, batteries: int(r, 5), indicators: sample(r, LABELS, 2).map((label) => ({ label, lit: r() < 0.5 })), ports: sample(r, PORTS, int(r, 4)) };
}
const TIERS = [{ id: 'normal', level: 2, stages: 4 }, { id: 'spicy', level: 3, stages: 5 }, { id: 'wild', level: 4, stages: 5 }];
const build = (seed, T) => {
  const E = edge(seed);
  const R = RELAY.rules(stream(seed, 'rules', 'relay'), T);
  const S = RELAY.gen(stream(seed, 'gen', 'relay'), E, R, T);
  return { E, R, S };
};

// Solve from the printed card alone: parse data-w / data-s, never touching R.
function solveFromCard(html, S, E) {
  const items = [];
  const re = /<li data-w="([^"]*)" data-s="([^"]*)">/g;
  let m;
  while ((m = re.exec(html))) items.push({ w: m[1], s: m[2] });
  const last = +E.serial[E.serial.length - 1];
  const cond = (w) => {
    const [k, v] = w.split(':');
    if (k === 'else') return true;
    if (k === 'lamp') return v.split(',').includes(S.l);
    if (k === 'bat') return E.batteries >= +v;
    if (k === 'serial-even') return last % 2 === 0;
    if (k === 'serial-odd') return last % 2 === 1;
    if (k === 'vowel') return /[AEIOU]/.test(E.serial);
    if (k === 'lit') return E.indicators.some((i) => i.label === v && i.lit);
    if (k === 'port') return E.ports.includes(v);
    throw new Error('bad cond ' + w);
  };
  const sel = (s, i) => {
    const [k, v] = s.split(':');
    if (k === 'even') return S.m[i] % 2 === 0; if (k === 'odd') return S.m[i] % 2 === 1;
    if (k === 'gt') return S.m[i] > +v; if (k === 'lt') return S.m[i] < +v;
    if (k === 'col') return v.split(',').includes(S.c[i]); if (k === 'notcol') return S.c[i] !== v;
    if (k === 'pos') return v.split(',').includes(String(i));
    throw new Error('bad sel ' + s);
  };
  const hit = items.find((x) => cond(x.w));
  return [0, 1, 2, 3].map((i) => (sel(hit.s, i) ? 1 : 0));
}
const mask = (a) => a.reduce((m, v, i) => m | (v << i), 0);

export async function run({ assert }) {
  assert(RELAY.remote === true && RELAY.needy === false && RELAY.id === 'relay', 'relay: remote module, id relay');
  assert(RELAY.tab.length <= 9, 'relay: tab label is 9 chars or fewer');
  assert(typeof RELAY.card === 'function' && typeof RELAY.panel === 'function' && typeof RELAY.step === 'function' && typeof RELAY.init === 'function', 'relay: card, panel, step and init exist');

  for (const T of TIERS) {
    const a = build('rel-det', T), b = build('rel-det', T);
    assert(JSON.stringify(a) === JSON.stringify(b), `relay: same seed builds the same round (${T.id})`);
    assert(RELAY.card(a.S, a.R) === RELAY.card(b.S, b.R) && RELAY.page(a.R, T) === RELAY.page(b.R, T), `relay: card and page are deterministic (${T.id})`);
  }

  let bad = 0, fromCard = 0, onCounts = [0, 0, 0, 0, 0], ruleSets = new Set(), targets = new Set(), liveMax = 0, replayBad = 0, stepBad = 0, flipDist = {}, lampSeen = new Set(), pureBad = 0;
  for (let s = 0; s < 1000; s++) {
    const T = TIERS[s % 3];
    const { E, R, S } = build('rseed-' + s, T);
    ruleSets.add(JSON.stringify(R));
    if (R.chain.length !== (T.level >= 3 ? 3 : 2)) bad++;
    if (new Set(S.c).size !== 4 || new Set(S.m).size !== 4 || S.m.some((x) => x < 1 || x > 9)) bad++;
    lampSeen.add(S.l);
    const tg = RELAY.solve(S, E, R);
    const n = tg.reduce((a, b) => a + b, 0);
    onCounts[n]++;
    if (n < 1 || n > 3) bad++;
    targets.add(tg.join(''));
    const card = RELAY.card(S, R), page = RELAY.page(R, T);
    if (JSON.stringify(solveFromCard(card, S, E)) === JSON.stringify(tg)) fromCard++;
    if (!page.includes('<div class="dx-relay-panel"></div>')) bad++;
    if (/data-w=|data-s=/.test(page)) bad++; // the reader's page must not carry the rules
    // the card never needs S, and the panel start is wrong by 2-3 flips
    const init = RELAY.init(S);
    const diff = (init.p ^ mask(tg)).toString(2).split('1').length - 1;
    flipDist[diff] = (flipDist[diff] || 0) + 1;
    if (diff < 2 || diff > 3) bad++;
    liveMax = Math.max(liveMax, JSON.stringify(init).length);
    // solve with the target configuration
    let lv = init, verdict = null;
    const acts = [];
    for (let i = 0; i < 4; i++) if (((init.p ^ mask(tg)) >> i) & 1) acts.push({ t: 'flip', i });
    acts.push({ t: 'commit' });
    const frozen = JSON.stringify(init);
    for (const a of acts) { const r = RELAY.step(lv, a, S, E, R); lv = r.live; verdict = r.verdict; }
    if (JSON.stringify(init) !== frozen) pureBad++;
    if (verdict !== 'solve' || !lv.d) stepBad++;
    // replaying gives the same live
    let lv2 = RELAY.init(S);
    for (const a of acts) lv2 = RELAY.step(lv2, a, S, E, R).live;
    if (JSON.stringify(lv) !== JSON.stringify(lv2)) replayBad++;
    // wrong commit straight away (the start is wrong by construction) is a strike; then a repeat commit is ignored
    const w1 = RELAY.step(RELAY.init(S), { t: 'commit' }, S, E, R);
    if (w1.verdict !== 'strike' || w1.live.x !== 1) stepBad++;
    const w2 = RELAY.step(w1.live, { t: 'commit' }, S, E, R);
    if (w2.verdict !== null || w2.live.x !== 1) stepBad++;
    const w3 = RELAY.step(w2.live, { t: 'flip', i: 0 }, S, E, R);
    const w4 = RELAY.step(w3.live, { t: 'commit' }, S, E, R);
    if (w3.verdict !== null || (w4.verdict !== 'strike' && w4.verdict !== 'solve')) stepBad++;
    // after solving, nothing counts
    const after = RELAY.step(lv, { t: 'commit' }, S, E, R);
    if (after.verdict !== null) stepBad++;
    // a single wrong relay is a strike
    const near = { p: mask(tg) ^ 1, x: 0, d: 0, h: 0 };
    if (RELAY.step(near, { t: 'commit' }, S, E, R).verdict !== 'strike') stepBad++;
    // junk actions are harmless
    for (const junk of [null, {}, { t: 'flip', i: 9 }, { t: 'flip', i: -1 }, { t: 'nope' }]) {
      const r = RELAY.step(RELAY.init(S), junk, S, E, R);
      if (r.verdict !== null || r.live.p !== RELAY.init(S).p) stepBad++;
    }
  }
  assert(bad === 0, 'relay: 1000 seeds: caps, marks, targets (1-3 relays on), start 2-3 flips away, page carries no rules');
  assert(fromCard === 1000, `relay: solving from the card data alone equals solve() (${fromCard}/1000)`);
  assert(stepBad === 0, 'relay: step: solve configuration -> solve, wrong -> strike, repeat commit ignored, junk harmless');
  assert(pureBad === 0, 'relay: step does not mutate its input');
  assert(replayBad === 0, 'relay: replaying the same actions gives the same live');
  assert(liveMax <= 200, `relay: live is small (${liveMax} bytes)`);
  assert(ruleSets.size >= 900, `relay: rules vary between seeds (${ruleSets.size} distinct)`);
  assert(targets.size >= 10, `relay: many different target configurations (${targets.size} of 14)`);
  assert(lampSeen.size === 6, 'relay: every lamp colour occurs');
  const total = onCounts.reduce((a, b) => a + b, 0);
  // no single target dominates
  const tally = {};
  for (let s = 0; s < 1000; s++) { const { E, R, S } = build('rseed-' + s, TIERS[s % 3]); const t = RELAY.solve(S, E, R).join(''); tally[t] = (tally[t] || 0) + 1; }
  const top = Math.max(...Object.values(tally));
  assert(top <= 250, `relay: no target configuration above 25% (top ${top / 10}%)`);
  assert(total === 1000, 'relay: tally');

  // a hand-built round with a known answer
  const R = { chain: [{ w: 'lamp:red', s: 'even' }, { w: 'serial-odd', s: 'col:blue,green' }], last: 'pos:0,3' };
  const S = { c: ['red', 'blue', 'green', 'white'], m: [2, 3, 4, 5], l: 'red', p: [1, 0, 0, 0] };
  const E = { serial: 'AB12C3', batteries: 1, indicators: [], ports: [] };
  assert(RELAY.solve(S, E, R).join('') === '1010', 'relay: hand case, lamp red picks the even numbers');
  assert(RELAY.solve({ ...S, l: 'blue' }, E, R).join('') === '0110', 'relay: hand case, serial odd picks blue and green caps');
  assert(RELAY.solve({ ...S, l: 'blue' }, { ...E, serial: 'AB12C4' }, R).join('') === '1001', 'relay: hand case, otherwise picks the outer relays');
  const card = RELAY.card(S, R);
  assert(card.includes('data-w="lamp:red"') && card.includes('data-w="else"') && !/relay box shows/i.test(card), 'relay: card markup');
  // the reader's flips, with the panel's optimistic double tap already filtered, reach the target
  let lv = RELAY.init(S);
  assert(lv.p === 1, 'relay: init encodes the starting positions as a bitmask');
  lv = RELAY.step(lv, { t: 'flip', i: 2 }, S, E, R).live;
  const done = RELAY.step(lv, { t: 'commit' }, S, E, R);
  assert(done.verdict === 'solve' && done.live.d === 1, 'relay: hand case commits to a solve');
}
