// Ultimate Tic-Tac-Toe: nine small boards in a 3×3. The square you pick sends your partner to
// the matching small board; if that board is won or full they may play in any open board.
// Three in a row takes a small board; three small boards in a row takes the game. If no big
// line is possible for either player, most boards won wins (equal = draw).
// Touch: tap a square to aim, tap it again to place. Mouse: hover previews, click places.
// Keys: Tab into the grid, arrows move the cursor, Enter or Space places it.
//
// Versions. A match with no setup move is the original game, replayed exactly as it always was.
// New matches begin with { setup: 2, mode } (first mover only, before any mark, passes no turn):
//   classic  the balanced rules (the BALANCE section: ties on boards go to the second mover)
//   hot      two facing boards through the centre (seeded: 0&8, 1&7, 2&6 or 3&5) are hot, counting double
//   wild     each player holds one wildcard: { b, i, wild: 1 } ignores the send, once
// Other moves: { b, i } place a mark. { b, i, wild: 1 } is the Wildcards move.
// Balance (v2): komi. A count ending that is tied on boards goes to the player who moved second.
import { registerGame, gameDataApi, randInt } from './core.js';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const NAMES = ['top-left', 'top', 'top-right', 'left', 'middle', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const LINE_NAMES = ['top row', 'middle row', 'bottom row', 'left column', 'middle column', 'right column', 'top-left diagonal', 'top-right diagonal'];
const other = (w) => (w === 'a' ? 'b' : 'a');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function lineOf(arr) {
  for (const L of LINES) {
    const v = arr[L[0]];
    if ((v === 'a' || v === 'b') && arr[L[1]] === v && arr[L[2]] === v) return { who: v, line: L };
  }
  return null;
}
const canStillLine = (big, w) => LINES.some((L) => L.every((k) => big[k] === null || big[k] === w));
/** Boards won per player. Hot boards (Hot Boards mode) count double. Legacy states: one each. */
function boardsWon(s) {
  const out = { a: 0, b: 0 };
  s.big.forEach((x, b) => { if (x === 'a' || x === 'b') out[x] += s.mode === 'hot' ? HOT.weight(s, b) : 1; });
  return out;
}
// ── HOT BOARDS (v2 mode `hot`; the only two places to tune it) ──────────
// one opposite pair through the centre: bot self-play put the two-random-boards version at +11.8 pp for
// the first mover and this one at +1.0 pp (docs/games/ultimate.md)
const HOT_PAIRS = [[0, 8], [1, 7], [2, 6], [3, 5]];
const HOT = {
  /** Which small boards are hot, from the match seed: one opposite pair, stored in s.hot. */
  pick: (seed) => HOT_PAIRS[randInt(HOT_PAIRS.length, seed, 'hot')].slice(),
  /** What winning small board `b` counts as in the boards-won count (score, count ending, tie-break). */
  weight: (s, b) => (s.hot && s.hot.includes(b) ? 2 : 1),
};
/** ", hot boards counting double" in Hot Boards, else nothing (plain counts can differ from hot-weighted ones). */
const hotClause = (s) => (s.mode === 'hot' ? ', hot boards counting double' : '');
const marksOf = (s) => { let n = 0; for (const c of s.cells) if (c) n++; return n; };

// ── modes ──────────────────────────────────────────────────────────────
const MODES = {
  classic: { name: 'Classic', blurb: 'Ties on boards go to the second mover.' },
  hot: { name: 'Hot Boards', blurb: 'Two facing boards through the centre count double.' },
  wild: { name: 'Wildcards', blurb: 'One wildcard each: ignore the send, once.' },
};

// ── BALANCE (v2 only) ──────────────────────────────────────────────────
// The first mover has a real edge in Ultimate (bot self-play: see docs/games/ultimate.md), so v2
// games use komi: when the game ends on the count (no big line left for anyone) and boards won
// are tied (hot boards weighed double in Hot Boards), the player who did NOT move first wins.
// There are no draws in v2. s.first (set by the setup move) is the first mover. Legacy games keep
// the old count rules, draws included. Flip BALANCE.komi to switch it off.
const BALANCE = { komi: true };
const secondMover = (s) => other(s.first);
/** Does a tied count go to the second mover in this game? */
const komiApplies = (s) => BALANCE.komi && s.v === 2 && (s.first === 'a' || s.first === 'b');

// ── rules (pure, deterministic) ────────────────────────────────────────
/** Why a move is illegal (a friendly message), or null when it's fine. `wild` skips the send rule. */
function whyNot(s, who, b, i, wild) {
  if (s.end) return 'The game is over';
  if (!Number.isInteger(b) || b < 0 || b > 8 || !Number.isInteger(i) || i < 0 || i > 8) return 'Pick a square';
  if (who !== s.turn) return 'Not your turn';
  // the send rule first: when you're sent somewhere, that's the useful thing to hear
  if (!wild && s.force !== null && s.force !== b) return `You have to play in the ${NAMES[s.force]} board`;
  if (s.big[b] === 'd') return 'That board is full';
  if (s.big[b]) return 'That board is already won';
  if (s.cells[b * 9 + i]) return 'That square is taken';
  return null;
}
function wildWhy(s, who, b) {
  if (s.mode !== 'wild') return 'There are no wildcards in this mode';
  if (!s.wild || !s.wild[who]) return 'You’ve used your wildcard already';
  if (s.force === null) return 'You can play anywhere right now, so keep your wildcard';
  if (b === s.force) return 'That’s the board you were sent to, so keep your wildcard';
  return null;
}
function applySetup(s, who, move) {
  if (move.setup !== 2) throw new Error('Unknown version');
  if (s.end) throw new Error('The game is over');
  if (s.v || marksOf(s)) throw new Error('The mode can only be chosen before the first mark');
  if (who !== s.turn) throw new Error('Not your turn');
  if (typeof move.mode !== 'string' || !has(MODES, move.mode)) throw new Error('Unknown mode');
  s.v = 2;
  s.mode = move.mode;
  s.first = who;
  s.lw = 0;
  s.down = { a: 0, b: 0 };
  if (move.mode === 'hot') s.hot = HOT.pick(s.seed);
  if (move.mode === 'wild') s.wild = { a: 1, b: 1 };
  return s;
}

function applyMove(s, who, move) {
  if (move && move.setup !== undefined) return applySetup(s, who, move);
  const b = move && move.b;
  const i = move && move.i;
  const wild = s.v === 2 && !!(move && move.wild);
  let err = whyNot(s, who, b, i, wild);
  if (!err && wild) err = wildWhy(s, who, b);
  if (err) throw new Error(err);
  s.cells[b * 9 + i] = who;
  s.last = b * 9 + i;
  const small = s.cells.slice(b * 9, b * 9 + 9);
  if (lineOf(small)) s.big[b] = who;
  else if (small.every(Boolean)) s.big[b] = 'd';
  s.force = s.big[i] ? null : i;
  s.turn = other(who);
  if (s.v === 2) {
    if (wild) s.wild[who] = 0;
    s.lw = wild ? 1 : 0;
    const w = boardsWon(s);
    s.down.a = Math.max(s.down.a, w.b - w.a);
    s.down.b = Math.max(s.down.b, w.a - w.b);
  }
  const big = lineOf(s.big);
  if (big) s.end = { why: 'line', who: big.who, line: big.line };
  else if (!canStillLine(s.big, 'a') && !canStillLine(s.big, 'b')) {
    const { a, b: bb } = boardsWon(s);
    if (a === bb && komiApplies(s)) s.end = { why: 'count', who: secondMover(s), a, b: bb, tie: 1 };
    else s.end = { why: 'count', who: a > bb ? 'a' : bb > a ? 'b' : null, a, b: bb };
  }
  return s;
}

// ── Last Light (view only, derived from the big board) ─────────────────
/** Indexes into LINES of the big lines either player can still complete. */
function liveLines(big) {
  const out = [];
  LINES.forEach((L, n) => { if (['a', 'b'].some((w) => L.every((k) => big[k] === null || big[k] === w))) out.push(n); });
  return out;
}
/** "Only the left column can still win it" when one or two big lines are left. */
function lastLight(s) {
  if (s.end) return null;
  const live = liveLines(s.big);
  if (!live.length || live.length > 2) return null;
  return `Only the ${live.map((n) => LINE_NAMES[n]).join(' and the ')} can still win it`;
}

/** "Tied on boards so far: ties go to Sydney" (v2 only, while boards are level). */
function tieNote(s, nm) {
  if (!komiApplies(s)) return null;
  const w = boardsWon(s);
  return w.a === w.b ? `Tied on boards so far${hotClause(s)}: ties go to ${nm(secondMover(s))}` : null;
}

/** Finale texts for a count ending decided by the tie-break (plate, and the Last Light line). */
const tiePlate = (s, nm) => `Boards tied ${s.end.a}–${s.end.b}${hotClause(s)}: ${nm(s.end.who)} wins the tie-break`;
const tieLight = (s, nm) => `No big line left. Boards tied ${s.end.a}–${s.end.b}${hotClause(s)}: ties go to ${nm(s.end.who)}`;

// ── records, rivalry and moment lines ──────────────────────────────────
// Everything is derived from the finished match plus the game's shared data (see tally). Only
// counters that go up use the _n / _best suffixes; streak fields reset and so have none.
const MOMENTS = {
  draw: [
    'A dead heat. Nobody gets bragging rights.',
    'Level on boards. You two are annoyingly well matched.',
    'A draw! Kiss and make up.',
    'Tied up. Diplomatic relations preserved.',
    'Even Steven. Rematch?',
  ],
  record: [
    '{w} did it in {n} squares, a new record. {l} didn’t see it coming.',
    '{w} wins in only {n} squares, the fastest ever here.',
    'Fastest win yet, {n} squares. {l} blinked.',
    'A record finish: {n} squares. {w} is on fire.',
    '{n} squares and done. The speed record belongs to {w}.',
  ],
  streakBreak: [
    '{w} snaps {l}’s {k}-game streak. Rematch?',
    'Streak over! {l}’s {k} in a row ends here.',
    '{w} breaks the streak. Breakfast is on {l}.',
    '{k} wins in a row, ended by {w}. Dramatic.',
    '{l}’s {k}-game run ends, and {w} gets to gloat.',
  ],
  streakExt: [
    '{w} makes it {k} in a row. {l} is plotting revenge.',
    '{k} wins on the trot for {w}. Breakfast is on {l}.',
    'Streak: {k}. {w} is on a roll.',
    '{w} stays unbeaten, {k} in a row. {l}, revenge awaits.',
    'Another one for {w}: {k} straight.',
  ],
  comeback: [
    'From {d} boards down to the win. {w} never blinked.',
    'Comeback! {w} was {d} boards behind and still got there.',
    '{l} had it, then {w} turned it around.',
    '{w} fought back from {d} down. Heroic.',
    'Never count {w} out. That was {d} boards behind.',
  ],
  wild: [
    '{w} saved the wildcard for exactly this.',
    'The wildcard wins it. {w} played it perfectly.',
    'One wildcard, one win. {w} knew.',
    '{w} ignored the rules once, and it was enough.',
    'Wildcard well spent. {l} never saw it coming.',
  ],
  hot: [
    'A hot board sealed it for {w}.',
    'Hot Boards pays off: {w} cashes in the star.',
    '{w} grabbed the star board. {l}, that one stung.',
    'The star board did it. {w} reads the room.',
    'Those hot boards were {w}’s all along.',
  ],
  komi: [
    'Dead level on boards, so the second seat takes it. {w} wins the tie-break.',
    'Tied on boards. Going second pays off: {w} wins.',
    '{w} wins the tie-break. {l} gets a rematch and a hug.',
    'Level to the last board, and the tie goes to {w}.',
    'All square on boards, so {w} takes it from the second seat.',
  ],
  rout: [
    'A clean sweep. {w} barely let {l} breathe.',
    '{w} by a mile. {l}, you were a good sport.',
    'A rout! {l} gets a hug.',
    '{w} ran away with it. Breakfast is on {l}.',
    'Dominant. {w} owned the boards.',
  ],
  photo: [
    'Photo finish: {w} edges it by a single board.',
    'By the thinnest margin, {w} takes it.',
    'One board between you two. A rematch is mandatory.',
    'So close! {w} by the narrowest of margins.',
    '{w} squeaks it. {l} was right there.',
  ],
  firstMode: [
    'First win in {m} for {w}.',
    '{w} opens their {m} account with a win.',
    '{m} debut: {w} wins. Remember this day.',
    'A first {m} win for {w}. Frame it.',
    '{w} is the first to win in {m}.',
  ],
  line: [
    'Three boards in a row. {w} lines it up.',
    '{w} draws the big line. Neat.',
    'The big line is {w}’s. Nicely done.',
    '{w} connects three boards. Satisfying.',
    '{w} sees the line first. Sharp eyes.',
  ],
  count: [
    'No big line left, so boards decide. {w} has more.',
    'Boards counted: {w} takes it {s}.',
    '{w} wins the count, {s}.',
    'The count goes to {w}, {s}. Slow and steady.',
    'Neither could line up three. {w} just had more boards.',
  ],
};
const STRIPS = {
  first: ['First game of Ultimate. Make it count.', 'Fresh start. Nine boards, zero history.', 'Your first Ultimate. Be gentle. Or don’t.'],
  streak: ['{w} is on a {k}-game streak · break it?', '{k} wins in a row for {w}. Revenge, anyone?', '{w} has won {k} straight. Someone should fix that.'],
  firstMode: ['First game in {m}!', '{m}, game one. Nobody’s an expert yet.', 'Your first {m}. Rules are on the menu.'],
  series: ['{a} {x} · {b} {y}. Who’s counting? Both of you.', 'The ledger: {a} {x}, {b} {y}.', '{a} {x}, {b} {y}. Still anyone’s game.'],
  level: ['All square at {x} each. Break the tie?', 'Dead level, {x} each. Someone has to blink.', '{x} wins apiece. Suspiciously fair.'],
};
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? '' : String(v[k])));
const QUICK_TOP = 82; // quick_best = 82 − squares in the fastest win, so it only goes up

