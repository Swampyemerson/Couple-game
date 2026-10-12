// Unit tests for the Defuse PASSWORD module: pure rules / gen / solve, solving from the manual page.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { PASSWORD } = await import(new URL('../../../../js/games/defuse/password.js', import.meta.url));
const { stream } = await import(new URL('../../../../js/games/defuse/util.js', import.meta.url));

const E = { serial: 'AB12C4', batteries: 2, indicators: [{ label: 'RDY', lit: true }, { label: 'PWR', lit: false }] };
const TIERS = [1, 2, 3, 4].map((level) => ({ id: ['chill', 'normal', 'spicy', 'wild'][level - 1], level, stages: [3, 4, 5, 5][level - 1] }));
const SEEDS = 1000;
const attr = (s, k) => (s.match(new RegExp(`${k}="([^"]*)"`)) || [])[1];

const build = (seed, T) => {
  const R = PASSWORD.rules(stream(seed, 'rules', 'password'), T);
  const S = PASSWORD.gen(stream(seed, 'gen', 'password'), E, R, T);
  return { R, S };
};
/** Every listed word that the five columns can spell, ignoring the module's own bookkeeping. */
const spellable = (cols, words) => words.filter((w) => [...w].every((ch, i) => cols[i].includes(ch)));
/** Solve from nothing but the page HTML (and, if given, the errata slip) and the bomb's five columns. */
const fromPage = (html, cols, slip) => {
  const list = attr(html, 'data-words').split(',');
  const struck = slip ? attr(slip, 'data-struck') : null;
  const ok = spellable(cols, list).filter((w) => w !== struck);
  return ok.length === 1 ? ok[0] : null;
};

