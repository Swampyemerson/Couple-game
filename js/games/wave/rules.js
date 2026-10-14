// Same Wave v2 rules (pure and deterministic). A v2 match starts with a setup move by `first`:
//   { setup: { v: 2, mode, pack, deal? } }
// which sets s.v = 2 and rebuilds the rounds from the seed, the mode and the pack. Matches that never get
// a setup move are v1 and run entirely on the code in ../wave.js, untouched.
import { shuffled, randInt, rand } from '../core.js';
import { BASE_CARDS, NEW_CARDS, RANGES, COZY_OUT } from './cards.js';

export const ROUNDS_V2 = 8;
export const DEAL_LEN = 7; // cards for rounds 1..7; the last round replays round 1's card (Déjà vu)
export const MAX_CLUE = 40;

export const MODES = [
  { id: 'classic', name: 'Classic', pitch: 'Eight rounds. Bullseye 4, close 3, near 2.', rule: '' },
  { id: 'bet', name: 'Giver’s Bet', pitch: 'The giver bets how close you’ll land. Right call: +1.', rule: 'Giver’s Bet: the giver bets on how close the dial lands. A right bet earns +1.' },
  { id: 'sure', name: 'Double Down', pitch: 'Feeling sure? Within 10 pays 6. Miss and it pays 0.', rule: 'Double Down: tick Sure to win 6 for landing within 10. Miss and it pays 0.' },
  { id: 'oneword', name: 'One Word', pitch: 'Clues are one word. Any score earns +1.', rule: 'One word only. Any score earns +1.' },
  { id: 'mixed', name: 'Mixed Bag', pitch: 'A new twist every round. Never the same game twice.', rule: '' },
];
export const MODE_IDS = MODES.map((m) => m.id);

export const PACKS = [
  { id: 'classic', name: 'Classic', pitch: 'The original cards' },
  { id: 'justus', name: 'Just Us', pitch: 'Cards about the two of you' },
  { id: 'everyday', name: 'Everyday', pitch: 'Queues, coffee and Mondays' },
  { id: 'hottakes', name: 'Hot Takes', pitch: 'Opinions to argue over' },
  { id: 'future', name: 'Future Us', pitch: 'Dreams and plans' },
  { id: 'senses', name: 'Senses', pitch: 'Sounds, smells, textures, vibes' },
  { id: 'everything', name: 'Everything', pitch: 'Every card in the box' },
  { id: 'cozy', name: 'Cozy', pitch: 'Everything, minus the spicy cards' },
];
export const PACK_IDS = PACKS.map((p) => p.id);

// The twists a round can carry (Mixed Bag deals one to each round).
export const TWISTS = ['normal', 'bet', 'sure', 'oneword', 'edge'];
export const TWIST_INFO = {
  normal: { name: 'Plain round', rule: '' },
  bet: { name: 'Giver’s Bet', rule: 'The giver bets on how close the dial lands. A right bet earns +1.' },
  sure: { name: 'Double Down', rule: 'Tick Sure: within 10 wins 6, otherwise 0.' },
  oneword: { name: 'One Word', rule: 'The clue is one single word. Any score earns +1.' },
  edge: { name: 'Edge round', rule: 'The target hides near one end. Landing within 4 earns +1.' },
};
export const BETS = {
  bull: { name: 'Bullseye', def: 'within 4', test: (d) => d <= 4 },
  close: { name: 'Close', def: 'within 10', test: (d) => d <= 10 },
  off: { name: 'Way off', def: 'more than 17', test: (d) => d > 17 },
};

const other = (w) => (w === 'a' ? 'b' : 'a');
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
export const totalCards = () => BASE_CARDS + NEW_CARDS.length;
export const isEdge = (t) => t <= 8 || t >= 92;
export const pointsFor = (d) => (d <= 4 ? 4 : d <= 10 ? 3 : d <= 17 ? 2 : 0);

/** The global card indices a pack deals from, or null for an unknown pack. */
export function poolFor(pack) {
  if (pack === 'classic') return range(0, BASE_CARDS);
  if (RANGES[pack]) return range(RANGES[pack][0], RANGES[pack][1]);
  if (pack === 'everything') return range(0, totalCards());
  if (pack === 'cozy') return range(0, totalCards()).filter((i) => !COZY_OUT.includes(i));
  return null;
}