/** Which moment fits this finished match, best first. d = the game's data BEFORE this match. */
function momentKeys(s, res, d) {
  const w = res.winner;
  if (!w) return { keys: ['draw'], k: {} };
  const l = other(w);
  const keys = [];
  const mode = s.mode || 'v1';
  const sw = d.streak_who === w ? (d.streak | 0) + 1 : 1;
  const bw = boardsWon(s);
  const mine = bw[w];
  const theirs = bw[l];
  const e = s.end || {};
  const mover = other(s.turn);
  const k = { streakBreak: d.streak | 0, streakExt: sw };
  if ((d.quick_best | 0) > 0 && QUICK_TOP - marksOf(s) > (d.quick_best | 0)) keys.push('record');
  if (d.streak_who === l && (d.streak | 0) >= 2) keys.push('streakBreak');
  if (sw >= 2) keys.push('streakExt');
  if (s.v === 2 && s.down && s.down[w] >= 2) keys.push('comeback');
  if (s.mode === 'wild' && s.lw && mover === w) keys.push('wild');
  if (e.tie) keys.push('komi'); // decided by the tie-break: that is the story, not the hot boards
  if (s.mode === 'hot' && s.hot && (e.why === 'line' ? e.line.some((b) => s.hot.includes(b)) : s.big.some((x, b) => x === w && s.hot.includes(b)))) keys.push('hot');
  if (e.why === 'line' ? theirs === 0 : mine - theirs >= 3) keys.push('rout');
  if (e.why === 'count' && mine - theirs <= 1) keys.push('photo');
  if (!((d[`${mode}_${w}_n`]) | 0)) keys.push('firstMode');
  keys.push(e.why === 'line' ? 'line' : 'count');
  return { keys, k };
}
/** What to write to the shared data when a match finishes (and which moment to show). */
function tally(d, s, res, matchId) {
  const w = res.winner;
  const mode = s.mode || 'v1';
  const { keys, k } = momentKeys(s, res, d);
  const key = keys[0];
  const idx = randInt(MOMENTS[key].length, matchId, 'moment');
  const p = { last_id: matchId, games_n: (d.games_n | 0) + 1, last_moment: `${key}.${idx}.${k[key] || 0}` };
  if (!w) { p.draws_n = (d.draws_n | 0) + 1; return p; }
  const sw = d.streak_who === w ? (d.streak | 0) + 1 : 1;
  p.streak = sw;
  p.streak_who = w;
  if (sw > (d.streak_best | 0)) { p.streak_best = sw; p.streak_best_who = w; }
  p[`wins_${w}_n`] = (d[`wins_${w}_n`] | 0) + 1;
  p[`${mode}_${w}_n`] = (d[`${mode}_${w}_n`] | 0) + 1;
  const marks = marksOf(s);
  if (QUICK_TOP - marks > (d.quick_best | 0)) { p.quick_best = QUICK_TOP - marks; p.quick_who = w; }
  const why = s.end && s.end.why === 'line' ? 'line_n' : 'count_n';
  p[why] = (d[why] | 0) + 1;
  if (s.v === 2 && s.down && s.down[w] >= 2) p.comeback_n = (d.comeback_n | 0) + 1;
  return p;
}
/** The moment line for a finished match from the stored "key.idx.k", or null. */
function momentText(code, s, res, nm) {
  const [key, idx, k] = String(code || '').split('.');
  const pool = has(MOMENTS, key) ? MOMENTS[key] : null;
  const n = Number(idx);
  if (!pool || !Number.isInteger(n) || n < 0 || n >= pool.length) return null;
  const w = res.winner;
  const bw = boardsWon(s);
  const hi = w ? bw[w] : 0;
  const lo = w ? bw[other(w)] : 0;
  return fill(pool[n], {
    w: w ? nm(w) : '', l: w ? nm(other(w)) : '', k: Number(k) || 0, d: w && s.down ? s.down[w] : 0,
    n: marksOf(s), s: `${hi}–${lo}`, m: s.mode && MODES[s.mode] ? MODES[s.mode].name : 'Ultimate',
  });
}
/** The line on the empty board: streaks, firsts, the running score. Same for both phones. */
function stripText(d, mode, nm, matchId) {
  const m = has(MODES, mode) ? mode : 'classic';
  const gn = d.games_n | 0;
  const streak = d.streak | 0;
  const x = d.wins_a_n | 0;
  const y = d.wins_b_n | 0;
  let pool;
  if (!gn) pool = STRIPS.first;
  else if (streak >= 2 && (d.streak_who === 'a' || d.streak_who === 'b')) pool = STRIPS.streak;
  else if (!(((d[`${m}_a_n`]) | 0) + ((d[`${m}_b_n`]) | 0))) pool = STRIPS.firstMode;
  else pool = x === y ? STRIPS.level : STRIPS.series;
  const pickAt = randInt(pool.length, matchId, 'strip');
  return fill(pool[pickAt], { w: d.streak_who ? nm(d.streak_who) : '', k: streak, m: MODES[m].name, a: nm('a'), b: nm('b'), x, y });
}

