// Unit tests for the Defuse SWITCHES module (breaker panel). Pure functions only, no DOM.
const U = await import(new URL('../../../../js/games/defuse/util.js', import.meta.url));
const { SWITCHES } = await import(new URL('../../../../js/games/defuse/switches.js', import.meta.url));

const TIERS = [1, 2, 3, 4].map((level) => ({ id: ['chill', 'normal', 'spicy', 'wild'][level - 1], level, stages: [3, 4, 5, 5][level - 1] }));
const LABELS = ['RDY', 'PWR', 'AUX', 'LNK', 'SYS', 'CLR', 'IGN', 'MSA'];
const PORTS = ['DVI', 'PS2', 'RJ45', 'SERIAL'];

function edgework(seed) {
  const r = U.stream(seed, 'edge');
  const L = 'BCDFGHJKLMNPQRSTVWXYZAEIOU';
  let serial = '';
  for (let i = 0; i < 5; i++) serial += L[U.int(r, L.length)];
  serial += U.int(r, 10);
  return { serial, batteries: U.int(r, 5), indicators: U.sample(r, LABELS, 2).map((label) => ({ label, lit: r() < 0.5 })), ports: U.sample(r, PORTS, U.int(r, 4)) };
}
const build = (seed, T) => {
  const R = SWITCHES.rules(U.stream(seed, 'rules', 'switches'), T);
  const E = edgework(seed);
  const S = SWITCHES.gen(U.stream(seed, 'gen', 'switches'), E, R, T);
  return { R, E, S };
};