export async function run({ assert }) {
  // the pool lives in the source file; check it from there
  const src = readFileSync(fileURLToPath(new URL('../../../../js/games/defuse/password.js', import.meta.url)), 'utf8');
  const pool = eval(`(${src.match(/const POOL = (\([\s\S]*?\))\.split/)[1]})`).split(' ');
  assert(pool.length >= 120, `pool has ${pool.length} words (>= 120)`);
  assert(new Set(pool).size === pool.length, 'pool has no duplicates');
  assert(pool.every((w) => /^[A-Z]{5}$/.test(w)), 'every pool word is five capital letters');

  // contract
  assert(PASSWORD.id === 'password' && PASSWORD.tab.length <= 9 && !PASSWORD.needy && !PASSWORD.remote, 'plugin identity');
  assert(PASSWORD.css.includes('.dx-pw'), 'css is scoped under the dx-pw prefix');
  assert(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(PASSWORD.css + PASSWORD.page(build('x', TIERS[0]).R, TIERS[0])), 'no emoji');

  // determinism
  for (const T of TIERS) {
    const a = build('det-1', T);
    const b = build('det-1', T);
    assert(JSON.stringify(a) === JSON.stringify(b), `deterministic rules + puzzle (level ${T.level})`);
    assert(PASSWORD.page(a.R, T) === PASSWORD.page(b.R, T), `deterministic page (level ${T.level})`);
    assert(JSON.stringify(a) !== JSON.stringify(build('det-2', T)), `different seed, different round (level ${T.level})`);
    assert(JSON.stringify(a).length < 600, 'puzzle + rules are small');
  }

  for (const T of TIERS) {
    const want = T.level === 1 ? 20 : T.level === 2 ? 25 : 30;
    const answers = new Map();
    const lists = new Set();
    const firstLetters = new Set();
    let near = 0;
    let startsOnList = 0;
    for (let n = 0; n < SEEDS; n++) {
      const seed = `pw-${n}`;
      const { R, S } = build(seed, T);
      assert(R.words.length === want && new Set(R.words).size === want, `${want} distinct words (level ${T.level}, ${seed})`);
      assert(R.words.every((w, i) => i === 0 || R.words[i - 1] < w), `alphabetical (${seed})`);
      assert(S.c.length === 5 && S.c.every((c) => c.length === 6 && new Set(c).size === 6 && c === [...c].sort().join('')), `five columns of six distinct letters (${seed})`);
      assert(S.s.length === 5 && S.s.every((p) => p >= 0 && p < 6), `start positions in range (${seed})`);
      const ok = spellable(S.c, R.words);
      assert(ok.length === 1, `exactly one listed word can be spelled (level ${T.level}, ${seed}): ${ok}`);
      const ans = PASSWORD.solve(S, E, R, T);
      assert(ans === ok[0], `solve() is that word (${seed})`);
      const shown = S.s.map((p, i) => S.c[i][p]).join('');
      if (R.words.includes(shown)) startsOnList++;
      // solve from the page
      const html = PASSWORD.page(R, T);
      assert(fromPage(html, S.c) === ans, `solve-from-page equals solve() (${seed})`);
      assert(html.includes(`data-word="${ans}"`), 'answer is on the page');
      // drive: apply the taps to the start positions and check they land on the word, then submit
      const taps = PASSWORD.drive(S, E, R, null);
      const pos = [...S.s];
      for (const t of taps) { const m = t.sel.match(/data-col="(\d)"\]\[data-roll="(-?1)"/); if (m) pos[+m[1]] = (pos[+m[1]] + +m[2] + 6) % 6; }
      assert(pos.map((p, i) => S.c[i][p]).join('') === ans && taps[taps.length - 1].sel === '.dx-pw-submit', `drive() sets the word and submits (${seed})`);
      assert(taps.length <= 5 * 3 + 1, 'drive is at most 3 taps per column plus submit');
      answers.set(ans, (answers.get(ans) || 0) + 1);
      lists.add(R.words.join());
      firstLetters.add(ans[0]);
      // near misses: how often some other listed word has 4 of 5 letters available (lures work)
      if (R.words.some((w) => w !== ans && [...w].filter((ch, i) => S.c[i].includes(ch)).length === 4)) near++;
    }
    const top = Math.max(...answers.values());
    assert(lists.size > SEEDS * 0.99, `lists vary across seeds (${lists.size}/${SEEDS}, level ${T.level})`);
    assert(answers.size >= 60, `many different passwords (${answers.size}, level ${T.level})`);
    assert(top / SEEDS < 0.05, `no password dominates (top ${(top / SEEDS * 100).toFixed(1)} %, level ${T.level})`);
    assert(firstLetters.size >= 12, `answers start with many letters (${firstLetters.size})`);
    assert(startsOnList === 0, `the bomb never starts on a listed word (level ${T.level})`);
    if (T.level >= 3) assert(near > SEEDS * 0.2, `lures create near misses at level ${T.level} (${near}/${SEEDS})`);
  }

  // errata: the struck word is spellable too, so the page alone is ambiguous; the slip resolves it
  for (const T of TIERS) {
    let ambiguous = 0;
    for (let n = 0; n < 300; n++) {
      const seed = `pwe-${n}`;
      const R0 = PASSWORD.rules(stream(seed, 'rules', 'password'), T);
      const er = PASSWORD.errata(stream(seed, 'errata', 'password'), R0, T);
      assert(er && er.R.x && R0.words.includes(er.R.x) && !('x' in R0), `errata strikes a listed word (${seed})`);
      assert(JSON.stringify(er.R.words) === JSON.stringify(R0.words), 'errata keeps the printed list');
      const S = PASSWORD.gen(stream(seed, 'gen', 'password'), E, er.R, T);
      const both = spellable(S.c, R0.words);
      assert(both.length === 2 && both.includes(er.R.x), `exactly the struck word and one other are spellable (${seed}): ${both}`);
      const ans = PASSWORD.solve(S, E, er.R, T);
      assert(ans !== er.R.x && both.includes(ans), `solve() skips the struck word (${seed})`);
      const html = PASSWORD.page(R0, T);
      assert(fromPage(html, S.c, er.note) === ans, `solve-from-page with the slip equals solve() (${seed})`);
      if (fromPage(html, S.c) === null) ambiguous++;
    }
    assert(ambiguous === 300, `without the slip the page is ambiguous (${ambiguous}/300, level ${T.level})`);
  }

  // mount: a fake DOM-free check of the contract surface only (the browser tests cover the UI)
  assert(typeof PASSWORD.mount === 'function' && typeof PASSWORD.drive === 'function', 'mount and drive exist');
}