// ── drawing ────────────────────────────────────────────────────────────
const X_PATH = 'M11 11L29 29M29 11L11 29';
const MARK = {
  a: `<path class="gu-ink" d="${X_PATH}"/><path class="gu-col" d="${X_PATH}"/>`,
  b: '<circle class="gu-ink" cx="20" cy="20" r="10"/><circle class="gu-col" cx="20" cy="20" r="10"/>',
};
const BIG = {
  a: '<path class="gu-ink" pathLength="2" d="M20 20L80 80M80 20L20 80"/><path class="gu-col" pathLength="2" d="M20 20L80 80M80 20L20 80"/>',
  b: '<circle class="gu-ink" pathLength="2" cx="50" cy="50" r="31" transform="rotate(-90 50 50)"/><circle class="gu-col" pathLength="2" cx="50" cy="50" r="31" transform="rotate(-90 50 50)"/>',
};
const cellSVG = (w, cls = '') => `<svg class="gu-m gu-${w} ${cls}" viewBox="0 0 40 40" aria-hidden="true">${MARK[w]}</svg>`;
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2l2.9 6.6 7.1.7-5.4 4.7 1.6 7L12 17.6 5.8 21.2l1.6-7L2 9.5l7.1-.7z"/></svg>';
const clone = (x) => JSON.parse(JSON.stringify(x));
const dotPt = (b) => [50 + (b % 3) * 100, 50 + Math.floor(b / 3) * 100];

