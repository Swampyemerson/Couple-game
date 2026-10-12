// Unit tests for the Defuse MORSE module (signal lamp). Pure functions only, no DOM.
const U = await import(new URL('../../../../js/games/defuse/util.js', import.meta.url));
const { MORSE, morseTimeline, khzText } = await import(new URL('../../../../js/games/defuse/morse.js', import.meta.url));

const STD = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..' };
const TIERS = [1, 2, 3, 4].map((level) => ({ id: ['chill', 'normal', 'spicy', 'wild'][level - 1], level, stages: [3, 4, 5, 5][level - 1] }));
const LABELS = ['RDY', 'PWR', 'AUX', 'LNK', 'SYS', 'CLR', 'IGN', 'MSA'];

function edgework(seed) {
  const r = U.stream(seed, 'edge');
  const L = 'BCDFGHJKLMNPQRSTVWXYZAEIOU';
  let serial = '';
  for (let i = 0; i < 5; i++) serial += L[U.int(r, L.length)];
  serial += U.int(r, 10);
  return { serial, batteries: U.int(r, 5), indicators: U.sample(r, LABELS, 2).map((label) => ({ label, lit: r() < 0.5 })), ports: [] };
}
const build = (seed, T) => {
  const R = MORSE.rules(U.stream(seed, 'rules', 'morse'), T);
  const E = edgework(seed);
  const S = MORSE.gen(U.stream(seed, 'gen', 'morse'), E, R, T);
  return { R, E, S };
};

/** What a person sees on the lamp: the dot/dash groups, one per letter. */
function readLamp(word, chart, u) {
  const groups = [];
  let cur = '';
  for (const [on, ms, li] of morseTimeline(word, chart, u)) {
    if (on) cur += ms > 2 * u ? '-' : '.';
    else if (li !== -1 && ms >= 3 * u) { groups.push(cur); cur = ''; }
    else if (li === -1) { groups.push(cur); cur = ''; }
  }
  return groups;
}
/** Parse the manual page like a reader would. */
function parsePage(html) {
  const chart = {};
  for (const m of html.matchAll(/<li data-letter="([A-Z])" data-code="([.-]+)"/g)) chart[m[2]] = m[1]; // code -> letter
  const words = [];
  for (const m of html.matchAll(/<tr data-word="([A-Z]+)" data-khz="(\d+)"/g)) words.push([m[1], +m[2]]);
  return { chart, words };
}