// ---- a reader's implementation, written from the page only ----
function cond(c, E, s, leds) {
  const [k, v] = c.split(':');
  const last = +E.serial[E.serial.length - 1];
  const lit = leds.filter((x) => x !== 'off').length;
  if (k === 'vowel') return /[AEIOU]/.test(E.serial);
  if (k === 'novowel') return !/[AEIOU]/.test(E.serial);
  if (k === 'even') return last % 2 === 0;
  if (k === 'odd') return last % 2 === 1;
  if (k === 'batmore') return E.batteries > lit;
  if (k === 'bat0') return E.batteries === 0;
  if (k === 'bat2') return E.batteries >= 2;
  if (k === 'lit') return E.indicators.some((i) => i.label === v && i.lit);
  if (k === 'port') return E.ports.includes(v);
  if (k === 'led') return leds.includes(v);
  if (k === 'up') return s[+v - 1] === 1;
  if (k === 'dn') return s[+v - 1] === 0;
  throw new Error('unknown condition ' + c);
}
function parsePage(html) {
  const attr = (tag, name) => { const m = tag.match(new RegExp(`${name}="([^"]*)"`)); return m ? m[1] : null; };
  const table = {};
  for (const m of html.matchAll(/<tr [^>]*data-led-color="[^"]*"[^>]*>/g)) table[attr(m[0], 'data-led-color')] = attr(m[0], 'data-ops').split(' ');
  const rev = (html.match(/<li [^>]*data-rev-if="([^"]*)"/) || [])[1] || null;
  const mods = [...html.matchAll(/<li [^>]*data-mod-if="([^"]*)"[^>]*data-ops="([^"]*)"/g)].map((m) => ({ c: m[1], ops: m[2].split(' ') }));
  const forbid = [...html.matchAll(/<li [^>]*data-forbid="([^"]*)"/g)].map((m) => m[1].split(' ').map((x) => [+x[0] - 1, x[1] === 'u' ? 1 : 0]));
  return { table, rev, mods, forbid };
}
function applyOps(s, ops) {
  for (const o of ops) { const k = +o.slice(1) - 1; if (o[0] === 'f') s[k] = 1 - s[k]; else s[k] = o[0] === 'u' ? 1 : 0; }
}
function solveFromPage(P, S, E) {
  const s = [...S.sw];
  let lit = S.leds.filter((c) => c !== 'off');
  if (P.rev && cond(P.rev, E, s, S.leds)) lit = lit.reverse();
  for (const c of lit) applyOps(s, P.table[c]);
  for (const m of P.mods) if (cond(m.c, E, s, S.leds)) applyOps(s, m.ops);
  return s;
}
const violates = (s, forbid) => forbid.some((f) => f.every(([k, v]) => s[k] === v));

export async function run({ assert }) {
  const SEEDS = 1000;

  for (const T of TIERS) {
    for (const seed of [1, 'abc', 77]) {
      const a = build(seed, T);
      const b = build(seed, T);
      assert(JSON.stringify(a) === JSON.stringify(b), `deterministic rules + gen (level ${T.level}, seed ${seed})`);
      assert(JSON.stringify(a.S).length < 400, 'puzzle stays small');
    }
  }
  assert(JSON.stringify(build(1, TIERS[1]).R) !== JSON.stringify(build(2, TIERS[1]).R), 'different seeds, different rules');

  for (const T of TIERS) {
    const rulesSeen = new Set();
    const answers = {};
    const colours = new Set();
    const flipCounts = {};
    let bad = '';
    let revMatters = 0;
    let revOn = 0;
    let withState = 0;
    let startUp = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const { R, E, S } = build(seed, T);
      // rule shape per level
      const wantLeds = T.level === 1 ? 2 : 3;
      if (R.leds !== wantLeds || R.cols.length !== (T.level === 1 ? 3 : 4) || new Set(R.cols).size !== R.cols.length) { bad = `leds/colours at seed ${seed}`; break; }
      if (R.forbid.length !== (T.level < 3 ? 0 : T.level === 3 ? 2 : 3)) { bad = `forbidden count at seed ${seed}`; break; }
      if (T.level === 1 && (R.rev || R.mods.length !== 1 || JSON.stringify(R).match(/"[ud]\d"/))) { bad = `level 1 must be flips only with one modifier (seed ${seed})`; break; }
      if (T.level >= 2 && R.mods.length < 2) { bad = `level ${T.level} needs 2+ steps (seed ${seed})`; break; }
      if (new Set(R.cols.map((c) => R.map[c].join(' '))).size !== R.cols.length) { bad = `two colours do the same at seed ${seed}`; break; }
      if (!R.cols.every((c) => R.map[c].length === 2 && new Set(R.map[c].map((o) => o.slice(1))).size === 2)) { bad = `colour ops at seed ${seed}`; break; }
      rulesSeen.add(JSON.stringify(R));
      // puzzle
      if (S.sw.length !== 5 || !S.sw.every((x) => x === 0 || x === 1)) { bad = `switches at seed ${seed}`; break; }
      if (S.leds.length !== R.leds || S.leds.every((c) => c === 'off') || !S.leds.every((c) => c === 'off' || R.cols.includes(c))) { bad = `leds at seed ${seed}`; break; }
      S.leds.forEach((c) => colours.add(c));
      const ans = SWITCHES.solve(S, E, R, T);
      if (ans.length !== 5 || !ans.every((x) => x === 0 || x === 1)) { bad = `answer shape at seed ${seed}`; break; }
      if (ans.join('') === S.sw.join('')) { bad = `answer equals the start at seed ${seed}`; break; }
      if (violates(ans, R.forbid)) { bad = `answer breaks a safety check at seed ${seed}`; break; }
      answers[ans.join('')] = (answers[ans.join('')] || 0) + 1;
      const flips = ans.filter((x, i) => x !== S.sw[i]).length;
      flipCounts[flips] = (flipCounts[flips] || 0) + 1;
      startUp += S.sw.filter((x) => x).length;
      if (R.mods.some((m) => /^(up|dn):/.test(m.c))) withState++;
      if (R.rev && E) {
        revOn++;
        const lit = S.leds.filter((c) => c !== 'off');
        const fwd = SWITCHES.solve(S, E, { ...R, rev: null }, T);
        const rev = SWITCHES.solve({ ...S, leds: [...S.leds].reverse() }, E, { ...R, rev: null }, T);
        if (lit.length > 1 && fwd.join('') !== rev.join('')) revMatters++;
      }
    }
    assert(!bad, `level ${T.level}: ${SEEDS} seeds well formed${bad ? ' - ' + bad : ''}`);
    if (bad) continue;
    assert(true, `level ${T.level}: always solvable, answer differs from the start and never breaks a safety check`);
    assert(rulesSeen.size >= 950, `level ${T.level}: rules vary between seeds (${rulesSeen.size} distinct in ${SEEDS})`);
    const maxShare = Math.max(...Object.values(answers)) / SEEDS;
    assert(maxShare < 0.1 && Object.keys(answers).length >= 28, `level ${T.level}: answers are spread (${Object.keys(answers).length} of 32 rows, max ${(maxShare * 100).toFixed(1)}%)`);
    assert(Object.keys(flipCounts).length >= 4, `level ${T.level}: the number of switches to change varies (${JSON.stringify(flipCounts)})`);
    assert(startUp / SEEDS > 2.3 && startUp / SEEDS < 2.7, 'start positions are random');
    assert(colours.has('off') && colours.size === 5, `level ${T.level}: LEDs show off and every colour over many rounds (${[...colours].sort()})`);
    if (T.level >= 2) assert(withState > SEEDS * 0.9, `level ${T.level}: state-dependent steps appear`);
    if (T.level >= 3) assert(revOn > SEEDS * 0.7 && revMatters > 100, `level ${T.level}: reversing the LED order changes answers (${revMatters}/${revOn})`);
  }

  // solve from the page, without touching R
  for (const T of TIERS) {
    let bad = '';
    for (let seed = 0; seed < SEEDS && !bad; seed++) {
      const { R, E, S } = build(seed, T);
      const html = SWITCHES.page(R, T);
      const P = parsePage(html);
      if (Object.keys(P.table).length !== R.cols.length || P.mods.length !== R.mods.length || P.forbid.length !== R.forbid.length || (P.rev || null) !== R.rev) { bad = `page data incomplete (seed ${seed})`; break; }
      const got = solveFromPage(P, S, E);
      const want = SWITCHES.solve(S, E, R, T);
      if (got.join('') !== want.join('')) { bad = `page answer ${got.join('')} != solve ${want.join('')} (seed ${seed})`; break; }
      if (violates(got, P.forbid)) { bad = `page safety check fails (seed ${seed})`; break; }
      if (/undefined|NaN|\[object/.test(html)) { bad = `page has junk text (seed ${seed})`; break; }
    }
    assert(!bad, `level ${T.level}: solve-from-page equals solve()${bad ? ' - ' + bad : ''}`);
  }

  // errata: one colour row is reprinted
  {
    let bad = '';
    let n = 0;
    for (let seed = 0; seed < 300 && !bad; seed++) {
      const T = TIERS[1 + (seed % 3)];
      const R = SWITCHES.rules(U.stream(seed, 'rules', 'switches'), T);
      const before = JSON.stringify(R);
      const e = SWITCHES.errata(U.stream(seed, 'errata', 'switches'), R, T);
      if (JSON.stringify(R) !== before) { bad = 'errata mutated R'; break; }
      if (!e) continue;
      const m = e.note.match(/data-errata="map" data-led-color="(\w+)" data-ops="([^"]+)"/);
      if (!m || !R.cols.includes(m[1])) { bad = 'errata note has no data'; break; }
      if (e.R.map[m[1]].join(' ') !== m[2] || m[2] === R.map[m[1]].join(' ')) { bad = 'errata did not change the row'; break; }
      const E = edgework(seed);
      const S = SWITCHES.gen(U.stream(seed, 'gen', 'switches'), E, e.R, T);
      const ans = SWITCHES.solve(S, E, e.R, T);
      if (ans.join('') === S.sw.join('') || violates(ans, e.R.forbid)) { bad = 'gen with errata rules'; break; }
      const P = parsePage(SWITCHES.page(R, T));
      P.table[m[1]] = m[2].split(' ');
      if (solveFromPage(P, S, E).join('') !== ans.join('')) { bad = 'slip + page do not give the answer'; break; }
      n++;
    }
    assert(!bad && n === 300, `errata reprints one LED row and the slip + page still solve it${bad ? ' - ' + bad : ''}`);
  }

  // missing edgework pieces must not throw (older bomb objects without ports)
  {
    const T = TIERS[3];
    const { R, S } = build(5, T);
    const E = { serial: 'AB1234', batteries: 0, indicators: [] };
    assert(Array.isArray(SWITCHES.solve(S, E, R, T)), 'solve tolerates edgework without ports');
  }
}
