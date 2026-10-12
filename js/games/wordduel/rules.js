// Word Duel rules: pure and deterministic (they run on both phones from the move logs).
//
// Two rule sets share one state shape:
//   v1 (legacy)  no setup move. Exactly the original rules: a match with no `setup` move replays to
//                the same states and results forever (tools/test/games/fixtures/wordduel-v1.mjs
//                is the frozen proof).
//   v2           the first move of the match is { setup: { v: 2, pool, hard, dealt, bo3 } }.
//
// Moves:  { setup: { v: 2, pool: 'fair'|'love'|'any', hard: bool, dealt: bool, bo3: bool } }
//                               only while pristine (no setup, no secret yet); first one wins
//         { secret: 'crane' }   both at once, a word from the pool
//         { guess: 'slate' }    both at once and independent: up to 6 valid guesses each
import { randInt } from '../core.js';
import { ANSWERS, MORE } from './lists.js';

export const MAX = 6;
export const other = (w) => (w === 'a' ? 'b' : 'a');
export const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : '');

// The Love Letters pool: a hand-picked, soft set, filtered at load to words that are in ANSWERS.
const LOVE_CANDIDATES = 'heart adore sweet lover bride groom charm flirt crush dance dream smile blush tulip daisy bloom honey sugar candy spice toast grace trust faith truth loyal comfy quilt linen couch porch cabin beach ocean shore shell night spark flame ember fudge cocoa latte mocha pizza pasta feast merry happy jolly giddy laugh tease cling touch pulse jewel pearl satin aisle altar tango waltz swing music lyric verse hotel suite movie union unite yearn swoon bliss shine lilac poppy treat angel truly bunny teddy plush kitty puppy fancy crave sworn lucky'.split(' ');

let COMMON = null;
let COMMON_SET = null;
let VALID = null;
let LOVE = null;
let LOVE_SET = null;
export function lists() {
  if (!VALID) {
    const split = (s) => { const out = []; for (let i = 0; i + 5 <= s.length; i += 5) out.push(s.slice(i, i + 5)); return out; };
    COMMON = split(ANSWERS);
    COMMON_SET = new Set(COMMON);
    VALID = new Set(COMMON);
    for (const w of split(MORE)) VALID.add(w);
    LOVE = [...new Set(LOVE_CANDIDATES)].filter((w) => COMMON_SET.has(w));
    LOVE_SET = new Set(LOVE);
  }
  return { common: COMMON, valid: VALID, love: LOVE, commonSet: COMMON_SET, loveSet: LOVE_SET };
}

/** Wordle feedback for one guess: 'g' right spot, 'y' in the word elsewhere, 'x' not in it.
 *  Repeated letters: exact matches claim their letters first, then each remaining copy in the
 *  secret can light up at most one more guessed letter, left to right. */
