// FROZEN copy of the Word Duel v1 rules (the pure logic as shipped before the v2 update).
// Do not edit: words-duel.test.js replays random legacy logs through this and the live rules and
// requires identical results. The word lists are injected (they are the live ones).
export function makeV1(VALID, COMMON) {
const MAX = 6;
const other = (w) => (w === 'a' ? 'b' : 'a');
const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '');
const lists = () => ({ common: COMMON, valid: VALID });
/** Wordle feedback for one guess: 'g' right spot, 'y' in the word elsewhere, 'x' not in it.
 *  Repeated letters: exact matches claim their letters first, then each remaining copy in the
 *  secret can light up at most one more guessed letter, left to right. */
function scoreGuess(secret, guess) {
  const out = ['x', 'x', 'x', 'x', 'x'];
  const left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === secret[i]) out[i] = 'g';
    else left[secret[i]] = (left[secret[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (out[i] === 'g') continue;
    const c = guess[i];
    if (left[c] > 0) { out[i] = 'y'; left[c]--; }
  }
  return out.join('');
}

function checkWord(w) {
  if (!w) throw new Error('Type a five-letter word.');
  if (!/^[a-z]+$/.test(w)) throw new Error('Letters only, please.');
  if (w.length !== 5) throw new Error('Five letters, please.');
  if (!lists().valid.has(w)) throw new Error(`${w.toUpperCase()} isn’t in the word list.`);
}

const target = (s, w) => s.secret[other(w)];
const solvedBy = (s, w) => !!target(s, w) && s.guesses[w].includes(target(s, w));
const doneBy = (s, w) => solvedBy(s, w) || s.guesses[w].length >= MAX;
const tally = (s, w) => (solvedBy(s, w) ? s.guesses[w].length : MAX + 1);

// ── rules (pure, deterministic) ──
function init() {
  return { secret: { a: null, b: null }, guesses: { a: [], b: [] } };
}
function next(s) {
  if (!s.secret.a || !s.secret.b) return ['a', 'b'].filter((w) => !s.secret[w]);
  return ['a', 'b'].filter((w) => !doneBy(s, w));
}
function apply(s, who, mv) {
  if (!mv || typeof mv !== 'object') throw new Error('That move didn’t make sense.');
  if (!s.secret[who]) {
    if (mv.secret === undefined) throw new Error('Pick your secret word first.');
    const w = norm(mv.secret);
    checkWord(w);
    s.secret[who] = w;
    return s;
  }
  if (mv.guess === undefined) throw new Error('You’ve already picked your word.');
  if (!target(s, who)) throw new Error('Wait for your partner to pick their word.');
  if (doneBy(s, who)) throw new Error('You’re out of guesses.');
  const g = norm(mv.guess);
  checkWord(g);
  if (s.guesses[who].includes(g)) throw new Error(`You already tried ${g.toUpperCase()}.`);
  s.guesses[who].push(g);
  return s;
}
function result(s) {
  const na = tally(s, 'a');
  const nb = tally(s, 'b');
  const gs = (n) => `${n} ${n === 1 ? 'guess' : 'guesses'}`;
  if (na === nb) {
    return na > MAX
      ? { winner: null, text: 'Both words held out', sub: 'Neither of you cracked it this time.' }
      : { winner: null, text: 'Dead heat', sub: `You both cracked it in ${gs(na)}.` };
  }
  const w = na < nb ? 'a' : 'b';
  const n = Math.min(na, nb);
  const m = Math.max(na, nb);
  return { winner: w, sub: m > MAX ? `Cracked it in ${gs(n)}. The other word held out.` : `Cracked it in ${gs(n)}, against ${m}.` };
}
return { init, next, apply, result, scoreGuess, MAX };
}