export async function run({ assert }) {
  const SEEDS = 1000;

  // pool + helpers
  assert(khzText(3515) === '3.515' && khzText(14005) === '14.005', 'khzText formats kHz as MHz');
  const tl = morseTimeline('LAMP', STD, 300);
  assert(tl.filter((x) => x[0]).length === STD.L.length + STD.A.length + STD.M.length + STD.P.length, 'timeline has one flash per dot/dash');
  assert(tl[tl.length - 1][0] === 0 && tl[tl.length - 1][1] === 2400 && tl[tl.length - 1][2] === -1, 'timeline ends with the long pause before the word repeats');
  assert(tl.every((x) => x[1] === 300 || x[1] === 900 || x[1] === 2400), 'timeline uses dot, dash, letter gap and word gap lengths only');

  // determinism
  for (const T of TIERS) {
    for (const seed of [1, 'abc', 77]) {
      const a = build(seed, T);
      const b = build(seed, T);
      assert(JSON.stringify(a) === JSON.stringify(b), `deterministic rules + gen (level ${T.level}, seed ${seed})`);
      assert(JSON.stringify(a).length < 2600, 'rules + puzzle stay small');
    }
  }
  assert(JSON.stringify(build(1, TIERS[1]).R) !== JSON.stringify(build(2, TIERS[1]).R), 'different seeds, different rules');

  for (const T of TIERS) {
    const charts = new Set();
    const rulesSeen = new Set();
    const wordShare = {};
    const idxShare = {};
    const startNear = [];
    let bad = '';
    let unscrambledEqual = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const { R, E, S } = build(seed, T);
      const n = T.level >= 3 ? 16 : T.level === 2 ? 14 : 12;
      const words = R.table.map((x) => x[0]);
      if (R.table.length !== n || R.freqs.length !== n) { bad = `row count at seed ${seed}`; break; }
      if (new Set(words).size !== n || !words.every((w) => /^[A-Z]{4,5}$/.test(w))) { bad = `words at seed ${seed}`; break; }
      if (JSON.stringify([...words].sort()) !== JSON.stringify(words)) { bad = `table not alphabetical at seed ${seed}`; break; }
      if (new Set(words.map((w) => w.slice(0, 2))).size !== n) { bad = `first two letters repeat at seed ${seed}`; break; }
      if (!R.freqs.every((f, i) => i === 0 || f > R.freqs[i - 1])) { bad = `freqs not ascending at seed ${seed}`; break; }
      if (R.freqs.some((f) => f < 3500 || f > 25000)) { bad = `freq out of range at seed ${seed}`; break; }
      if (JSON.stringify(R.table.map((x) => x[1]).sort((a, b) => a - b)) !== JSON.stringify(R.freqs.map((_, i) => i))) { bad = `freq assignment not a permutation at seed ${seed}`; break; }
      // chart: a bijection onto the standard code set
      const letters = Object.keys(R.chart);
      const stdCodes = Object.values(STD).sort().join(',');
      if (letters.length !== 26 || Object.values(R.chart).sort().join(',') !== stdCodes) { bad = `chart is not a permutation of the standard codes at seed ${seed}`; break; }
      const same = letters.every((l) => R.chart[l] === STD[l]);
      if (T.level === 1 && !same) { bad = `level 1 chart must be standard (seed ${seed})`; break; }
      if (T.level >= 2 && same) unscrambledEqual++;
      charts.add(JSON.stringify(R.chart));
      rulesSeen.add(JSON.stringify(R));
      // first two letters (as codes) are enough to tell the words apart
      const pairs = new Set(words.map((w) => R.chart[w[0]] + '|' + R.chart[w[1]]));
      if (pairs.size !== n) { bad = `two letters do not disambiguate at seed ${seed}`; break; }
      // puzzle
      const ans = MORSE.solve(S, E, R, T);
      if (!(ans >= 0 && ans < n)) { bad = `answer out of range at seed ${seed}`; break; }
      if (S.start === ans || S.start < 0 || S.start >= n) { bad = `start must differ from the answer (seed ${seed})`; break; }
      const row = R.table.filter((x) => x[0] === S.word);
      if (row.length !== 1 || row[0][1] !== ans) { bad = `word/answer mismatch at seed ${seed}`; break; }
      // the lamp, read back through the chart, gives exactly one word
      const inv = Object.fromEntries(Object.entries(R.chart).map(([l, c]) => [c, l]));
      const read = readLamp(S.word, R.chart, R.unit).map((g) => inv[g]).join('');
      if (read !== S.word) { bad = `lamp does not decode to ${S.word} (got ${read}) at seed ${seed}`; break; }
      if (words.filter((w) => w.startsWith(read.slice(0, 2))).length !== 1) { bad = `partial read is ambiguous at seed ${seed}`; break; }
      if (words.filter((w) => w === read).length !== 1) { bad = `unique word at seed ${seed}`; break; }
      wordShare[S.word] = (wordShare[S.word] || 0) + 1;
      idxShare[ans] = (idxShare[ans] || 0) + 1;
      startNear.push(Math.min((S.start - ans + n) % n, (ans - S.start + n) % n));
    }
    assert(!bad, `level ${T.level}: ${SEEDS} seeds well formed${bad ? ' - ' + bad : ''}`);
    if (bad) continue;
    assert(true, `level ${T.level}: ${SEEDS} seeds always solvable and unique, partial reads disambiguate after two letters`);
    assert(rulesSeen.size >= 990, `level ${T.level}: rules vary between seeds (${rulesSeen.size} distinct in ${SEEDS})`);
    if (T.level >= 2) {
      assert(charts.size >= 990 && unscrambledEqual === 0, `level ${T.level}: scrambled chart differs across seeds and from real Morse (${charts.size} distinct)`);
    } else {
      assert(charts.size === 1, 'level 1 uses standard Morse everywhere');
    }
    const maxShare = Math.max(...Object.values(idxShare)) / SEEDS;
    assert(maxShare < 0.2, `level ${T.level}: no single frequency is the answer more than 20% (max ${(maxShare * 100).toFixed(1)}%)`);
    assert(Math.max(...Object.values(wordShare)) / SEEDS < 0.05 && Object.keys(wordShare).length > 55, `level ${T.level}: the pool is spread (${Object.keys(wordShare).length} words used)`);
    assert(Math.min(...startNear) >= 1, 'tuner never starts on the answer');
    const far = startNear.filter((d) => d >= 2).length / SEEDS;
    assert(far > 0.95, `level ${T.level}: the tuner almost always starts 2+ stops away (${(far * 100).toFixed(1)}%)`);
  }

  // pool size and variety
  {
    const seenWords = new Set();
    for (let seed = 0; seed < 300; seed++) for (const [w] of build(seed, TIERS[3]).R.table) seenWords.add(w);
    assert(seenWords.size >= 60, `word pool has at least 60 words (${seenWords.size} reached)`);
  }

  // solve from the page, without touching R
  for (const T of TIERS) {
    let bad = '';
    for (let seed = 0; seed < SEEDS && !bad; seed++) {
      const { R, E, S } = build(seed, T);
      const html = MORSE.page(R, T);
      const P = parsePage(html);
      if (Object.keys(P.chart).length < 12 || P.words.length !== R.table.length) { bad = `page data incomplete (seed ${seed})`; break; }
      // The holder reads the lamp as dots and dashes; we decode with the page's chart only.
      const groups = readLamp(S.word, R.chart, R.unit);
      const letters = groups.map((g) => P.chart[g]);
      if (letters.some((x) => !x)) { bad = `page chart cannot decode a letter (seed ${seed})`; break; }
      const hits = P.words.filter(([w]) => w.startsWith(letters.slice(0, 2).join('')));
      if (hits.length !== 1 || hits[0][0] !== letters.join('')) { bad = `page lookup not unique (seed ${seed})`; break; }
      const sorted = P.words.map((x) => x[1]).sort((a, b) => a - b);
      const idx = sorted.indexOf(hits[0][1]);
      if (idx !== MORSE.solve(S, E, R, T)) { bad = `page answer ${idx} != solve ${MORSE.solve(S, E, R, T)} (seed ${seed})`; break; }
      if (JSON.stringify(sorted) !== JSON.stringify(R.freqs)) { bad = `page frequencies differ from the tuner stops (seed ${seed})`; break; }
      if (!/data-tip="two-letters"/.test(html) || !/two words in the table start/.test(html)) { bad = 'tip missing'; break; }
      if ((T.level === 1) !== /standard Morse/.test(html)) { bad = `chart wording wrong for level ${T.level}`; break; }
    }
    assert(!bad, `level ${T.level}: solve-from-page equals solve()${bad ? ' - ' + bad : ''}`);
  }

  // errata: two words swap frequencies
  {
    let bad = '';
    let changed = 0;
    for (let seed = 0; seed < 300 && !bad; seed++) {
      const T = TIERS[1 + (seed % 3)];
      const R = MORSE.rules(U.stream(seed, 'rules', 'morse'), T);
      const before = JSON.stringify(R);
      const e = MORSE.errata(U.stream(seed, 'errata', 'morse'), R, T);
      if (JSON.stringify(R) !== before) { bad = 'errata mutated R'; break; }
      if (!e) continue;
      const m = e.note.match(/data-errata="swap" data-a="([A-Z]+)" data-b="([A-Z]+)"/);
      if (!m) { bad = 'errata note has no data'; break; }
      const f = (RR, w) => RR.table.find((x) => x[0] === w)[1];
      if (f(e.R, m[1]) !== f(R, m[2]) || f(e.R, m[2]) !== f(R, m[1]) || m[1] === m[2]) { bad = 'errata is not a swap'; break; }
      if (new Set(e.R.table.map((x) => x[1])).size !== R.table.length) { bad = 'errata broke the permutation'; break; }
      const E = edgework(seed);
      const S = MORSE.gen(U.stream(seed, 'gen', 'morse'), E, e.R, T);
      const ans = MORSE.solve(S, E, e.R, T);
      if (!(ans >= 0 && ans < R.freqs.length && S.start !== ans)) { bad = 'gen with errata rules'; break; }
      // page of the original + the slip, read by hand
      const P = parsePage(MORSE.page(R, T));
      const w = P.words.map((x) => [...x]);
      const wa = w.find((x) => x[0] === m[1]);
      const wb = w.find((x) => x[0] === m[2]);
      [wa[1], wb[1]] = [wb[1], wa[1]];
      const sorted = w.map((x) => x[1]).sort((a, b) => a - b);
      if (sorted.indexOf(w.find((x) => x[0] === S.word)[1]) !== ans) { bad = 'slip + page do not give the answer'; break; }
      changed++;
    }
    assert(!bad && changed === 300, `errata swaps two frequencies and the slip + page still solve it${bad ? ' - ' + bad : ''}`);
  }
}