export function scoreGuess(secret, guess) {
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

export function checkWord(w) {
  if (!w) throw new Error('Type a five-letter word.');
  if (!/^[a-z]+$/.test(w)) throw new Error('Letters only, please.');
  if (w.length !== 5) throw new Error('Five letters, please.');
  if (!lists().valid.has(w)) throw new Error(`${w.toUpperCase()} isn’t in the word list.`);
}

export const target = (s, w) => s.secret[other(w)];
export const solvedBy = (s, w) => !!target(s, w) && s.guesses[w].includes(target(s, w));
export const doneBy = (s, w) => solvedBy(s, w) || s.guesses[w].length >= MAX;
export const tally = (s, w) => (solvedBy(s, w) ? s.guesses[w].length : MAX + 1);

// ── v2 helpers ──
export const POOLS = ['fair', 'love', 'any'];
const SETUP_KEYS = ['v', 'pool', 'hard', 'dealt', 'bo3'];
export const DEFAULT_SETUP = { v: 2, pool: 'fair', hard: false, dealt: false, bo3: false };
const BAD_SETUP = 'Those rules didn’t make sense.';

/** Validate a setup payload (throws) and return the normalised options. */
export function parseSetup(st) {
  if (!st || typeof st !== 'object' || Array.isArray(st)) throw new Error(BAD_SETUP);
  for (const k of Object.keys(st)) if (!SETUP_KEYS.includes(k)) throw new Error(BAD_SETUP);
  if (st.v !== 2) throw new Error(BAD_SETUP);
  const pool = st.pool === undefined ? 'fair' : st.pool;
  if (!POOLS.includes(pool)) throw new Error(BAD_SETUP);
  const o = { pool };
  for (const k of ['hard', 'dealt', 'bo3']) {
    if (st[k] !== undefined && typeof st[k] !== 'boolean') throw new Error(BAD_SETUP);
    o[k] = !!st[k];
  }
  return o;
}

function dealOpener(s, round) {
  const { common } = lists();
  const used = new Set((s.rounds || []).map((r) => r.opener).filter(Boolean));
  for (let k = 0; k < 50; k++) {
    const w = common[randInt(common.length, s.seed ?? 0, 'opener', round, k)];
    if (!used.has(w)) return w;
  }
  return common[0];
}

function applySetup(s, st) {
  if (s.v) throw new Error('The rules are already set.');
  if (s.secret.a || s.secret.b) throw new Error('The rules are locked once a word is picked.');
  const o = parseSetup(st);
  s.v = 2;
  s.opts = o;
  if (o.bo3) { s.round = 1; s.wins = { a: 0, b: 0 }; s.rounds = []; }
  if (o.dealt) s.opener = dealOpener(s, 1);
  // A v2 secret that got ahead of the rules in replay order (seat a's moves are replayed first)
  // was parked: place it now, if it fits the rules.
  const parked = s.pend;
  delete s.pend;
  if (parked) for (const w of ['a', 'b']) if (parked[w]) { try { checkSecretV2(s, parked[w]); placeSecret(s, w, parked[w]); } catch { /* picks again */ } }
  return s;
}

function checkSecretV2(s, w) {
  const { commonSet, loveSet } = lists();
  const W = w.toUpperCase();
  if (s.opts.pool === 'fair' && !commonSet.has(w)) throw new Error(`${W} is too obscure for a secret here. Pick an everyday word.`);
  if (s.opts.pool === 'love' && !loveSet.has(w)) throw new Error(`${W} isn’t on the love list. Tap a suggestion or press Surprise me.`);
  if (s.opts.dealt && s.opener === w) throw new Error(`${W} is the dealt opener. Pick a different word.`);
  for (const r of s.rounds || []) if (r.secret.a === w || r.secret.b === w) throw new Error(`${W} was already used this set.`);
}

/** Hard mode (the Wordle rule): revealed greens stay put, revealed yellows get reused. */
export function hardCheck(secret, prior, g) {
  for (const p of prior) {
    const m = scoreGuess(secret, p);
    for (let i = 0; i < 5; i++) if (m[i] === 'g' && g[i] !== p[i]) throw new Error(`Hard mode: keep ${p[i].toUpperCase()} in spot ${i + 1}.`);
    const need = {};
    for (let i = 0; i < 5; i++) if (m[i] !== 'x') need[p[i]] = (need[p[i]] || 0) + 1;
    for (const c of Object.keys(need)) {
      let have = 0;
      for (let i = 0; i < 5; i++) if (g[i] === c) have++;
      if (have < need[c]) throw new Error(`Hard mode: use the ${c.toUpperCase()}.`);
    }
  }
}

/** Greens and yellows on a player's rows before their solving row (all rows on a miss). */
export function heatOf(secret, guesses) {
  const at = guesses.indexOf(secret);
  const rows = at >= 0 ? guesses.slice(0, at) : guesses;
  let g = 0;
  let y = 0;
  for (const r of rows) for (const m of scoreGuess(secret, r)) { if (m === 'g') g++; else if (m === 'y') y++; }
  return { g, y };
}

/** Heat so far for the player `w` cracking the other's word, on the current round. */
export function heatNow(s, w) {
  const t = target(s, w);
  return t ? heatOf(t, s.guesses[w]) : { g: 0, y: 0 };
}

/** One finished round: who won it and how. `sec` = { a, b } secrets, `gs` = { a, b } guesses. */
export function duel(sec, gs) {
  const t = (w) => (sec[other(w)] && gs[w].includes(sec[other(w)]) ? gs[w].length : MAX + 1);
  const na = t('a');
  const nb = t('b');
  const ha = heatOf(sec.b, gs.a);
  const hb = heatOf(sec.a, gs.b);
  let w = null;
  let by = null;
  if (na !== nb) { w = na < nb ? 'a' : 'b'; by = 'guesses'; }
  else if (ha.g !== hb.g) { w = ha.g > hb.g ? 'a' : 'b'; by = 'greens'; }
  else if (ha.y !== hb.y) { w = ha.y > hb.y ? 'a' : 'b'; by = 'yellows'; }
  return { w, by, na, nb, ha, hb };
}

const gs = (n) => `${n} ${n === 1 ? 'guess' : 'guesses'}`;
const FOUR = ['', 'One', 'Two', 'Three', 'Four', 'Five'];

function lastRowGreens(sec, guesses, w) {
  const last = guesses[w][guesses[w].length - 1];
  return last ? [...scoreGuess(sec[other(w)], last)].filter((m) => m === 'g').length : 0;
}

/** The text of one round's result (also used for the round recap in best-of-3). */
export function roundResult(sec, g) {
  const d = duel(sec, g);
  const { na, nb } = d;
  if (d.w === null) {
    return na > MAX
      ? { winner: null, text: 'Both words held out', sub: 'Neither of you cracked it, and the heat matched.', d }
      : { winner: null, text: 'Dead heat', sub: `You both cracked it in ${gs(na)}, and the heat matched too.`, d };
  }
  const hw = d.w === 'a' ? d.ha : d.hb;
  const hl = d.w === 'a' ? d.hb : d.ha;
  if (d.by === 'greens') {
    return { winner: d.w, d, sub: na > MAX
      ? `Both words held out, but one of you got closer: ${hw.g} greens to ${hl.g}.`
      : `You both cracked it in ${gs(na)}. More greens on the way in breaks the tie: ${hw.g} to ${hl.g}.` };
  }
  if (d.by === 'yellows') {
    return { winner: d.w, d, sub: na > MAX
      ? `Both words held out, same greens (${hw.g}), but more yellows: ${hw.y} to ${hl.y}.`
      : `You both cracked it in ${gs(na)}. Same greens (${hw.g}), more yellows: ${hw.y} to ${hl.y}.` };
  }
  const n = Math.min(na, nb);
  const m = Math.max(na, nb);
  let sub = m > MAX ? `Cracked it in ${gs(n)}. The other word held out.` : `Cracked it in ${gs(n)}, against ${m}.`;
  if (m > MAX) {
    const loser = d.w === 'a' ? 'b' : 'a';
    const lg = lastRowGreens(sec, g, loser);
    if (lg >= 3 && lg <= 4) sub += ` ${FOUR[lg]} greens on the last row. Brutal.`;
  } else if (m - n === 1) sub += ' One guess. That’s all it was.';
  return { winner: d.w, sub, d };
}

function roundDone(s) { return doneBy(s, 'a') && doneBy(s, 'b'); }

/** Best of 3: archive a finished round, then either end the set or open the next round.
 *  First to 2 round wins. After round 3 the leader takes the set; if it's still level a 4th
 *  and last round decides it, and if even that is level the set is a draw. */
function endRound(s) {
  const r = roundResult(s.secret, s.guesses);
  const w = r.winner;
  s.rounds.push({ secret: { ...s.secret }, guesses: { a: s.guesses.a.slice(), b: s.guesses.b.slice() }, opener: s.opener || null, w });
  if (w) s.wins[w]++;
  const n = s.rounds.length;
  const { a, b } = s.wins;
  const fin = a >= 2 || b >= 2 || (n >= 3 && a !== b) || n >= 4;
  if (fin) { s.fin = true; return; }
  s.round = n + 1;
  s.secret = { a: null, b: null };
  s.guesses = { a: [], b: [] };
  if (s.opts.dealt) s.opener = dealOpener(s, s.round);
}

// ── rules ──
function placeSecret(s, who, w) {
  s.secret[who] = w;
  if (s.v === 2 && s.opts.dealt && s.secret.a && s.secret.b) { s.guesses.a = [s.opener]; s.guesses.b = [s.opener]; }
}

export function init() {
  return { secret: { a: null, b: null }, guesses: { a: [], b: [] } };
}
export function next(s) {
  if (s.fin) return [];
  if (!s.secret.a || !s.secret.b) return ['a', 'b'].filter((w) => !s.secret[w]);
  return ['a', 'b'].filter((w) => !doneBy(s, w));
}
export function apply(s, who, mv) {
  if (!mv || typeof mv !== 'object') throw new Error('That move didn’t make sense.');
  if (mv.setup !== undefined) return applySetup(s, mv.setup);
  if (!s.secret[who]) {
    if (mv.secret === undefined) throw new Error('Pick your secret word first.');
    const w = norm(mv.secret);
    checkWord(w);
    if (s.v === 2) checkSecretV2(s, w);
    else if (mv.v === 2 && !s.secret.a && !s.secret.b) {
      // { secret, v: 2 } is only ever sent by a phone that has seen the rules. If replay order puts
      // it before the rules move, park it until they arrive.
      s.pend = { ...(s.pend || {}), [who]: w };
      return s;
    }
    placeSecret(s, who, w);
    return s;
  }
  if (mv.guess === undefined) throw new Error('You’ve already picked your word.');
  if (!target(s, who)) throw new Error('Wait for your partner to pick their word.');
  if (doneBy(s, who)) throw new Error('You’re out of guesses.');
  const g = norm(mv.guess);
  checkWord(g);
  if (s.guesses[who].includes(g)) throw new Error(`You already tried ${g.toUpperCase()}.`);
  if (s.v === 2 && s.opts.hard) hardCheck(target(s, who), s.guesses[who], g);
  s.guesses[who].push(g);
  if (s.v === 2 && s.opts.bo3 && roundDone(s)) endRound(s);
  return s;
}

function resultV1(s) {
  const na = tally(s, 'a');
  const nb = tally(s, 'b');
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

export function result(s) {
  if (!s.v) return resultV1(s);
  if (!s.opts.bo3) { const r = roundResult(s.secret, s.guesses); delete r.d; return r; }
  const { a, b } = s.wins;
  const n = s.rounds.length;
  const sc = `${Math.max(a, b)} to ${Math.min(a, b)}`;
  if (a === b) return { winner: null, text: 'Set drawn', sub: `${a} round${a === 1 ? '' : 's'} each after ${n} rounds. Nobody blinked.` };
  const w = a > b ? 'a' : 'b';
  return { winner: w, sub: `Takes the set, ${sc}, over ${n} round${n === 1 ? '' : 's'}.` };
}

/** Player-chip scores: round wins in a best-of-3 (nothing otherwise). */
export function score(s) {
  return s.v === 2 && s.opts.bo3 ? { a: s.wins.a, b: s.wins.b } : null;
}

/** The secrets/guesses of round index `i` (0-based): archived, or the live one. */
export function roundView(s, i) {
  const r = (s.rounds || [])[i];
  if (r) return { secret: r.secret, guesses: r.guesses, opener: r.opener, w: r.w };
  return { secret: s.secret, guesses: s.guesses, opener: s.opener || null, w: undefined };
}

/** The setup options a state is playing by (null = legacy v1). */
export const optsOf = (s) => (s.v === 2 ? s.opts : null);
