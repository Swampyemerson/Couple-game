// FROZEN copy of the Double Agents v1 rules (the pure logic as shipped before the v2 update).
// Do not edit: words-agents.test.js replays random legacy logs through this and the live rules and
// requires identical results. The word list and the shuffler are injected (they are the live ones).
export function makeV1(shuffled, NOUNS) {
const TOKENS = 9;
const TOTAL = 15;
const LAYOUT = [
  'GG', 'GG', 'GG', 'GK', 'KG', 'KK',
  'GN', 'GN', 'GN', 'GN', 'GN', 'NG', 'NG', 'NG', 'NG', 'NG',
  'KN', 'NK', 'NN', 'NN', 'NN', 'NN', 'NN', 'NN', 'NN',
];
const other = (w) => (w === 'a' ? 'b' : 'a');
const up = (w) => String(w || '').toUpperCase();
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Both secret keys for a seed: { a: 'GKN…', b: '…' } (25 letters each). */
function makeKeys(seed) {
  const pairs = shuffled(LAYOUT, `${seed}:keys`);
  return { a: pairs.map((p) => p[0]).join(''), b: pairs.map((p) => p[1]).join('') };
}
/** 25 distinct board words for a seed; no word contains another (keeps the clue rule fair). */
function pickWords(seed) {
  const out = [];
  for (const w of shuffled(NOUNS, `${seed}:words`)) {
    if (out.length === 25) break;
    if (out.some((o) => o.includes(w) || w.includes(o))) continue;
    out.push(w);
  }
  return out;
}

const foundCount = (s) => s.found.filter(Boolean).length;
const agentsLeft = (s, w) => { let n = 0; for (let i = 0; i < 25; i++) if (s.key[w][i] === 'G' && !s.found[i]) n++; return n; };
const curTurn = (s) => s.log[s.log.length - 1] || null;

// A board word's plurals that don't simply contain it: cherry/cherries, wolf/wolves, knife/knives.
const IRREGULAR = { mouse: ['mice'], goose: ['geese'], dice: ['die'] };
function pluralsOf(w) {
  const f = [...(IRREGULAR[w] || [])];
  if (/[^aeiou]y$/.test(w)) f.push(w.slice(0, -1) + 'ies');
  if (w.endsWith('f')) f.push(w.slice(0, -1) + 'ves');
  if (w.endsWith('fe')) f.push(w.slice(0, -2) + 'ves');
  return f;
}
function cleanClue(s, x) {
  if (typeof x !== 'string' || !x.trim()) throw new Error('Type a one-word clue.');
  // "Café" counts as "cafe"; case never matters.
  const c = x.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/\s/.test(c)) throw new Error('One word only, no spaces.');
  if (!/^[a-z]+$/.test(c)) throw new Error('Just letters: one plain word.');
  if (c.length < 2) throw new Error('That clue is too short.');
  if (c.length > 20) throw new Error('That clue is too long.');
  s.words.forEach((w, i) => {
    if (s.found[i]) return; // covered cards are off the table
    if (w === c) throw new Error(`${up(w)} is on the board. Try another word.`);
    if (w.includes(c) || c.includes(w) || pluralsOf(w).includes(c)) throw new Error(`Too close to ${up(w)} on the board. Try another word.`);
  });
  return c;
}

function endTurn(s) {
  s.phase = 'clue';
  if (s.turns >= TOKENS) { s.over = 'time'; return; }
  const nx = other(s.giver);
  if (agentsLeft(s, nx) > 0) s.giver = nx; // someone with nothing left to find keeps guessing
}

// ── rules (pure, deterministic) ──
function init({ first, seed }) {
  return {
    words: pickWords(seed),
    key: makeKeys(seed),
    giver: first === 'b' ? 'b' : 'a',
    phase: 'clue',
    turns: 0,
    found: Array(25).fill(null), // who found each agent
    miss: { a: [], b: [] }, // cards known to be bystanders on that player's key
    hit: null, // the assassin that ended it
    log: [], // { by, clue, n, picks: [{ i, r }] }
    over: null, // 'win' | 'burned' | 'time'
  };
}
function next(s) {
  if (s.over) return [];
  return s.phase === 'clue' ? [s.giver] : [other(s.giver)];
}
function apply(s, who, mv) {
  if (s.over) throw new Error('The mission is over.');
  if (!mv || typeof mv !== 'object') throw new Error('That move didn’t make sense.');
  if (s.phase === 'clue') {
    if (who !== s.giver) throw new Error('Wait for the clue.');
    if (mv.pick !== undefined || mv.stop) throw new Error('Wait for a clue first.');
    const clue = cleanClue(s, mv.clue);
    const n = Number(mv.n);
    if (!Number.isInteger(n) || n < 1 || n > 9) throw new Error('Pick a number from 1 to 9.');
    s.turns += 1;
    s.phase = 'guess';
    s.log.push({ by: who, clue, n, picks: [] });
    return s;
  }
  if (who === s.giver) throw new Error('Your partner is guessing.');
  if (mv.clue !== undefined) throw new Error('It’s time to guess, not to give a clue.');
  const turn = curTurn(s);
  if (mv.stop) {
    if (!turn.picks.length) throw new Error('Pick at least one card before you end the turn.');
    endTurn(s);
    return s;
  }
  const i = mv.pick;
  if (!Number.isInteger(i) || i < 0 || i > 24) throw new Error('Pick a card on the board.');
  if (s.found[i]) throw new Error(`${up(s.words[i])} is already found.`);
  if (s.miss[s.giver].includes(i)) throw new Error(`${up(s.words[i])} is already marked as a bystander on this key.`);
  const r = s.key[s.giver][i];
  turn.picks.push({ i, r });
  if (r === 'K') { s.hit = i; s.over = 'burned'; return s; }
  if (r === 'N') { s.miss[s.giver].push(i); endTurn(s); return s; }
  s.found[i] = who;
  if (foundCount(s) >= TOTAL) { s.over = 'win'; return s; }
  if (agentsLeft(s, s.giver) === 0) endTurn(s); // nothing more to find on this key
  return s;
}
function result(s) {
  const n = foundCount(s);
  const base = { winner: null, team: true, score: n };
  if (s.over === 'win') {
    const spare = TOKENS - s.turns;
    return { ...base, text: 'Mission complete', sub: `All ${TOTAL} agents found${spare ? ` with ${spare} turn${spare === 1 ? '' : 's'} to spare` : ' on the very last turn'}.` };
  }
  if (s.over === 'burned') return { ...base, text: 'Burned', sub: `${up(s.words[s.hit])} was an assassin. ${n} of ${TOTAL} agents found.` };
  return { ...base, text: 'Out of time', sub: `The trail went cold at ${n} of ${TOTAL} agents.` };
}
return { init, next, apply, result, cleanClue, pickWords, makeKeys };
}