registerGame({
  id: 'ultimate',
  title: 'Ultimate Tic-Tac-Toe',
  blurb: 'Nine boards. Every move picks where they play next.',
  kind: 'turns',
  team: false,
  tags: ['brainy'],
  platforms: ['phone', 'computer'],
  minutes: 12,
  endDelay: 2000,
  howTo: [
    'Tap a square, tap again to place. Its spot sends your partner to the matching small board.',
    'Won or full board? Then they may play in any open board.',
    'Three in a row wins a small board; three small boards in a row wins the game. If no big line is left, most boards wins.',
    'Tied on boards at the end? The player who went second wins.',
  ],

  // ── rules (pure, deterministic) ──
  init: ({ first }) => ({ cells: Array(81).fill(null), big: Array(9).fill(null), force: null, turn: first, last: null, end: null }),
  next: (s) => (s.end || s.big.every(Boolean) ? [] : [s.turn]),
  apply: applyMove,
  score: (s) => boardsWon(s),
  result(s) {
    const e = s.end;
    const { a, b } = boardsWon(s);
    const hot = hotClause(s);
    if (e && e.why === 'line') return { winner: e.who, sub: 'Three boards in a row' };
    if (e && e.tie) return { winner: e.who, sub: `Boards tied ${a}–${b}${hot} — ties go to the player who went second.` };
    if (e && e.who) return { winner: e.who, sub: `No big line was left, so boards won decide it${hot}: ${Math.max(a, b)} to ${Math.min(a, b)}` };
    return { winner: null, text: 'Stalemate', sub: `No big line was left and boards won are tied ${a}–${b}. It’s a draw.` };
  },
  /** Pure helpers, exposed for the tests. */
  kit: { MODES, BALANCE, secondMover, tieNote, tiePlate, tieLight, liveLines, lastLight, momentKeys, tally, momentText, stripText, MOMENTS, STRIPS, marksOf },

  // ── view ──
  css: `
.g-ult { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 4px 0 10px; margin-top: calc(var(--gu-lift, 0) * -1px); user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.g-ult .gu-wrap { order: 1; position: relative; width: min(100%, 600px, calc(100vh - 345px)); width: min(100%, 600px, calc(100dvh - 345px)); min-width: 270px; flex: none; }
.g-ult .gu-big { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; background: var(--g-ink); border: 2px solid var(--g-ink); border-radius: var(--g-radius); overflow: hidden; box-shadow: var(--g-shadow); }
.g-ult .gu-sb { position: relative; background: var(--g-card); padding: 6px; transition: background-color 160ms; }
.g-ult .gu-cells { display: grid; grid-template-columns: repeat(3, 1fr); transition: opacity 200ms; }
.g-ult .gu-c { position: relative; aspect-ratio: 1; min-width: 0; margin: 0; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; border-right: 2px solid color-mix(in srgb, var(--g-ink) 30%, transparent); border-bottom: 2px solid color-mix(in srgb, var(--g-ink) 30%, transparent); -webkit-tap-highlight-color: transparent; }
.g-ult .gu-c:nth-child(3n) { border-right: 0; }
.g-ult .gu-c:nth-child(n+7) { border-bottom: 0; }
.g-ult .gu-c:disabled { cursor: default; }
.g-ult .gu-c:focus { outline: none; }
.g-ult .gu-c::before { content: ''; position: absolute; inset: 3px; border-radius: 6px; background: transparent; }
.g-ult .gu-c.is-last::before { background: color-mix(in srgb, var(--g-hl) 75%, transparent); }
.g-ult .gu-c.is-sel::before { background: color-mix(in srgb, var(--g-hl) 60%, transparent); box-shadow: inset 0 0 0 2px var(--g-ink); }
.g-ult .gu-c.is-cur::after, .g-ult .gu-c:focus-visible::after { content: ''; position: absolute; inset: 1px; border-radius: 7px; border: 2px dashed var(--g-ink); }
.g-ult .gu-m { position: absolute; inset: 6%; width: 88%; height: 88%; overflow: visible; }
.g-ult .gu-ink { fill: none; stroke: var(--g-ink); stroke-width: 9; stroke-linecap: round; }
.g-ult .gu-col { fill: none; stroke-width: 5; stroke-linecap: round; }
/* the player's ink goes on the mark itself, never on whatever board happens to be lit for them */
.g-ult .gu-m.gu-a .gu-col, .g-ult .gu-bm.gu-a .gu-col { stroke: var(--p-a); }
.g-ult .gu-m.gu-b .gu-col, .g-ult .gu-bm.gu-b .gu-col { stroke: var(--p-b); }
/* the ghost is an outline only, so it reads on the yellow aim tile */
.g-ult .gu-m.ghost .gu-ink { stroke-width: 8; }
.g-ult .gu-m.ghost.gu-a .gu-col { stroke: color-mix(in srgb, var(--p-a) 30%, var(--g-card)); stroke-width: 4; }
.g-ult .gu-m.ghost.gu-b .gu-col { stroke: color-mix(in srgb, var(--p-b) 30%, var(--g-card)); stroke-width: 4; }
.g-ult .gu-m.is-new { animation: gu-pop 300ms cubic-bezier(0.3, 1.7, 0.5, 1) both; }
@keyframes gu-pop { from { transform: scale(0.2) rotate(-25deg); opacity: 0; } to { transform: none; opacity: 1; } }

.g-ult .gu-sb.is-open.gu-a { background: color-mix(in srgb, var(--p-a) 16%, var(--g-card)); }
.g-ult .gu-sb.is-open.gu-b { background: color-mix(in srgb, var(--p-b) 16%, var(--g-card)); }
.g-ult .gu-sb.is-open::before, .g-ult .gu-sb.is-theirs::before { content: ''; position: absolute; inset: 2px; border-radius: 6px; pointer-events: none; z-index: 1; }
.g-ult .gu-sb.is-target::after { content: ''; position: absolute; inset: 6px; border-radius: 6px; pointer-events: none; z-index: 1; border: 3px dashed var(--g-ink); animation: gu-breathe 1.2s ease-in-out infinite; }
.g-ult .gu-sb.gu-ta::after { border-color: var(--p-a); } .g-ult .gu-sb.gu-tb::after { border-color: var(--p-b); }
.g-ult .gu-sb.is-open.gu-a::before { box-shadow: inset 0 0 0 3px var(--p-a); }
.g-ult .gu-sb.is-open.gu-b::before { box-shadow: inset 0 0 0 3px var(--p-b); }
.g-ult .gu-sb.is-open::before { animation: gu-breathe 1.8s ease-in-out infinite; }
@keyframes gu-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.g-ult .gu-sb.is-theirs.gu-a::before { border: 3px dashed var(--p-a); }
.g-ult .gu-sb.is-theirs.gu-b::before { border: 3px dashed var(--p-b); }
/* a free move (every open board is legal) is a whisper, not nine shouting rings */
.g-ult .gu-sb.is-open.is-free.gu-a { background: color-mix(in srgb, var(--p-a) 7%, var(--g-card)); }
.g-ult .gu-sb.is-open.is-free.gu-b { background: color-mix(in srgb, var(--p-b) 7%, var(--g-card)); }
.g-ult .gu-sb.is-open.is-free::before { animation: none; box-shadow: none; border: 2px solid; opacity: 0.4; }
.g-ult .gu-sb.is-open.is-free.gu-a::before { border-color: var(--p-a); }
.g-ult .gu-sb.is-open.is-free.gu-b::before { border-color: var(--p-b); }
.g-ult .gu-sb.is-theirs.is-free::before { border-width: 2px; opacity: 0.4; }
.g-ult .gu-sb.is-off .gu-cells { opacity: 0.6; }
.g-ult .gu-sb.is-won .gu-cells { opacity: 0.16; }
.g-ult .gu-sb.is-dead .gu-cells { opacity: 0.35; }
.g-ult .gu-sb.is-idle:not(.is-won):not(.is-dead) { background: color-mix(in srgb, var(--g-card) 80%, var(--g-bg)); }
.g-ult .gu-sb.is-dead::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(-45deg, transparent 0 7px, color-mix(in srgb, var(--g-ink) 16%, transparent) 7px 9px); }
.g-ult .gu-sb.shake { animation: gu-shake 340ms ease-out; }
@keyframes gu-shake { 0%, 100% { transform: none; } 25% { transform: translateX(-5px); } 50% { transform: translateX(4px); } 75% { transform: translateX(-2px); } }
.g-ult .gu-bm { position: absolute; inset: 6px; width: calc(100% - 12px); height: calc(100% - 12px); pointer-events: none; overflow: visible; }
.g-ult .gu-bm .gu-ink { stroke-width: 21; }
.g-ult .gu-bm .gu-col { stroke-width: 13; }
.g-ult .gu-bm.is-new path, .g-ult .gu-bm.is-new circle { stroke-dasharray: 2 2; animation: gu-draw 520ms cubic-bezier(0.6, 0, 0.3, 1) both; animation-delay: var(--d, 0ms); }
@keyframes gu-draw { from { stroke-dashoffset: 2; } to { stroke-dashoffset: 0; } }
.g-ult .gu-bm.is-cheer { transform-box: fill-box; transform-origin: center; animation: gu-cheer 560ms cubic-bezier(0.3, 1.6, 0.5, 1) both; animation-delay: var(--c, 0ms); }
@keyframes gu-cheer { 0% { transform: none; } 45% { transform: scale(1.14) rotate(-5deg); } 100% { transform: none; } }
/* Hot Boards: a Riso star in the corner; a won hot board wears a x2 stamp */
.g-ult .gu-hot { display: none; position: absolute; top: 1px; right: 1px; z-index: 3; pointer-events: none; align-items: center; gap: 1px; }
.g-ult .gu-sb.is-hot .gu-hot { display: flex; }
.g-ult .gu-hot svg { width: 15px; height: 15px; overflow: visible; fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 1.7; stroke-linejoin: round; }
.g-ult .gu-hot b { display: none; font: 900 0.62rem/1 var(--g-font-display); color: var(--g-on-ink); background: var(--g-hl); border: 1.5px solid var(--g-ink); border-radius: 4px; padding: 1px 3px; transform: rotate(-6deg); }
.g-ult .gu-sb.is-hot.is-won .gu-hot b { display: block; }
.g-ult .gu-sb.is-hot.is-won .gu-hot svg { width: 20px; height: 20px; }
.g-ult .gu-sb.is-stamp .gu-hot { animation: gu-stamp 640ms cubic-bezier(0.3, 1.8, 0.5, 1) both; }
@keyframes gu-stamp { 0% { transform: scale(0.3) rotate(-30deg); } 60% { transform: scale(1.5) rotate(8deg); } 100% { transform: none; } }
.g-ult .gu-strike, .g-ult .gu-live { position: absolute; inset: 2px; width: calc(100% - 4px); height: calc(100% - 4px); pointer-events: none; overflow: visible; }
.g-ult .gu-sk { fill: none; stroke-linecap: round; stroke-dasharray: 1 1; animation: gu-sk 480ms cubic-bezier(0.6, 0, 0.3, 1) both; animation-delay: var(--d, 0ms); }
.g-ult .gu-sk-ink { stroke: var(--g-ink); stroke-width: 20; }
.g-ult .gu-sk-hl { stroke: var(--g-hl); stroke-width: 11; }
.g-ult .gu-lv { fill: none; stroke: var(--g-ink); stroke-width: 5; stroke-linecap: round; stroke-dasharray: 2 11; opacity: 0.5; }
@keyframes gu-sk { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@media (hover: hover) and (pointer: fine) {
  .g-ult .gu-sb.is-open .gu-c:not(:disabled):hover::before { background: color-mix(in srgb, var(--g-hl) 60%, transparent); }
}

.g-ult .gu-side { order: 2; display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; max-width: 600px; min-width: 0; }
.g-ult .gu-plate { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 16px 8px 10px; border-radius: 999px; background: var(--g-card); border: 2px solid var(--g-ink); box-shadow: var(--g-shadow); font: 900 0.95rem/1.2 var(--g-font-display); color: var(--g-ink); max-width: 100%; text-wrap: balance; }
.g-ult .gu-plate.wait { color: var(--g-muted); border-color: var(--g-line); }
.g-ult .gu-plate.pop { animation: gu-plate 260ms cubic-bezier(0.3, 1.5, 0.5, 1); }
@keyframes gu-plate { from { transform: scale(0.92); } to { transform: none; } }
.g-ult .gu-chip { flex: none; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--g-ink); background: var(--g-card) !important; display: grid; place-items: center; }
.g-ult .gu-chip .gu-m { position: static; width: 20px; height: 20px; }
.g-ult .gu-chip.none { border-style: dashed; }
.g-ult .gu-top { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }
.g-ult .gu-top[hidden], .g-ult [hidden] { display: none !important; }
.g-ult .gu-pick { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; }
.g-ult .gu-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.g-ult .gu-mc { min-height: 44px; padding: 6px 14px; cursor: pointer; font: 800 0.88rem/1.1 var(--g-font-body); touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.g-ult .gu-mc:active { transform: translate(2px, 2px); }
.g-ult .gu-mc:focus-visible, .g-ult .gu-tok:focus-visible { outline: 3px solid var(--p-a); outline-offset: 3px; }
.g-ult .gu-pick-d, .g-ult .gu-strip, .g-ult .gu-light { margin: 0; text-align: center; font: 700 0.84rem/1.3 var(--g-font-body); color: var(--g-muted); text-wrap: balance; max-width: 34em; }
.g-ult .gu-strip { color: var(--g-ink); }
.g-ult .gu-info { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px; }
.g-ult .gu-tok { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 4px 12px; border: var(--g-stroke) solid var(--g-ink); border-radius: 999px; background: var(--g-card); color: var(--g-ink); font: 800 0.82rem/1.1 var(--g-font-body); cursor: pointer; touch-action: manipulation; }
.g-ult .gu-tok .gu-m { position: static; width: 18px; height: 18px; flex: none; }
.g-ult .gu-tok.is-ready { box-shadow: var(--g-shadow-sm); }
.g-ult .gu-tok.is-armed { background: var(--g-hl); color: var(--g-on-ink); }
.g-ult .gu-tok.is-used { border-style: dashed; box-shadow: none; background: var(--g-bg); }
.g-ult .gu-tok.is-used span { text-decoration: line-through; text-decoration-thickness: 2px; }
.g-ult .gu-tok.is-used .gu-m { opacity: 0.45; }
.g-ult .gu-nm-a { color: var(--p-a-text); }
.g-ult .gu-nm-b { color: var(--p-b-text); }
.g-ult .gu-tie { font-weight: 900; }
.g-ult .gu-tok:disabled { cursor: default; }
.g-ult .gu-light { color: var(--g-ink); }
.g-ult .gu-moment { margin: 2px 0 0; padding: 8px 14px; max-width: 100%; text-align: center; text-wrap: balance; font: 900 0.92rem/1.25 var(--g-font-display); color: var(--g-ink); background: var(--g-hl); color: var(--g-on-ink); border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm); box-shadow: var(--g-shadow-sm); transform: rotate(-1.2deg); animation: gu-stampin 380ms cubic-bezier(0.3, 1.7, 0.5, 1) both; }
@keyframes gu-stampin { from { transform: scale(1.4) rotate(-6deg); opacity: 0; } to { transform: rotate(-1.2deg); opacity: 1; } }

/* phone on its side: board left, everything else right, no scrolling */
@media (orientation: landscape) and (max-height: 560px) {
  .g-ult { flex-direction: row; align-items: center; justify-content: center; gap: 18px; padding: 0; }
  .g-ult .gu-wrap { width: var(--gu-s, 220px); min-width: 0; }
  .g-ult .gu-side { flex: 0 1 320px; width: auto; min-width: 210px; gap: 8px; }
  .g-ult .gu-plate { font-size: 0.88rem; }
  .g-ult .gu-pick-d, .g-ult .gu-strip, .g-ult .gu-light { font-size: 0.8rem; }
}
@media (prefers-reduced-motion: reduce) {
  .g-ult *, .g-ult *::before, .g-ult *::after { animation: none !important; transition: none !important; }
}
`,

  mount(el, api) {
    const store = gameDataApi('ultimate');
    const dat = () => ({ ...store.data() });
    const root = document.createElement('div');
    root.className = 'g-ult';
    let html = '<div class="gu-wrap"><div class="gu-big">';
    for (let b = 0; b < 9; b++) {
      html += `<div class="gu-sb" data-b="${b}"><div class="gu-cells">`;
      for (let i = 0; i < 9; i++) html += `<button type="button" class="gu-c" data-b="${b}" data-i="${i}" tabindex="-1"></button>`;
      html += `</div><svg class="gu-bm" viewBox="0 0 100 100" aria-hidden="true"></svg><span class="gu-hot" aria-hidden="true">${STAR}<b>×2</b></span></div>`;
    }
    html += '</div><svg class="gu-live" viewBox="0 0 300 300" aria-hidden="true"></svg><svg class="gu-strike" viewBox="0 0 300 300" aria-hidden="true"></svg></div>';
    html += '<div class="gu-side">';
    html += '<div class="gu-top">';
    html += '<div class="gu-pick" hidden><div class="gu-chips" role="radiogroup" aria-label="Game mode">';
    for (const id of Object.keys(MODES)) html += `<button type="button" role="radio" class="g-chip gu-mc" data-m="${id}" aria-checked="false">${MODES[id].name}</button>`;
    html += '</div><p class="gu-pick-d"></p></div>';
    html += '<p class="gu-strip" hidden></p>';
    html += '<div class="gu-info" hidden><span class="g-chip gu-tie"></span><span class="g-chip is-hl gu-modechip"></span><button type="button" class="gu-tok" data-w="a"></button><button type="button" class="gu-tok" data-w="b"></button></div>';
    html += '</div>';
    html += '<div class="gu-plate" aria-live="polite"><span class="gu-chip"></span><span class="gu-plate-t"></span></div>';
    html += '<p class="gu-light" hidden></p><p class="gu-moment" hidden></p>';
    html += '</div>';
    // the picker and wildcards come before the grid in tab order; CSS puts the board first on screen
    const k = html.indexOf('<div class="gu-side">');
    root.innerHTML = html.slice(k) + html.slice(0, k);
    el.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const bigEl = $('.gu-big');
    const regions = [...root.querySelectorAll('.gu-sb')];
    const cells = [...root.querySelectorAll('.gu-c')];
    const strike = $('.gu-strike');
    const live = $('.gu-live');
    const plate = $('.gu-plate');
    const pickEl = $('.gu-pick');
    const stripEl = $('.gu-strip');
    const infoEl = $('.gu-info');
    const lightEl = $('.gu-light');
    const momentEl = $('.gu-moment');
    const toks = [...root.querySelectorAll('.gu-tok')];
    const modeBtns = [...root.querySelectorAll('.gu-mc')];

    let ctx = null;
    let seen = null;
    let wasOver = null;
    let sel = null; // { b, i, by: 'tap' | 'hover' | 'key' }
    let lastPT = '';
    let lastKeyAt = 0;
    let chosen = null; // the mode chip the first mover tapped (before the setup move is sent)
    let armed = false; // Wildcards: the player has armed their wildcard
    let bigShown = Array(9).fill(null); // which big marks are drawn (to animate new ones)
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
    const openBoards = (s) => s.big.map((x, b) => (x ? -1 : b)).filter((b) => b >= 0);
    const wildOn = (s) => armed && !!ctx && ctx.canMove && s.v === 2 && s.mode === 'wild' && s.force !== null && !!(s.wild && s.wild[ctx.actor]);
    const legalFor = (s) => (wildOn(s) ? openBoards(s) : s.force !== null ? [s.force] : openBoards(s));
    const effMode = () => {
      if (chosen && has(MODES, chosen)) return chosen;
      const dm = dat().mode;
      return typeof dm === 'string' && has(MODES, dm) ? dm : 'classic';
    };
    const unset = (c) => !c.state.v && marksOf(c.state) === 0 && c.moves === 0; // nobody has chosen a mode or played yet
    /** The move a tap on (b, i) would send: a wildcard move when it leaves the board you were sent to. */
    const mvFor = (b, i) => (wildOn(ctx.state) && ctx.state.force !== b ? { b, i, wild: 1 } : { b, i });
    const whyAim = (b, i) => {
      const s = ctx.state;
      if (s.v === 2 && wildOn(s) && s.force !== b) return whyNot(s, ctx.actor, b, i, true) || wildWhy(s, ctx.actor, b);
      return whyNot(s, ctx.actor, b, i);
    };
    function preview(b, i) {
      if (!ctx || !ctx.canMove || whyAim(b, i)) return null;
      try { return applyMove(clone(ctx.state), ctx.actor, mvFor(b, i)); } catch { return null; }
    }

    function paint(fresh) {
      const c = ctx;
      const s = c.state;
      const actor = c.actor;
      const waitingOn = !c.over && !c.canMove ? c.acts[0] : null;
      const allowed = new Set(c.over ? [] : legalFor(s));
      const free = allowed.size > 1;
      const pv = sel ? preview(sel.b, sel.i) : null;
      const target = pv && !pv.end ? pv.force : null;
      const lightLines = c.over ? [] : liveLines(s.big);
      const few = lightLines.length > 0 && lightLines.length <= 3;
      const onLine = new Set();
      if (few) lightLines.forEach((n) => LINES[n].forEach((b) => onLine.add(b)));
      regions.forEach((rg, b) => {
        const st = s.big[b];
        let cls = 'gu-sb';
        if (st === 'a' || st === 'b') cls += ' is-won';
        else if (st === 'd') cls += ' is-dead';
        else if (c.canMove) cls += allowed.has(b) ? ` is-open gu-${actor}${free ? ' is-free' : ''}` : ' is-off';
        else if (waitingOn && allowed.has(b)) cls += ` is-theirs gu-${waitingOn}${free ? ' is-free' : ''}`;
        if (pv && target === b) cls += ` is-target gu-t${other(actor)}`;
        if (s.mode === 'hot' && s.hot && s.hot.includes(b)) cls += ' is-hot';
        if (few && !st && !onLine.has(b)) cls += ' is-idle';
        if (rg.classList.contains('shake')) cls += ' shake';
        if (rg.classList.contains('is-stamp')) cls += ' is-stamp';
        rg.className = cls;
        // big mark
        const bm = rg.querySelector('.gu-bm');
        if (st === 'a' || st === 'b') {
          const isNew = bigShown[b] !== st && fresh.animate;
          if (bigShown[b] !== st || bm.dataset.w !== st) {
            bm.innerHTML = BIG[st];
            bm.dataset.w = st;
          }
          bm.setAttribute('class', `gu-bm gu-${st}${isNew ? ' is-new' : ''}`);
          bm.style.setProperty('--d', `${fresh.bigDelay}ms`);
        } else if (bm.dataset.w) { bm.innerHTML = ''; bm.dataset.w = ''; bm.setAttribute('class', 'gu-bm'); }
      });
      bigShown = s.big.slice();
      // roving tabindex: exactly one tab stop for the whole grid
      const focusB = focusedCell();
      let rove = null;
      if (c.canMove) {
        if (focusB && !whyAim(focusB.b, focusB.i)) rove = focusB;
        else if (sel && sel.by === 'key') rove = sel;
        else rove = defaultCursor();
      }
      cells.forEach((btn, k) => {
        const b = Math.floor(k / 9);
        const i = k % 9;
        const v = s.cells[k];
        const isSel = sel && sel.b === b && sel.i === i;
        const ok = isSel && !!pv;
        let cls = 'gu-c';
        if (k === s.last && !c.over) cls += ' is-last';
        if (ok) cls += ' is-sel';
        if (isSel && sel.by === 'key') cls += ' is-cur';
        btn.className = cls;
        const want = v ? `${v}${k === fresh.newCell ? '+' : ''}` : ok ? `ghost-${actor}` : '';
        if (btn.dataset.m !== want) {
          btn.dataset.m = want;
          btn.innerHTML = v ? cellSVG(v, k === fresh.newCell ? 'is-new' : '') : ok ? cellSVG(actor, 'ghost') : '';
        }
        btn.disabled = !c.canMove;
        btn.tabIndex = rove && rove.b === b && rove.i === i ? 0 : -1;
        btn.setAttribute('aria-label', `${NAMES[b]} board, square ${i + 1}${v ? `, ${api.name(v)}` : ''}`);
      });
      // Last Light: the big lines still alive, drawn faintly when only a couple are left
      live.innerHTML = '';
      if (!c.over && lightLines.length > 0 && lightLines.length <= 2) {
        live.innerHTML = lightLines.map((n) => {
          const L = LINES[n];
          const [x1, y1] = dotPt(L[0]);
          const [x2, y2] = dotPt(L[2]);
          return `<path class="gu-lv" d="M${x1} ${y1}L${x2} ${y2}"/>`;
        }).join('');
      }
      // finale
      strike.innerHTML = '';
      if (s.end && s.end.why === 'line') {
        const L = s.end.line;
        const [x1, y1] = dotPt(L[0]);
        const [x2, y2] = dotPt(L[2]);
        const dx = (x2 - x1) / 200 * 30;
        const dy = (y2 - y1) / 200 * 30;
        const d = `M${x1 - dx} ${y1 - dy}L${x2 + dx} ${y2 + dy}`;
        const delay = fresh.finale;
        strike.innerHTML = `<path class="gu-sk gu-sk-ink" pathLength="1" d="${d}" style="--d:${delay}ms"/><path class="gu-sk gu-sk-hl" pathLength="1" d="${d}" style="--d:${delay}ms"/>`;
      }
      if (s.end && s.end.who) {
        const winners = s.end.why === 'line' ? s.end.line : s.big.map((x, b) => (x === s.end.who ? b : -1)).filter((b) => b >= 0);
        winners.forEach((b, n) => {
          const bm = regions[b].querySelector('.gu-bm');
          const cheer = () => { bm.classList.remove('is-new'); bm.style.setProperty('--c', `${n * 100}ms`); bm.classList.add('is-cheer'); };
          if (fresh.finale > 0) later(cheer, fresh.finale + 300); else cheer();
        });
      }
      renderTop(c);
      renderPlate(pv, target);
      renderExtras(c);
      fit();
    }

    // the zone above the plate: mode picker | rivalry strip | mode label + wildcards
    function renderTop(c) {
      const s = c.state;
      const fresh = unset(c) && !c.over;
      const picking = fresh && c.canMove;
      pickEl.hidden = !picking;
      modeBtns.forEach((btn) => { btn.disabled = !c.canMove; });
      toks.forEach((tk) => { tk.disabled = !(c.canMove && c.actor === tk.dataset.w); });
      stripEl.hidden = !fresh;
      infoEl.hidden = c.over || !(s.v === 2 || fresh);
      if (picking) {
        const m = effMode();
        modeBtns.forEach((btn) => {
          btn.disabled = !c.canMove;
          const on = btn.dataset.m === m;
          btn.classList.toggle('is-hl', on);
          btn.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        $('.gu-pick-d').textContent = MODES[m].blurb;
      }
      if (fresh) stripEl.textContent = stripText(dat(), effMode(), api.name, c.matchId);
      if (!infoEl.hidden) {
        // the komi, visible before it matters: ties on boards go to whoever moves second
        const second = s.v === 2 ? secondMover(s) : other(c.first);
        const tie = $('.gu-tie');
        tie.innerHTML = 'Ties → <b class="gu-nm"></b>';
        tie.lastChild.textContent = api.name(second);
        tie.lastChild.className = `gu-nm gu-nm-${second}`;
        const chip = $('.gu-modechip');
        chip.hidden = s.mode !== 'hot';
        chip.textContent = 'Hot Boards · stars count double';
        toks.forEach((tk) => {
          const w = tk.dataset.w;
          const wild = s.mode === 'wild';
          tk.hidden = !wild;
          if (!wild) return;
          const ready = !!(s.wild && s.wild[w]);
          const mine = c.canMove && c.actor === w && ready && s.force !== null;
          const isArmed = mine && armed;
          tk.className = `gu-tok ${ready ? 'is-ready' : 'is-used'}${isArmed ? ' is-armed' : ''}`;
          const me = c.canMove && c.actor === w;
          const label = me ? (!ready ? 'Wildcard used' : isArmed ? 'Wildcard armed' : 'Use wildcard') : `${api.name(w)}: ${ready ? 'ready' : 'used'}`;
          tk.setAttribute('aria-pressed', isArmed ? 'true' : 'false');
          tk.innerHTML = `${cellSVG(w)}<span></span>`;
          tk.lastChild.textContent = label;
        });
      }
    }
    function renderExtras(c) {
      const s = c.state;
      // Last Light
      let light = null;
      if (c.over) light = s.end && s.end.why === 'count' ? (s.end.tie ? tieLight(s, api.name) : 'No big line left — boards decide') : null;
      else {
        light = lastLight(s);
        const tn = light && tieNote(s, api.name);
        if (tn) light += ` · ${tn}`;
      }
      lightEl.hidden = !light;
      if (light) lightEl.textContent = light;
      // the moment (shared through the game data, so both phones read the same line)
      let moment = null;
      if (c.over) {
        const d = dat();
        if (d.last_id === c.matchId) moment = momentText(d.last_moment, s, c.result || {}, api.name);
      }
      momentEl.hidden = !moment;
      if (moment && momentEl.textContent !== moment) momentEl.textContent = moment;
    }

    function renderPlate(pv, target) {
      const c = ctx;
      const s = c.state;
      const online = c.mode === 'online';
      let who = c.actor;
      let text;
      let wait = false;
      if (c.over) {
        const e = s.end || {};
        const { a, b } = boardsWon(s);
        who = e.who || null;
        if (e.why === 'line') text = `${api.name(e.who)} wins, three in a row`;
        else if (e.tie) text = tiePlate(s, api.name);
        else if (e.who) text = `${api.name(e.who)} wins on boards, ${Math.max(a, b)}–${Math.min(a, b)}`;
        else text = `Boards tied ${a}–${b}. A draw.`;
      } else if (!c.canMove) {
        who = c.acts[0] || null;
        wait = true;
        text = unset(c) && online ? `${api.name(who)} is picking a mode…` : `${api.name(who)}’s turn`;
      } else if (sel && pv) {
        const act = sel.by === 'tap' ? 'Tap again' : sel.by === 'hover' ? 'Click' : 'Press Enter';
        const opp = api.name(other(who));
        if (pv.end) text = `${act} to place`;
        else if (target === null) text = `${act} · ${opp} can then go anywhere`;
        else text = `${act} · sends ${opp} to the ${NAMES[target]} board`;
      } else {
        const where = s.force !== null ? `play in the ${NAMES[s.force]} board` : 'play in any open board';
        if (wildOn(s)) text = 'Wildcard: play in any open board';
        else text = online ? `Your turn · ${where}` : `${api.name(who)}: ${where}`;
      }
      const chip = $('.gu-chip');
      chip.className = `gu-chip ${who ? 'gu-' + who : 'none'}`;
      chip.innerHTML = who ? cellSVG(who) : '';
      plate.classList.toggle('wait', wait);
      $('.gu-plate-t').textContent = text;
    }
    // Phone on its side: the chrome above leaves little height, so size the board from what's left
    // (the empty status line is reclaimed while playing). Portrait sizing is pure CSS.
    const landscape = () => { try { return matchMedia('(orientation: landscape) and (max-height: 560px)').matches; } catch { return false; } };
    const setVar = (k, v) => { if (root.style.getPropertyValue(k) !== v) root.style.setProperty(k, v); };
    function fit() {
      const over = !!(ctx && ctx.over);
      if (!landscape()) { root.style.removeProperty('--gu-s'); setVar('--gu-lift', over ? '0' : '22'); return; }
      const lift = over ? 0 : 18;
      setVar('--gu-lift', String(lift));
      const gm = el.closest('.gm');
      const pad = gm ? parseFloat(getComputedStyle(gm).paddingBottom) || 12 : 12;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const avail = window.innerHeight - top - pad - 2 + lift;
      const wide = root.clientWidth - 250;
      setVar('--gu-s', `${Math.max(180, Math.floor(Math.min(avail, wide > 180 ? wide : avail)))}px`);
    }
    window.addEventListener('resize', fit);
    // the status line above the stage comes and goes (end card closed, result shown): measure again
    let ro = null;
    try {
      const gm = el.closest('.gm');
      const st = gm && gm.querySelector('.gm-status');
      if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => fit()); ro.observe(el); if (st) ro.observe(st); }
    } catch { ro = null; }
    const popPlate = () => { plate.classList.remove('pop'); void plate.offsetWidth; plate.classList.add('pop'); };
    const calm = { animate: false, newCell: -1, bigDelay: 0, finale: 0 };

    function shake(b) {
      const rg = regions[b];
      rg.classList.remove('shake'); void rg.offsetWidth; rg.classList.add('shake');
      later(() => rg.classList.remove('shake'), 360);
    }
    function refuse(b, msg) {
      api.toast(msg);
      api.sfx('bad');
      api.haptic(40);
      if (b != null) shake(b);
    }
    function aim(b, i, by) {
      if (!ctx || !ctx.canMove) return;
      if (sel && sel.b === b && sel.i === i && sel.by === by) return;
      sel = { b, i, by };
      if (by !== 'hover') { api.sfx('tap'); api.haptic(8); }
      paint(calm);
    }
    function clearAim() {
      if (!sel) return;
      sel = null;
      paint(calm);
    }
    /** Send a move. The very first move of a fresh match is preceded by the setup move (v2). */
    function send(mv) {
      if (unset(ctx)) {
        const r0 = api.move({ setup: 2, mode: effMode() });
        if (!r0.ok) { api.toast(r0.error); return r0; }
      }
      return api.move(mv);
    }
    function place(b, i) {
      if (!ctx || !ctx.canMove) return;
      const mv = mvFor(b, i);
      const r = send(mv);
      if (!r.ok) refuse(b, r.error);
      else if (mv.wild) armed = false;
    }

    // touch: aim then place. mouse: hover previews, click places.
    bigEl.addEventListener('pointerdown', (e) => { lastPT = e.pointerType || ''; });
    bigEl.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !ctx || !ctx.canMove) return;
      const btn = e.target.closest('.gu-c');
      if (!btn) return;
      const b = Number(btn.dataset.b);
      const i = Number(btn.dataset.i);
      if (whyAim(b, i)) { if (sel && sel.by === 'hover') clearAim(); return; }
      aim(b, i, 'hover');
    });
    bigEl.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && sel && sel.by === 'hover') clearAim(); });
    bigEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.gu-c');
      if (!btn || !ctx || !ctx.canMove) return;
      if (e.detail === 0 && performance.now() - lastKeyAt < 700) return; // the key handler already did this
      const b = Number(btn.dataset.b);
      const i = Number(btn.dataset.i);
      const pt = e.pointerType || lastPT || 'touch';
      lastPT = '';
      if (pt === 'mouse') { place(b, i); return; }
      const why = whyAim(b, i);
      if (why) { refuse(b, why); if (sel) clearAim(); return; }
      if (sel && sel.b === b && sel.i === i && sel.by !== 'hover') place(b, i);
      else aim(b, i, 'tap');
    });
    // keyboard users tabbing into the grid get the preview for the cell they land on
    bigEl.addEventListener('focusin', (e) => {
      const btn = e.target.closest && e.target.closest('.gu-c');
      if (!btn || !ctx || !ctx.canMove) return;
      let vis = false;
      try { vis = btn.matches(':focus-visible'); } catch { vis = false; }
      if (!vis) return;
      const b = Number(btn.dataset.b);
      const i = Number(btn.dataset.i);
      if (!whyAim(b, i) && !(sel && sel.b === b && sel.i === i)) { sel = { b, i, by: 'key' }; paint(calm); }
    });

    // mode picker and wildcard
    root.addEventListener('click', (e) => {
      const mc = e.target.closest('.gu-mc');
      if (mc && ctx && ctx.canMove && unset(ctx)) {
        chosen = mc.dataset.m;
        store.setData({ mode: chosen });
        api.sfx('tap');
        paint(calm);
        return;
      }
      const tk = e.target.closest('.gu-tok');
      if (tk && ctx && ctx.canMove) {
        const s = ctx.state;
        if (tk.dataset.w !== ctx.actor) return;
        if (!s.wild || !s.wild[ctx.actor]) { api.toast('You’ve used your wildcard already'); api.sfx('bad'); return; }
        if (s.force === null) { api.toast('You can play anywhere right now, so keep your wildcard'); api.sfx('bad'); return; }
        armed = !armed;
        sel = null;
        api.sfx('tap');
        paint(calm);
      }
    });

    const toRC = (b, i) => [Math.floor(b / 3) * 3 + Math.floor(i / 3), (b % 3) * 3 + (i % 3)];
    const fromRC = (R, C) => ({ b: Math.floor(R / 3) * 3 + Math.floor(C / 3), i: (R % 3) * 3 + (C % 3) });
    function focusedCell() {
      const a = document.activeElement;
      return a && a.classList && a.classList.contains('gu-c') && root.contains(a) ? { b: Number(a.dataset.b), i: Number(a.dataset.i) } : null;
    }
    function defaultCursor() {
      const s = ctx.state;
      const boards = legalFor(s);
      if (!boards.length) return null;
      const b = boards.includes(4) ? 4 : boards[0];
      const order = [4, 0, 2, 6, 8, 1, 3, 5, 7];
      const i = order.find((x) => !s.cells[b * 9 + x]);
      return { b, i: i ?? 4 };
    }
    const moveFocus = (b, i) => { if (root.contains(document.activeElement)) { try { cells[b * 9 + i].focus({ preventScroll: true }); } catch { /* fine */ } } };
    const onKey = (e) => {
      if (!ctx || !ctx.canMove || !root.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('#game-root .gm-sheet:not([hidden]), #game-root .gm-end:not([hidden])')) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const onCell = t && t.classList && t.classList.contains('gu-c') && root.contains(t);
      const otherButton = t && t.closest && t.closest('button, a') && !onCell;
      if (otherButton) return; // a button of ours (mode chip, wildcard) or the app's keeps its own Enter
      const arrows = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
      if (arrows[e.key]) {
        e.preventDefault();
        const from = focusedCell() || (sel && sel.by !== 'hover' ? sel : null);
        if (!from) { const d = defaultCursor(); if (d) { aim(d.b, d.i, 'key'); moveFocus(d.b, d.i); } return; }
        const [R, C] = toRC(from.b, from.i);
        const [dr, dc] = arrows[e.key];
        // when you're sent to one board, the cursor stays inside it
        const f = ctx.state.force;
        const [r0, c0, span] = f !== null && !wildOn(ctx.state) ? [Math.floor(f / 3) * 3, (f % 3) * 3, 2] : [0, 0, 8];
        const n = fromRC(Math.max(r0, Math.min(r0 + span, R + dr)), Math.max(c0, Math.min(c0 + span, C + dc)));
        aim(n.b, n.i, 'key');
        moveFocus(n.b, n.i);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        lastKeyAt = performance.now();
        // the focused cell is the cursor; with nothing focused, the aimed one, else the default
        let cur = focusedCell() || (sel && sel.by !== 'hover' ? sel : null);
        if (!cur) { const d = defaultCursor(); if (d) { aim(d.b, d.i, 'key'); moveFocus(d.b, d.i); } return; }
        const why = whyAim(cur.b, cur.i);
        if (why) refuse(cur.b, why);
        else place(cur.b, cur.i);
      }
    };
    document.addEventListener('keydown', onKey);
    const offData = store.onData(() => { if (ctx) paint(calm); });
    api.setStatus('');

    function countMatch(c) {
      const d = dat();
      if (d.last_id === c.matchId) return; // the other phone already counted this one
      store.setData(tally(d, c.state, c.result || { winner: null }, c.matchId));
    }

    return {
      update(c) {
        const prev = seen;
        ctx = c;
        seen = c.moves;
        const moved = prev !== c.moves;
        const lm = c.last && c.last.move;
        const isMark = !!lm && lm.setup === undefined;
        const animate = !reduced() && isMark && (prev == null ? c.mode === 'online' && c.last.who !== c.me : c.moves === prev + 1 || (prev === 0 && c.moves === 2));
        if (prev == null) bigShown = animate ? c.state.big.map((x, b) => (c.last && c.state.last != null && Math.floor(c.state.last / 9) === b ? null : x)) : c.state.big.slice();
        if (moved || !c.canMove) sel = sel && sel.by === 'key' && c.canMove ? sel : null;
        if (moved) armed = false;
        if (sel && sel.by === 'key' && c.canMove) {
          // keep the keyboard cursor, but move it into the board you're now sent to
          if (whyAim(sel.b, sel.i)) { const d = defaultCursor(); sel = d ? { ...d, by: 'key' } : null; if (d) moveFocus(d.b, d.i); }
        }
        const lastB = c.state.last != null ? Math.floor(c.state.last / 9) : -1;
        const wonNow = animate && lastB >= 0 && bigShown[lastB] !== c.state.big[lastB] && (c.state.big[lastB] === 'a' || c.state.big[lastB] === 'b');
        const hotNow = wonNow && c.state.mode === 'hot' && c.state.hot && c.state.hot.includes(lastB);
        const fresh = {
          animate,
          newCell: animate ? c.state.last : -1,
          bigDelay: 180,
          finale: c.over && animate ? (wonNow ? 760 : 300) : 0,
        };
        if (hotNow) {
          const rg = regions[lastB];
          later(() => { rg.classList.remove('is-stamp'); void rg.offsetWidth; rg.classList.add('is-stamp'); }, 420);
          later(() => rg.classList.remove('is-stamp'), 1200);
        }
        paint(fresh);
        if (animate) {
          api.sfx('place');
          api.haptic(14);
          if (hotNow) later(() => { api.sfx('pop'); api.haptic(30); }, 440);
          if (wonNow) later(() => { api.sfx('good'); api.haptic(25); }, 220);
          else if (lastB >= 0 && c.state.big[lastB] === 'd') later(() => api.sfx('flip'), 200);
          if (c.over && c.state.end && c.state.end.why === 'line') later(() => api.sfx('pop'), fresh.finale + 200);
        }
        if (moved && prev != null) popPlate();
        // count the match once, when this phone sees it finish
        const justEnded = wasOver === false && c.over;
        wasOver = c.over;
        if (justEnded) countMatch(c);
      },
      onEndClosed() { fit(); later(fit, 60); later(fit, 250); },
      destroy() {
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', fit);
        if (ro) ro.disconnect();
        if (offData) offData();
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