/** Throws when a requested deal is not seven distinct cards of the pack. */
export function checkDeal(deal, pack) {
  const pool = poolFor(pack);
  if (!Array.isArray(deal) || deal.length !== DEAL_LEN) throw new Error(`A deal is ${DEAL_LEN} cards.`);
  const set = new Set(pool);
  if (!deal.every((x) => Number.isInteger(x) && set.has(x))) throw new Error('That deal has cards from another pack.');
  if (new Set(deal).size !== DEAL_LEN) throw new Error('A deal has no repeats.');
}

// Everything a round needs, from the seed alone. Same inputs, same match, on both phones.
function buildRounds(s, mode, pack, deal) {
  const { seed, first } = s;
  const dl = deal || shuffled(poolFor(pack), `${seed}:wave2:${pack}`).slice(0, DEAL_LEN);
  const cards = [...dl, dl[0]];
  const tw = [];
  if (mode === 'mixed') {
    const extra = [0, 1, 2].map((i) => TWISTS[randInt(TWISTS.length, seed, 'wave2-tw', i)]);
    shuffled([...TWISTS, ...extra], `${seed}:wave2:tw`).forEach((x, r) => { tw[r] = x; });
  } else for (let r = 0; r < ROUNDS_V2; r++) tw[r] = mode === 'classic' ? 'normal' : mode;
  // targets: the whole dial, 0 to 100
  const T = [];
  for (let r = 0; r < ROUNDS_V2; r++) T[r] = randInt(101, seed, 'wave2-target', r);
  const edgeAt = (r, v) => { const side = rand(seed, 'wave2-edge-side', r) < 0.5; const k = randInt(9, seed, 'wave2-edge-k', r); T[r] = v == null ? (side ? k : 100 - k) : v; };
  for (let r = 0; r < ROUNDS_V2 - 1; r++) if (tw[r] === 'edge') edgeAt(r);
  // Déjà vu: the last round replays round 1's card, but never with a target near the old one
  const far = (v) => Math.abs(v - T[0]) >= 20;
  const L = ROUNDS_V2 - 1;
  if (tw[L] === 'edge') { const c = [...range(0, 9), ...range(92, 101)].filter(far); T[L] = c[randInt(c.length, seed, 'wave2-dv')]; } else if (!far(T[L])) { const c = range(0, 101).filter(far); T[L] = c[randInt(c.length, seed, 'wave2-dv')]; }
  // every match has at least one edge round (a target at 0..8 or 92..100)
  if (!T.some(isEdge)) edgeAt(1 + randInt(L - 1, seed, 'wave2-edge'));
  const jp = rand(seed, 'wave2-jp') < 1 / 3 ? 1 + randInt(ROUNDS_V2 - 1, seed, 'wave2-jpr') : -1;
  const rounds = [];
  for (let r = 0; r < ROUNDS_V2; r++) {
    rounds.push({ giver: r % 2 ? other(first) : first, card: cards[r], target: T[r], clue: null, at: null, points: null, tw: tw[r], edge: isEdge(T[r]), jp: r === jp, dv: r === L, bet: null, sure: false, base: null, bn: [] });
  }
  return rounds;
}

/** The setup move. Mutates and returns s. */
export function setupV2(s, who, su) {
  if (s.v) throw new Error('The game is already set up.');
  if (s.r !== 0 || s.phase !== 'clue' || s.rounds[0].clue != null) throw new Error('Setup comes before the first clue.');
  if (who !== s.first) throw new Error('Only the first player sets the game up.');
  if (!su || typeof su !== 'object' || su.v !== 2) throw new Error('That setup makes no sense.');
  if (!MODE_IDS.includes(su.mode)) throw new Error('Unknown game mode.');
  if (!PACK_IDS.includes(su.pack)) throw new Error('Unknown card pack.');
  if (su.deal !== undefined) checkDeal(su.deal, su.pack);
  s.v = 2;
  s.mode = su.mode;
  s.pack = su.pack;
  s.rounds = buildRounds(s, su.mode, su.pack, su.deal);
  return s;
}

/** Points for a guess in a v2 round: { base, bn: bonus tags, bet: 'won' | 'lost' | null, points }. */
export function scoreRound(Rd, at, sure) {
  const d = Math.abs(at - Rd.target);
  const base = Rd.tw === 'sure' && sure ? (d <= 10 ? 6 : 0) : pointsFor(d);
  const bn = [];
  if (Rd.tw === 'oneword' && base > 0) bn.push('ow');
  if (Rd.edge && d <= 4) bn.push('edge');
  let bet = null;
  if (Rd.bet) { bet = BETS[Rd.bet].test(d) ? 'won' : 'lost'; if (bet === 'won') bn.push('bet'); }
  return { base, bn, bet, points: (base + bn.length) * (Rd.jp ? 2 : 1) };
}

/** The most a round could pay. */
export const roundMax = (Rd) => ((Rd.tw === 'sure' ? 6 : 4) + (Rd.tw === 'oneword' ? 1 : 0) + (Rd.edge ? 1 : 0) + (Rd.tw === 'bet' ? 1 : 0)) * (Rd.jp ? 2 : 1);
export const maxOf = (s) => s.rounds.reduce((n, Rd) => n + roundMax(Rd), 0);

/** A move in a v2 match. Mutates and returns s. */
export function applyV2(s, who, mv) {
  const n = s.rounds.length;
  if (s.r >= n) throw new Error('The game is over.');
  if (!mv || typeof mv !== 'object') throw new Error('That move makes no sense.');
  if (mv.setup !== undefined) throw new Error('The game is already set up.');
  const Rd = s.rounds[s.r];
  if (s.phase === 'clue') {
    if (who !== Rd.giver) throw new Error(mv.at != null ? 'Wait for the clue first.' : 'It’s not your turn to give the clue.');
    if (mv.clue != null && typeof mv.clue !== 'string') throw new Error('Write a clue first.');
    const clue = String(mv.clue || '').trim().replace(/\s+/g, ' ');
    if (!clue) throw new Error('Write a clue first.');
    if (clue.length > MAX_CLUE) throw new Error(`Keep your clue to ${MAX_CLUE} characters.`);
    if (/^[\d\s.,%/-]+$/.test(clue)) throw new Error('No numbers on their own. That’s cheating!');
    if (Rd.tw === 'oneword' && clue.includes(' ')) throw new Error('One word only this round. No spaces!');
    if (mv.bet !== undefined && mv.bet !== null) {
      if (Rd.tw !== 'bet') throw new Error('No bets this round.');
      if (typeof mv.bet !== 'string' || !Object.prototype.hasOwnProperty.call(BETS, mv.bet)) throw new Error('Bet Bullseye, Close or Way off.');
      Rd.bet = mv.bet;
    }
    Rd.clue = clue;
    s.phase = 'guess';
    return s;
  }
  if (who === Rd.giver) throw new Error('You gave the clue. Your partner turns the dial.');
  const at = mv.at;
  if (typeof at !== 'number' || !Number.isFinite(at)) throw new Error('Turn the dial to pick a spot.');
  if (!Number.isInteger(at) || at < 0 || at > 100) throw new Error('The dial only goes from 0 to 100.');
  if (mv.sure !== undefined && mv.sure !== true && mv.sure !== false) throw new Error('Sure is on or off.');
  if (mv.sure === true && Rd.tw !== 'sure') throw new Error('Double Down isn’t on this round.');
  const sc = scoreRound(Rd, at, mv.sure === true);
  Rd.at = at;
  Rd.sure = mv.sure === true;
  Rd.base = sc.base;
  Rd.bn = sc.bn;
  Rd.points = sc.points;
  s.score += sc.points;
  s.r++;
  s.phase = 'clue';
  return s;
}

const RATINGS = [[30 / 32, 'Telepathic'], [25 / 32, 'Same wavelength'], [19 / 32, 'Pretty much in sync'], [12 / 32, 'Crossed signals'], [6 / 32, 'Different radio stations'], [0, 'Static on the line']];
export const ratingFor = (frac) => RATINGS.find(([m]) => frac >= m)[1];

export function resultV2(s) {
  const mx = maxOf(s);
  const bulls = s.rounds.filter((x) => x.at != null && Math.abs(x.at - x.target) <= 4).length;
  return { winner: null, team: true, score: s.score, max: mx, text: ratingFor(mx ? s.score / mx : 0), sub: `${s.score} of ${mx} points${bulls ? `, ${bulls} bullseye${bulls > 1 ? 's' : ''}` : ''}.` };
}
