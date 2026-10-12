// Four in a Row: 7 columns × 6 rows with gravity. Tap a column to lift your disc over it,
// tap the same column again to drop it (a mouse drops on click, keys 1–7 / arrows / Tab + Enter).
// Four in a line wins; a full board is a draw.
//
// Modes (v2, chosen by a setup move before the first disc, see docs/games/four.md):
//   classic  the original rules
//   ghost    Ghost Column: a seeded non-centre column is capped at three discs
//   pop      PopOut: instead of dropping, pop one of your own bottom-row discs out
import { registerGame, randInt, gameDataApi } from './core.js';

const COLS = 7;
const ROWS = 6;
const other = (w) => (w === 'a' ? 'b' : 'a');
const DIRS = [[1, 0, 'across'], [0, 1, 'down'], [1, 1, 'diag'], [1, -1, 'diag']];

const MODES = {
  classic: { name: 'Classic', desc: 'The original. First to line up four.' },
  ghost: { name: 'Ghost Column', desc: 'A ghost caps one column at three discs.' },
  pop: { name: 'PopOut', desc: 'Or pop your own bottom disc out.' },
};
const MODE_IDS = ['classic', 'ghost', 'pop'];
const isMode = (m) => typeof m === 'string' && Object.prototype.hasOwnProperty.call(MODES, m);
const GHOST_COLS = [0, 1, 2, 4, 5, 6];
const GHOST_CAP = 3;
const POP_MOVES = 100; // PopOut can go round forever: a hundred moves with no four is a draw
const ghostFor = (seed) => GHOST_COLS[randInt(GHOST_COLS.length, seed, 'ghost')];
const modeOf = (s) => (s && s.v === 2 && isMode(s.mode) ? s.mode : 'classic');
const capOf = (s, c) => (s.v === 2 && s.mode === 'ghost' && s.ghost === c ? GHOST_CAP : ROWS);
const canDrop = (s) => s.cols.some((stack, c) => stack.length < capOf(s, c));
const canPop = (s, w) => s.cols.some((stack) => stack[0] === w);

/** Every line of four or more through (c, r) for `who`. r counts up from the bottom. The cell itself is not read. */
function runsThrough(cols, c, r, who) {
  const runs = [];
  for (const [dc, dr, dir] of DIRS) {
    const cells = [[c, r]];
    for (const s of [1, -1]) {
      let x = c + dc * s;
      let y = r + dr * s;
      while (x >= 0 && x < COLS && y >= 0 && y < ROWS && cols[x][y] === who) { cells.push([x, y]); x += dc * s; y += dr * s; }
    }
    if (cells.length >= 4) runs.push({ dir, cells: cells.sort((p, q) => p[0] - q[0] || p[1] - q[1]) });
  }
  return runs;
}
/** Every maximal line of four or more for `who` anywhere on the board (PopOut moves many discs at once). */
function allRuns(cols, who) {
  const runs = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < cols[c].length; r++) {
      if (cols[c][r] !== who) continue;
      for (const [dc, dr, dir] of DIRS) {
        const pc = c - dc;
        const pr = r - dr;
        if (pc >= 0 && pc < COLS && pr >= 0 && pr < ROWS && cols[pc][pr] === who) continue; // not the start of the run
        const cells = [[c, r]];
        let x = c + dc;
        let y = r + dr;
        while (x >= 0 && x < COLS && y >= 0 && y < ROWS && cols[x][y] === who) { cells.push([x, y]); x += dc; y += dr; }
        if (cells.length >= 4) runs.push({ dir, cells: cells.sort((p, q) => p[0] - q[0] || p[1] - q[1]) });
      }
    }
  }
  return runs;
}
/** How many open threes `loser` is sitting on: three discs plus one empty hole that a drop could fill right now. */
function closeCalls(s, loser) {
  let n = 0;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      for (const [dc, dr] of DIRS) {
        const ex = c + dc * 3;
        const ey = r + dr * 3;
        if (ex < 0 || ex >= COLS || ey < 0 || ey >= ROWS) continue;
        let mine = 0;
        let hole = 0;
        let bad = false;
        for (let k = 0; k < 4; k++) {
          const x = c + dc * k;
          const y = r + dr * k;
          const v = s.cols[x][y];
          if (v === loser) mine++;
          else if (v === undefined && y === s.cols[x].length && y < capOf(s, x)) hole++;
          else bad = true;
        }
        if (!bad && mine === 3 && hole === 1) n++;
      }
    }
  }
  return n;
}
/** Moves a player has made: v2 counts them, legacy matches work it out from who started. */
function movesBy(s, who, first) {
  if (s.mv) return s.mv[who];
  return who === first ? Math.ceil(s.n / 2) : Math.floor(s.n / 2);
}

// ── warm words: the moment line in the finale, and the rivalry strip ──
// {w} winner, {l} loser, {m} winner's moves, {k} streak length, {b} blocks, {mode} mode name
const MOMENTS = {
  record: ['New fastest win: {m} moves. Somebody’s showing off.', '{w} did it in {m} moves. A new record, and a little smug.', 'A record {m}-move win. {l} will be wanting a rematch.'],
  broke: ['{w} breaks {l}’s streak. Rude. Impressive.', '{l}’s winning run stops here. Lovingly, {w} stepped on it.', 'Streak over. {w} ended it, and is very calm about it.'],
  streak: ['{w} is on a {k}-game streak.', '{k} in a row for {w}. Someone should say something.', '{k} straight for {w}. Breakfast is on {l}.'],
  comeback: ['{w} blocked {b} sneaky fours and still won.', '{w} blocked it, blocked it, then struck.', 'Escape artist: {w} dodged {b} threats on the way.'],
  photo: ['Won on the very last squares. {l} was a disc from a draw.', 'Photo finish. The board was nearly full.'],
  firstmode: ['First win in {mode} for {w}.', '{w} takes the first {mode} game in this house. History.'],
  rout: ['Only {m} moves. Blink and you missed it.', '{w} wrapped it up in {m} moves.', 'Short and sweet: {m} moves.'],
  close: ['So close. {l} had three lined up too.', '{l} was one disc away. So close.', 'Almost, {l}. Almost.', '{l} had a three waiting. Next time.'],
  generic: ['Well played, {w}.', 'Four. Just like that.', '{w} takes it. {l} gets the rematch.'],
  draw: ['A draw. You two are annoyingly well matched.', 'Dead even. Rematch?', 'Nobody wins, nobody loses. Everybody blushes.'],
  drawbreak: ['{l}’s streak ends in a draw. Phew, {w}.', 'A draw stops the streak. Nobody is complaining.'],
};
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? '' : v[k]));

/**
 * The finale's moment line, chosen from the finished match so both phones pick the same.
 * `st` = the records as they stood before this match (null when this view didn't watch it end).
 */
function momentFor(s, first, name, st) {
  const win = s.win;
  const mode = modeOf(s);
  if (!win && !s.draw && s.n < COLS * ROWS) return '';
  if (!win) {
    const sit = st && st.streak >= 2 && st.who ? 'drawbreak' : 'draw';
    const t = MOMENTS[sit];
    const who = st && st.who;
    return fill(t[randInt(t.length, s.seed, 'moment', sit)], { w: who ? name(who) : '', l: who ? name(other(who)) : '' });
  }
  const w = win.who;
  const l = other(w);
  const wm = movesBy(s, w, first);
  const pre = st || null;
  const order = [];
  if (!win.gift && pre && pre.quick > 0 && wm < 100 - pre.quick) order.push('record');
  if (pre && pre.who === l && pre.streak >= 2) order.push('broke');
  if (pre && pre.who === w && pre.streak + 1 >= 3) order.push('streak');
  if (s.bl && s.bl[w] >= 2) order.push('comeback');
  if (!win.pop && s.n >= 36 && mode !== 'pop') order.push('photo');
  if (pre && pre.mw === 0 && mode !== 'classic') order.push('firstmode');
  if (wm <= 7 && !win.gift) order.push('rout');
  if (closeCalls(s, l) > 0) order.push('close');
  order.push('generic');
  const sit = order[0];
  const t = MOMENTS[sit];
  return fill(t[randInt(t.length, s.seed, 'moment', sit)], { w: name(w), l: name(l), m: wm, k: pre ? pre.streak + 1 : 1, b: s.bl ? s.bl[w] : 0, mode: MODES[mode].name });
}

const FIRST_GAME = ['First game of Four in a Row!', 'First game together here. Make it a good one.', 'Fresh board, no history. Be nice. Or don’t.'];
/** Rivalry strip: [tally line, flavour line] from the shared record. */
function rivalry(d, name, mode, seed) {
  const games = d.games_n || 0;
  if (!games) return [FIRST_GAME[randInt(FIRST_GAME.length, seed, 'riv')], ''];
  const wa = d.wins_a_n || 0;
  const wb = d.wins_b_n || 0;
  const dr = d.draws_n || 0;
  const tally = `${name('a')} ${wa} · ${name('b')} ${wb}${dr ? ` · ${dr} draw${dr === 1 ? '' : 's'}` : ''}`;
  let flavour = '';
  const inMode = (d[`${mode}_a_n`] || 0) + (d[`${mode}_b_n`] || 0);
  if (mode !== 'classic' && !inMode) flavour = `First game in ${MODES[mode].name}!`;
  else if ((d.streak || 0) >= 2 && d.streak_who) flavour = `${name(d.streak_who)} is on a ${d.streak}-game streak · break it?`;
  else if (d.quick_best && d.quick_best_who) flavour = `Fastest win: ${100 - d.quick_best} moves, ${name(d.quick_best_who)}.`;
  else if (dr && !wa && !wb) flavour = 'Perfectly even so far.';
  return [tally, flavour];
}

// ── geometry (SVG user units) ──
const U = 100; // one cell
const P = 16; // frame around the holes
const TOP = 92; // the lift row above the board
const BH = ROWS * U + 2 * P;
const BW = COLS * U + 2 * P;
const VW = BW + 10;
const VH = TOP + BH + 28;
const HOLE = 38;
const DISC = 42;
const LIFT_Y = TOP / 2;
const cx = (c) => P + c * U + U / 2;
const cy = (r) => TOP + P + (ROWS - 1 - r) * U + U / 2;
const pct = (v, of) => `${((v / of) * 100).toFixed(4)}%`;

function roundRect(x0, y0, x1, y1, R) {
  return `M${x0 + R} ${y0}H${x1 - R}A${R} ${R} 0 0 1 ${x1} ${y0 + R}V${y1 - R}A${R} ${R} 0 0 1 ${x1 - R} ${y1}H${x0 + R}A${R} ${R} 0 0 1 ${x0} ${y1 - R}V${y0 + R}A${R} ${R} 0 0 1 ${x0 + R} ${y0}Z`;
}
function facePath() {
  let d = roundRect(0, TOP, BW, TOP + BH, 26);
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) d += `M${cx(c) - HOLE} ${cy(r)}a${HOLE} ${HOLE} 0 1 0 ${2 * HOLE} 0a${HOLE} ${HOLE} 0 1 0 ${-2 * HOLE} 0Z`;
  }
  return d;
}
/** The torn-paper cap over the top three rows of column `c`, with the ghost sitting on it. */
function capSvg(c) {
  const x0 = P + c * U + 3;
  const x1 = P + (c + 1) * U - 3;
  const yb = TOP + P + (ROWS - GHOST_CAP) * U - 4;
  let d = `M${x0} ${TOP + 5}H${x1}V${yb}`;
  const steps = 8;
  for (let i = 1; i <= steps; i++) d += `L${(x1 - (i * (x1 - x0)) / steps).toFixed(1)} ${yb + (i % 2 ? 9 : -3)}`;
  d += 'Z';
  const gx = P + c * U + U / 2;
  const gy = TOP + P + 120;
  return `<path class="g4-cap" d="${d}"/>
    <g transform="translate(${gx} ${gy})"><path class="g4-ghost-body" d="M-28 30V-6a28 28 0 0 1 56 0V30l-9.3-8-9.4 8-9.3-8-9.4 8-9.3-8z"/><circle class="g4-ghost-eye" cx="-10" cy="-5" r="5"/><circle class="g4-ghost-eye" cx="10" cy="-5" r="5"/></g>
    <text class="g4-cap-t" x="${gx}" y="${TOP + P + 207}" text-anchor="middle">MAX 3</text>`;
}
const DISC_INNER = `<circle class="g4-d-body" r="${DISC}"/><circle class="g4-d-ring" r="27"/><circle class="g4-d-groove" r="22"/><circle class="g4-d-dot" r="9"/>`;
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, cls) => { const e = document.createElementNS(SVGNS, tag); if (cls) e.setAttribute('class', cls); return e; };
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── rules (pure, deterministic) ──
function applyMove(s, who, move) {
  // v2 setup: { setup: 2, mode } is legal once, as the very first move, from the first mover; it doesn't pass the turn
  if (move && move.setup !== undefined) {
    if (move.setup !== 2) throw new Error('Unknown setup');
    if (s.v || s.n > 0) throw new Error('The mode is picked before the first disc');
    if (who !== s.turn) throw new Error('Only the first player picks the mode');
    if (!isMode(move.mode)) throw new Error('Unknown mode');
    s.v = 2;
    s.mode = move.mode;
    s.mv = { a: 0, b: 0 };
    s.bl = { a: 0, b: 0 };
    if (move.mode === 'ghost') s.ghost = ghostFor(s.seed);
    return s;
  }
  if (move && move.pop !== undefined) {
    const pc = move.pop;
    if (s.v !== 2 || s.mode !== 'pop') throw new Error('Popping is only in PopOut');
    if (!Number.isInteger(pc) || pc < 0 || pc >= COLS) throw new Error('Pick one of the seven columns');
    if (who !== s.turn) throw new Error('Not your turn');
    if (s.cols[pc][0] !== who) throw new Error('You can only pop your own discs from the bottom row');
    s.cols[pc].shift();
    s.n++;
    s.mv[who]++;
    const mine = allRuns(s.cols, who);
    const theirs = allRuns(s.cols, other(who));
    // standard PopOut: both lined up four at once means the popper wins
    if (mine.length) s.win = { who, runs: mine, pop: true, ...(theirs.length ? { both: theirs } : {}) };
    else if (theirs.length) s.win = { who: other(who), runs: theirs, pop: true, gift: true };
    s.turn = other(who);
    if (!s.win) {
      if (s.n >= POP_MOVES) s.draw = 'long';
      else if (!canDrop(s) && !canPop(s, s.turn)) s.draw = 'stuck';
    }
    return s;
  }
  const col = move && move.col;
  if (!Number.isInteger(col) || col < 0 || col >= COLS) throw new Error('Pick one of the seven columns');
  if (who !== s.turn) throw new Error('Not your turn');
  if (s.cols[col].length >= capOf(s, col)) throw new Error(s.cols[col].length >= ROWS ? 'That column is full' : 'The ghost has that column. Three discs, no more');
  const r = s.cols[col].length;
  const blocked = s.v === 2 && runsThrough(s.cols, col, r, other(who)).length > 0; // would they have won in that hole?
  s.cols[col].push(who);
  s.n++;
  const runs = runsThrough(s.cols, col, r, who);
  if (runs.length) s.win = { who, runs };
  if (s.v === 2) {
    s.mv[who]++;
    if (blocked && !s.win) s.bl[who]++;
  }
  s.turn = other(who);
  if (s.v === 2 && !s.win) {
    if (s.mode === 'pop') {
      if (s.n >= POP_MOVES) s.draw = 'long';
      else if (!canDrop(s) && !canPop(s, s.turn)) s.draw = 'stuck';
    } else if (!canDrop(s)) s.draw = 'full';
  }
  return s;
}
function resultOf(s) {
  if (s.win) {
    // two runs can share a direction (both diagonals through one disc), so count runs, not directions
    const dir = s.win.runs[0].dir;
    let sub = s.win.runs.length > 1 ? 'Two lines with one disc!' : dir === 'across' ? 'Four across' : dir === 'down' ? 'Four stacked up' : 'Four on the diagonal';
    if (s.win.both) sub = 'Both made four. The popper takes it';
    else if (s.win.gift) sub = 'That pop gave the other side four';
    return { winner: s.win.who, sub };
  }
  if (s.draw === 'long') return { winner: null, text: 'Long game', sub: 'A hundred moves and no four. Call it a draw.' };
  if (s.draw === 'stuck') return { winner: null, text: 'No moves left', sub: 'Nothing left to drop or pop. It’s a draw.' };
  if (s.draw === 'full' && s.mode === 'ghost') return { winner: null, text: 'No drops left', sub: 'The ghost kept its column and nobody lined up four. It’s a draw.' };
  return { winner: null, text: 'Board full', sub: 'Nobody lined up four. It’s a draw.' };
}

registerGame({
  id: 'four',
  title: 'Four in a Row',
  blurb: 'Drop discs, or try Ghost Column and PopOut. Four before they do.',
  kind: 'turns',
  team: false,
  tags: ['quick'],
  platforms: ['phone', 'computer'],
  minutes: 5,
  endDelay: 1900,
  howTo: [
    'Tap a column to lift your disc over it. Tap it again to drop.',
    'Four in a row wins: across, up and down, or diagonal. A full board is a draw.',
    'Pick a mode before the first disc. Ghost Column caps one column at three. PopOut lets you pop your own bottom disc.',
    'Keys: 1–7, arrows or Tab to aim, Enter to drop, P to pop.',
  ],

  init: ({ first }) => ({ cols: Array.from({ length: COLS }, () => []), turn: first, n: 0, win: null }),
  next: (s) => (s.win || s.draw || (!s.v && s.n >= COLS * ROWS) ? [] : [s.turn]),
  apply: applyMove,
  result: resultOf,

  // ── view ──
  css: `
.g-four { --g4-chrome: 345px; --g4-ar: ${(VW / VH).toFixed(4)}; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 10px; padding: 4px 0 10px; user-select: none; -webkit-user-select: none; touch-action: manipulation; min-height: 0; }
.g-four .g4-bd { order: 0; display: flex; flex-direction: column; align-items: center; width: 100%; }
.g-four .g4-side { display: contents; }
.g-four .g4-top { order: 2; display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }
.g-four .g4-bottom { order: 1; display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
.g-four .g4-wrap { position: relative; width: max(180px, min(100%, 560px, calc((100vh - var(--g4-chrome)) * var(--g4-ar)))); width: max(180px, min(100%, 560px, calc((100dvh - var(--g4-chrome)) * var(--g4-ar)))); }
.g-four .g4-svg { display: block; width: 100%; height: auto; overflow: visible; }
.g-four .g4-edge { fill: var(--g-ink); }
.g-four .g4-foot { fill: var(--g-ink); }
.g-four .g4-back { fill: color-mix(in srgb, var(--g-ink) 9%, var(--g-bg)); }
.g-four .g4-face { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 2px; vector-effect: non-scaling-stroke; }
.g-four .g4-rule { fill: none; stroke: var(--g-ink); stroke-width: 1px; vector-effect: non-scaling-stroke; opacity: 0.35; }
.g-four .g4-board.thud { animation: g4-thud 190ms ease-out; }
@keyframes g4-thud { 0% { transform: translateY(0); } 35% { transform: translateY(5px); } 100% { transform: translateY(0); } }

.g-four .g4-cap { fill: color-mix(in srgb, var(--g-hl) 38%, var(--g-card)); stroke: var(--g-ink); stroke-width: 2px; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.g-four .g4-ghost-body { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 2.5px; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.g-four .g4-ghost-eye { fill: var(--g-ink); }
.g-four .g4-cap-t { fill: var(--g-ink); font: 400 21px var(--g-font-display); letter-spacing: 1px; }
.g-four .g4-capg.preview { opacity: 0.55; }

.g-four .g4-d-body { stroke: var(--g-ink); stroke-width: 2px; vector-effect: non-scaling-stroke; }
.g-four .g4-a .g4-d-body, .g-four .g4-chip.g4-a { fill: var(--p-a); background: var(--p-a); }
.g-four .g4-b .g4-d-body, .g-four .g4-chip.g4-b { fill: var(--p-b); background: var(--p-b); }
.g-four .g4-d-ring { fill: none; stroke: var(--g-ink); stroke-width: 4; opacity: 0.32; }
.g-four .g4-d-groove { fill: none; stroke: var(--g-on-ink); stroke-width: 3; opacity: 0.3; }
.g-four .g4-d-dot { fill: var(--g-on-ink); stroke: var(--g-ink); stroke-width: 2px; vector-effect: non-scaling-stroke; opacity: 0; transition: opacity 200ms; }
.g-four .g4-d.is-last .g4-d-dot { opacity: 1; }
.g-four .g4-fall { transition: opacity 400ms; }
.g-four .g4-fall.is-falling { animation: g4-fall 600ms linear both; }
@keyframes g4-fall {
  0% { transform: translateY(var(--dy)); animation-timing-function: cubic-bezier(0.5, 0, 1, 0.6); }
  62% { transform: translateY(0); animation-timing-function: cubic-bezier(0, 0.5, 0.5, 1); }
  77% { transform: translateY(-17px); animation-timing-function: cubic-bezier(0.5, 0, 1, 0.5); }
  89% { transform: translateY(0); animation-timing-function: cubic-bezier(0, 0.5, 0.5, 1); }
  95% { transform: translateY(-4px); animation-timing-function: ease-in; }
  100% { transform: translateY(0); }
}
.g-four .g4-fall.is-sliding { animation: g4-slide 300ms cubic-bezier(0.5, 0, 0.8, 0.6) both; }
@keyframes g4-slide { from { transform: translateY(-${U}px); } to { transform: none; } }
@keyframes g4-out { from { transform: translateY(0); opacity: 1; } to { transform: translateY(${U * 2 + 60}px); opacity: 0; } }
.g-four.is-won .g4-d:not(.is-win) .g4-fall { opacity: 0.38; }

.g-four.is-compact .g4-lift { display: none; }
.g-four .g4-lift { transition: transform 150ms cubic-bezier(0.3, 0.7, 0.4, 1); opacity: 0; pointer-events: none; }
.g-four .g4-lift.on { opacity: 1; }
.g-four .g4-lift.instant { transition: none; }
.g-four .g4-lift-shadow { fill: var(--g-ink); }
.g-four .g4-lift.on .g4-bob { animation: g4-pop 220ms cubic-bezier(0.3, 1.6, 0.5, 1) both, g4-bob 1.6s 220ms ease-in-out infinite; }
.g-four .g4-lift.on .g4-bob.shake { animation: g4-shake 360ms ease-out both; }
@keyframes g4-pop { from { transform: translateY(26px) scale(0.6); } to { transform: none; } }
@keyframes g4-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes g4-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-14px); } 40% { transform: translateX(12px); } 60% { transform: translateX(-8px); } 80% { transform: translateX(4px); } }
.g-four .g4-ghost { fill: none; stroke-width: 7; stroke-dasharray: 13 10; stroke-linecap: round; opacity: 0; transition: opacity 150ms; }
.g-four .g4-ghost.on { opacity: 1; animation: g4-spin 6s linear infinite; transform-box: fill-box; transform-origin: center; }
.g-four .g4-ghost.g4-a { stroke: var(--p-a); } .g-four .g4-ghost.g4-b { stroke: var(--p-b); }
@keyframes g4-spin { to { transform: rotate(360deg); } }
.g-four .g4-popring { fill: none; stroke: var(--g-ink); stroke-width: 6; stroke-dasharray: 9 9; stroke-linecap: round; opacity: 0; transition: opacity 150ms; }
.g-four .g4-popring.on { opacity: 0.55; }
.g-four .g4-popring.sel { opacity: 1; stroke-width: 10; stroke-dasharray: none; }

.g-four .g4-wr { transform-box: fill-box; transform-origin: center; animation: g4-ring 380ms cubic-bezier(0.3, 1.5, 0.5, 1) both; }
.g-four .g4-wr-ink { fill: none; stroke: var(--g-ink); stroke-width: 15; }
.g-four .g4-wr-hl { fill: none; stroke: var(--g-hl); stroke-width: 9; }
.g-four .g4-wr-o { fill: none; stroke: var(--g-ink); stroke-width: 6; stroke-dasharray: 10 8; opacity: 0.7; }
@keyframes g4-ring { from { transform: scale(0.4); opacity: 0; } to { transform: none; opacity: 1; } }
.g-four .g4-sk { fill: none; stroke-linecap: round; stroke-dasharray: 1 1; animation: g4-draw 420ms cubic-bezier(0.6, 0, 0.3, 1) both; }
.g-four .g4-sk-ink { stroke: var(--g-ink); stroke-width: 22; }
.g-four .g4-sk-hl { stroke: var(--g-hl); stroke-width: 13; }
@keyframes g4-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }

.g-four .g4-strip { position: absolute; top: 0; display: flex; left: ${pct(P, VW)}; width: ${pct(COLS * U, VW)}; height: ${pct(TOP + BH, VH)}; }
.g-four .g4-col { flex: 1; height: 100%; min-width: 0; margin: 0; padding: 0; border: 0; border-radius: 12px; background: transparent; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.g-four .g4-col:disabled { cursor: default; }
.g-four .g4-col:focus { outline: none; }
.g-four .g4-col:focus-visible { box-shadow: inset 0 0 0 3px var(--g-ink); }
.g-four .g4-guard { position: absolute; top: 0; left: ${pct(P, VW)}; width: ${pct(COLS * U, VW)}; height: ${pct(TOP + BH, VH)}; display: none; }
.g-four.is-locked:not(.is-over) .g4-guard { display: block; }
.g-four .g4-colhl { opacity: 0; transition: opacity 120ms; }
.g-four .g4-colhl.g4-a { fill: color-mix(in srgb, var(--p-a) 30%, var(--g-bg)); }
.g-four .g4-colhl.g4-b { fill: color-mix(in srgb, var(--p-b) 30%, var(--g-bg)); }
.g-four .g4-colhl.on { opacity: 1; }
.g-four .g4-nums { display: none; width: 100%; padding: 0 ${pct(VW - BW + P, VW)} 0 ${pct(P, VW)}; margin-top: -2px; }
.g-four .g4-nums span { flex: 1; text-align: center; font: 900 0.78rem/1 var(--g-font-display); color: var(--g-muted); }
.g-four .g4-nums span.on { color: var(--g-ink); }
@media (hover: hover) and (pointer: fine) { .g-four .g4-nums { display: flex; } }

.g-four .g4-stamp { position: absolute; transform: translate(-50%, -50%) rotate(-9deg); pointer-events: none; padding: 5px 12px; border: 3px solid var(--g-ink); border-radius: 8px; background: var(--g-hl); color: var(--g-on-ink); font: 900 clamp(1rem, 5vw, 1.5rem)/1 var(--g-font-display); box-shadow: var(--g-shadow); white-space: nowrap; animation: g4-stamp 1700ms ease-out both; }
@keyframes g4-stamp { 0% { transform: translate(-50%, -50%) rotate(-9deg) scale(1.9); opacity: 0; } 12% { transform: translate(-50%, -50%) rotate(-9deg) scale(1); opacity: 1; } 80% { opacity: 1; } 100% { transform: translate(-50%, -64%) rotate(-9deg); opacity: 0; } }

.g-four .g4-riv { display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: 100%; text-align: center; font: 800 0.86rem/1.25 var(--g-font-body); color: var(--g-ink); text-wrap: balance; }
.g-four .g4-riv .g4-riv-b { color: var(--g-muted); font-weight: 700; }
.g-four .g4-modes { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 100%; }
.g-four .g4-mc { min-height: 44px; padding: 6px 15px; font-size: 0.88rem; cursor: pointer; box-shadow: var(--g-shadow-sm); touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.g-four .g4-mc:active { transform: translate(2px, 2px); box-shadow: none; }
.g-four .g4-mc:focus-visible, .g-four .g4-act:focus-visible { outline: 3px solid var(--g-ink); outline-offset: 2px; }
.g-four .g4-mdesc { margin: 0; max-width: 34ch; text-align: center; font: 600 0.82rem/1.3 var(--g-font-body); color: var(--g-muted); text-wrap: balance; }
.g-four .g4-label { min-height: 28px; }
.g-four .g4-acts { display: flex; gap: 8px; }
.g-four .g4-act { min-height: 44px; min-width: 96px; justify-content: center; font-size: 0.9rem; cursor: pointer; box-shadow: var(--g-shadow-sm); touch-action: manipulation; }
.g-four .g4-moment { margin: 0; max-width: min(100%, 34ch); padding: 8px 14px; border: 2px solid var(--g-ink); border-radius: var(--g-radius); background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow); font: 900 0.9rem/1.25 var(--g-font-display); text-align: center; text-wrap: balance; transform: rotate(-1.5deg); opacity: 0; }
.g-four .g4-moment.show { animation: g4-moment 420ms cubic-bezier(0.3, 1.5, 0.5, 1) both; }
@keyframes g4-moment { from { transform: rotate(-1.5deg) scale(1.5); opacity: 0; } to { transform: rotate(-1.5deg); opacity: 1; } }
.g-four [hidden] { display: none !important; }

.g-four .g4-plate { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 16px 8px 10px; border-radius: 999px; background: var(--g-card); border: 2px solid var(--g-ink); box-shadow: var(--g-shadow); font: 900 0.98rem/1.2 var(--g-font-display); color: var(--g-ink); max-width: 100%; text-wrap: balance; }
.g-four .g4-plate.wait { color: var(--g-muted); border-color: var(--g-line); }
.g-four .g4-plate.pop { animation: g4-plate 260ms cubic-bezier(0.3, 1.5, 0.5, 1); }
@keyframes g4-plate { from { transform: scale(0.92); } to { transform: none; } }
.g-four .g4-chip { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--g-ink); box-shadow: inset 0 0 0 4px color-mix(in srgb, var(--g-ink) 22%, transparent); }
.g-four .g4-chip.none { background: transparent; border-style: dashed; box-shadow: none; }

@media (max-height: 720px) and (orientation: portrait) { .g-four { --g4-chrome: 314px; } }
@media (orientation: landscape) and (min-width: 560px) {
  .g-four { --g4-chrome: 175px; flex-direction: row; align-items: center; justify-content: center; gap: 18px; padding: 0; }
  .g-four .g4-bd { width: auto; flex: none; }
  .g-four .g4-wrap { width: max(160px, min(560px, calc((100vh - var(--g4-chrome)) * var(--g4-ar)))); width: max(160px, min(560px, calc((100dvh - var(--g4-chrome)) * var(--g4-ar)))); }
  .g-four .g4-side { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; flex: 1 1 0; min-width: 0; max-width: 340px; }
  .g-four .g4-top, .g-four .g4-bottom { order: 0; gap: 6px; }
}
@media (prefers-reduced-motion: reduce) {
  .g-four *, .g-four .g4-lift.on .g4-bob { animation: none !important; transition: none !important; }
  .g-four .g4-moment.show { opacity: 1; }
}
`,

  mount(el, api) {
    const store = api.data ? api : gameDataApi('four');
    const root = document.createElement('div');
    root.className = 'g-four';
    root.innerHTML = `
      <div class="g4-bd">
        <div class="g4-wrap">
          <svg class="g4-svg" viewBox="0 0 ${VW} ${VH}" aria-hidden="true">
            <g class="g4-board">
              <path class="g4-edge" d="${roundRect(0, TOP, BW, TOP + BH, 26)}" transform="translate(7 9)"/>
              <path class="g4-foot" d="M44 ${TOP + BH - 4}h104l-14 26h-76z"/>
              <path class="g4-foot" d="M${BW - 148} ${TOP + BH - 4}h104l-14 26h-76z"/>
              <rect class="g4-back" x="${P}" y="${TOP + P}" width="${COLS * U}" height="${ROWS * U}"/>
              <rect class="g4-colhl" x="0" y="${TOP + P}" width="${U}" height="${ROWS * U}"/>
              <g class="g4-discs"></g>
              <path class="g4-face" fill-rule="evenodd" d="${facePath()}"/>
              <path class="g4-rule" d="${roundRect(7, TOP + 7, BW - 7, TOP + BH - 7, 19)}"/>
              <g class="g4-capg"></g>
              <circle class="g4-ghost" r="${HOLE - 7}" cx="0" cy="0"/>
              <g class="g4-poprings">${Array.from({ length: COLS }, (_, c) => `<circle class="g4-popring" r="${HOLE - 4}" cx="${cx(c)}" cy="${cy(0)}"/>`).join('')}</g>
              <g class="g4-marks"></g>
            </g>
            <g class="g4-lift instant"><g class="g4-bob"><circle class="g4-lift-shadow" cx="6" cy="8" r="${DISC}"/>${DISC_INNER}</g></g>
          </svg>
          <div class="g4-strip" role="group" aria-label="Columns">
            ${Array.from({ length: COLS }, (_, c) => `<button type="button" class="g4-col" data-col="${c}" tabindex="${c === 3 ? 0 : -1}" aria-label="Column ${c + 1}"></button>`).join('')}
          </div>
          <div class="g4-guard" aria-hidden="true"></div>
        </div>
        <div class="g4-nums" aria-hidden="true">${Array.from({ length: COLS }, (_, c) => `<span>${c + 1}</span>`).join('')}</div>
      </div>
      <div class="g4-side">
        <div class="g4-top">
          <div class="g4-riv" hidden><span class="g4-riv-a"></span><span class="g4-riv-b"></span></div>
          <div class="g4-modes" role="radiogroup" aria-label="Mode" hidden>
            ${MODE_IDS.map((m) => `<button type="button" class="g-chip g4-mc" role="radio" data-mode="${m}" aria-checked="false">${MODES[m].name}</button>`).join('')}
          </div>
          <p class="g4-mdesc" hidden></p>
          <span class="g-chip is-hl g4-label" hidden></span>
        </div>
        <div class="g4-bottom">
          <div class="g4-plate" aria-live="polite"><span class="g4-chip"></span><span class="g4-plate-t"></span></div>
          <div class="g4-acts" role="group" aria-label="Your move" hidden>
            <button type="button" class="g-chip g4-act" data-act="drop" aria-pressed="true">Drop a disc</button>
            <button type="button" class="g-chip g4-act" data-act="pop" aria-pressed="false">Pop one out</button>
          </div>
          <p class="g4-moment" aria-live="polite" hidden></p>
        </div>
      </div>`;
    el.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const svg = $('.g4-svg');
    const wrap = $('.g4-wrap');
    const board = $('.g4-board');
    const discLayer = $('.g4-discs');
    const marks = $('.g4-marks');
    const ghost = $('.g4-ghost');
    const colhl = $('.g4-colhl');
    const liftG = $('.g4-lift');
    const bob = $('.g4-bob');
    const strip = $('.g4-strip');
    const guard = $('.g4-guard');
    const plate = $('.g4-plate');
    const capG = $('.g4-capg');
    const rivEl = $('.g4-riv');
    const modesEl = $('.g4-modes');
    const mdescEl = $('.g4-mdesc');
    const labelEl = $('.g4-label');
    const actsEl = $('.g4-acts');
    const momentEl = $('.g4-moment');
    const buttons = [...root.querySelectorAll('.g4-col')];
    const rings = [...root.querySelectorAll('.g4-popring')];
    const nums = [...root.querySelectorAll('.g4-nums span')];
    const modeBtns = [...root.querySelectorAll('.g4-mc')];

    let ctx = null;
    let seen = null; // moves count at the last update
    let overSeen = null; // was the match over at the last update
    let lifted = null; // column the disc hovers over
    let liftedBy = null; // 'tap' | 'hover' | 'key'
    let cursor = 3; // the keyboard cursor: the last column aimed or focused
    let act = 'drop'; // PopOut: 'drop' or 'pop'
    let selMode = isMode(store.data().mode) ? store.data().mode : 'classic';
    let lastPT = '';
    let plateText = '';
    let compact = false;
    let y0 = 0;
    let capKey = '';
    let momentFor0 = ''; // matchId whose moment line is set
    let cueAt = 0;
    const discEls = new Map();
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
    const fine = () => { try { return matchMedia('(hover: hover) and (pointer: fine)').matches; } catch { return false; } };
    const full = (col) => !ctx || ctx.state.cols[col].length >= capOf(ctx.state, col);
    const modeNow = () => (ctx && ctx.moves > 0 ? modeOf(ctx.state) : selMode);
    const popping = () => act === 'pop' && !!ctx && ctx.canMove && modeOf(ctx.state) === 'pop';

    // The lift row above the board is cropped away in short landscape windows (no room for it).
    const mq = (() => { try { return matchMedia('(orientation: landscape) and (max-height: 560px)'); } catch { return null; } })();
    function layout() {
      compact = !!(mq && mq.matches);
      root.classList.toggle('is-compact', compact);
      y0 = compact ? TOP - 12 : 0;
      svg.setAttribute('viewBox', `0 ${y0} ${VW} ${VH - y0}`);
      root.style.setProperty('--g4-ar', (VW / (VH - y0)).toFixed(4));
      for (const e of [strip, guard]) { e.style.height = pct(TOP + BH - y0, VH - y0); }
      if (ctx) renderLift(true);
    }
    const onMq = () => layout();
    try { mq && mq.addEventListener('change', onMq); } catch { /* old webviews */ }

    // ── board ──
    function renderCap() {
      const s = ctx.state;
      let g = null;
      let preview = false;
      if (s.v === 2 && s.mode === 'ghost') g = s.ghost;
      else if (ctx.moves === 0 && selMode === 'ghost' && ctx.canMove) { g = ghostFor(s.seed); preview = true; }
      const key = g == null ? '' : `${g}${preview ? 'p' : ''}`;
      if (key === capKey) return;
      capKey = key;
      capG.innerHTML = g == null ? '' : capSvg(g);
      capG.setAttribute('class', `g4-capg${preview ? ' preview' : ''}`);
    }

    function mkDisc(x, y, who, cls, dy, ms) {
      const g = svgEl('g', `g4-d g4-${who}`);
      g.dataset.who = who;
      g.setAttribute('transform', `translate(${cx(x)} ${cy(y)})`);
      const f = svgEl('g', 'g4-fall');
      f.innerHTML = DISC_INNER;
      if (cls) {
        if (dy != null) f.style.setProperty('--dy', `${dy}px`);
        if (ms) f.style.animationDuration = `${ms}ms`;
        f.classList.add(cls);
      }
      g.appendChild(f);
      return g;
    }
    function renderDiscs(c, anim) {
      const want = new Set();
      if (anim && anim.popCol != null) {
        for (const [k, g] of discEls) if (k.startsWith(`${anim.popCol}-`)) { g.remove(); discEls.delete(k); }
        const out = mkDisc(anim.popCol, 0, anim.who);
        out.firstChild.style.animation = `g4-out ${anim.ms}ms cubic-bezier(0.5, 0, 1, 0.6) both`;
        discLayer.appendChild(out);
        later(() => out.remove(), anim.ms + 60);
      }
      c.state.cols.forEach((stack, x) => stack.forEach((who, y) => {
        const k = `${x}-${y}`;
        want.add(k);
        let g = discEls.get(k);
        if (g && g.dataset.who !== who) { g.remove(); g = null; }
        if (!g) {
          if (anim && anim.key === k) g = mkDisc(x, y, who, 'is-falling', LIFT_Y - cy(y), anim.ms);
          else if (anim && anim.popCol === x) g = mkDisc(x, y, who, 'is-sliding', null, anim.ms);
          else g = mkDisc(x, y, who);
          discLayer.appendChild(g);
          discEls.set(k, g);
        }
      }));
      for (const [k, g] of discEls) if (!want.has(k)) { g.remove(); discEls.delete(k); }
      const lm = c.last && c.last.move;
      const lc = lm && lm.col != null ? lm.col : null;
      const lastK = lc != null && c.state.cols[lc] && c.state.cols[lc].length ? `${lc}-${c.state.cols[lc].length - 1}` : null;
      for (const [k, g] of discEls) g.classList.toggle('is-last', k === lastK && !c.over);
    }

    function renderWin(c, delay) {
      marks.innerHTML = '';
      root.classList.remove('is-won');
      for (const g of discEls.values()) g.classList.remove('is-win');
      const win = c.state.win;
      if (!win) return;
      const seenCells = new Set();
      let html = '';
      let i = 0;
      for (const run of win.runs) {
        for (const [x, y] of run.cells) {
          const k = `${x}-${y}`;
          if (seenCells.has(k)) continue;
          seenCells.add(k);
          const g = discEls.get(k);
          if (g) g.classList.add('is-win');
          html += `<g transform="translate(${cx(x)} ${cy(y)})"><g class="g4-wr" style="animation-delay:${delay + i * 110}ms"><circle class="g4-wr-ink" r="46"/><circle class="g4-wr-hl" r="46"/></g></g>`;
          i++;
        }
      }
      for (const run of win.runs) {
        const [a0, a1] = [run.cells[0], run.cells[run.cells.length - 1]];
        const d = `M${cx(a0[0])} ${cy(a0[1])}L${cx(a1[0])} ${cy(a1[1])}`;
        const st = `animation-delay:${delay + i * 110 + 60}ms`;
        html += `<path class="g4-sk g4-sk-ink" pathLength="1" d="${d}" style="${st}"/><path class="g4-sk g4-sk-hl" pathLength="1" d="${d}" style="${st}"/>`;
      }
      // PopOut: the other side lined up four too, but the popper wins. Show theirs dashed.
      for (const run of win.both || []) {
        for (const [x, y] of run.cells) if (!seenCells.has(`${x}-${y}`)) html += `<circle class="g4-wr-o" r="46" cx="${cx(x)}" cy="${cy(y)}"/>`;
      }
      marks.innerHTML = html;
      if (delay > 0) later(() => { root.classList.add('is-won'); api.sfx('good'); api.haptic(30); }, delay);
      else root.classList.add('is-won');
    }

    function stamp(text, x, y) {
      const s = document.createElement('div');
      s.className = 'g4-stamp';
      s.textContent = text;
      s.style.left = pct(Math.min(Math.max(cx(x), 190), VW - 190), VW); // keep the stamp on the board
      s.style.top = pct(cy(y) - y0, VH - y0);
      wrap.appendChild(s);
      later(() => s.remove(), 1750);
    }

    function renderLift(instant) {
      const c = ctx;
      if (!c) return;
      const on = lifted != null && c.canMove;
      const pop = popping();
      const who = c.actor || 'a';
      const showDisc = on && !pop;
      const jump = instant || !liftG.classList.contains('on');
      liftG.setAttribute('class', `g4-lift g4-${who}${showDisc ? ' on' : ''}${jump ? ' instant' : ''}`);
      if (showDisc) {
        liftG.style.transform = `translate(${cx(lifted)}px, ${LIFT_Y}px)`;
        // flush the jump, then let later column changes glide
        if (jump) { void liftG.getBoundingClientRect(); liftG.classList.remove('instant'); }
      }
      const canLand = on && !pop && !full(lifted);
      ghost.setAttribute('class', `g4-ghost${canLand ? ' on' : ''} g4-${who}`);
      if (canLand) { ghost.setAttribute('cx', cx(lifted)); ghost.setAttribute('cy', cy(c.state.cols[lifted].length)); }
      colhl.setAttribute('class', `g4-colhl g4-${who}${on ? ' on' : ''}`);
      if (on) colhl.setAttribute('x', P + lifted * U);
      rings.forEach((rg, i) => {
        const mine = pop && c.state.cols[i][0] === c.actor;
        rg.setAttribute('class', `g4-popring${mine ? ' on' : ''}${mine && on && i === lifted ? ' sel' : ''}`);
      });
      buttons.forEach((b, i) => { b.classList.toggle('is-lifted', on && i === lifted); b.setAttribute('aria-pressed', on && i === lifted ? 'true' : 'false'); });
      nums.forEach((n, i) => n.classList.toggle('on', on && i === lifted));
    }

    // ── words ──
    function plateWords() {
      const c = ctx;
      let who = c.actor;
      let text;
      let wait = false;
      const online = c.mode === 'online';
      const s = c.state;
      if (c.over) {
        const w = s.win && s.win.who;
        who = w || null;
        if (!w) text = resultOf(s).text === 'Board full' ? 'Board full. It’s a draw.' : `${resultOf(s).text}. It’s a draw.`;
        else if (s.win.both) text = `Two fours! ${api.name(w)} popped it`;
        else if (s.win.gift) text = `${api.name(w)} wins. That pop gave them four`;
        else text = `${api.name(w)} lined up four`;
      } else if (!c.canMove) {
        who = c.acts[0] || null;
        wait = true;
        text = c.moves === 0 ? `${api.name(who)} is picking a mode…` : `${api.name(who)}’s turn`;
      } else if (popping()) {
        text = lifted == null ? 'Pop: tap one of your bottom discs' : c.state.cols[lifted][0] !== c.actor ? 'Only your own bottom discs pop' : liftedBy === 'hover' ? 'Click to pop it out' : `Tap column ${lifted + 1} again to pop`;
      } else if (lifted == null) {
        const verb = fine() ? 'click' : 'tap';
        text = online ? `Your turn · ${verb} a column` : `${api.name(who)}, ${verb} a column`;
      } else if (full(lifted)) {
        text = s.v === 2 && s.mode === 'ghost' && s.ghost === lifted ? 'The ghost has that one. Pick another.' : 'That column is full. Pick another.';
      } else {
        text = liftedBy === 'hover' ? 'Click to drop' : liftedBy === 'key' ? 'Enter or Space to drop' : `Tap column ${lifted + 1} again to drop`;
      }
      return { who, wait, text };
    }
    function renderPlate() {
      if (!ctx) return;
      const { who, wait, text } = plateWords();
      $('.g4-chip').className = `g4-chip ${who ? 'g4-' + who : 'none'}`;
      plate.classList.toggle('wait', wait);
      if (text !== plateText) {
        plateText = text;
        $('.g4-plate-t').textContent = text;
      }
    }
    const popPlate = () => { plate.classList.remove('pop'); void plate.offsetWidth; plate.classList.add('pop'); };

    function renderTop() {
      const c = ctx;
      if (!c) return;
      const empty = c.moves === 0 && !c.over;
      const picking = empty && c.canMove;
      const [t1, t2] = rivalry(store.data(), api.name, modeNow(), c.matchId || c.state.seed);
      rivEl.hidden = !empty;
      $('.g4-riv-a').textContent = t1;
      $('.g4-riv-b').textContent = t2;
      $('.g4-riv-b').hidden = !t2;
      modesEl.hidden = !picking;
      mdescEl.hidden = !picking;
      mdescEl.textContent = MODES[selMode].desc;
      modeBtns.forEach((b) => { const on = b.dataset.mode === selMode; b.classList.toggle('is-hl', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      const m = modeOf(c.state);
      const showLabel = c.moves > 0 && m !== 'classic';
      labelEl.hidden = !showLabel;
      if (showLabel) labelEl.textContent = MODES[m].name;
      const canAct = c.canMove && m === 'pop' && c.moves > 0;
      actsEl.hidden = !canAct;
      actsEl.querySelectorAll('.g4-act').forEach((b) => b.setAttribute('aria-pressed', b.dataset.act === act ? 'true' : 'false'));
      actsEl.querySelectorAll('.g4-act').forEach((b) => b.classList.toggle('is-hl', b.dataset.act === act));
    }

    // ── input ──
    function setRoving(col) {
      cursor = col;
      buttons.forEach((b, i) => b.setAttribute('tabindex', i === col ? '0' : '-1'));
    }
    function lift(col, by) {
      if (!ctx || !ctx.canMove || col < 0 || col >= COLS) return;
      const was = lifted;
      lifted = col;
      liftedBy = by;
      setRoving(col);
      if (was !== col && by !== 'hover') { api.sfx('tap'); api.haptic(8); }
      renderLift(false);
      renderPlate();
      if (was == null && by !== 'hover') popPlate();
    }
    function unlift() {
      if (lifted == null) return;
      lifted = null;
      liftedBy = null;
      renderLift(true);
      renderPlate();
    }
    function shake() {
      bob.classList.remove('shake'); void bob.getBoundingClientRect(); bob.classList.add('shake');
      later(() => bob.classList.remove('shake'), 400);
    }
    function setAct(next) {
      if (!ctx || !ctx.canMove) return;
      act = next;
      renderLift(true);
      renderPlate();
      renderTop();
    }
    function drop(col) {
      if (!ctx || !ctx.canMove) return;
      const pop = popping();
      if (pop && ctx.state.cols[col][0] !== ctx.actor) {
        api.toast('Only your own discs on the bottom row can pop.');
        api.sfx('bad');
        shake();
        if (lifted !== col) lift(col, liftedBy || 'tap');
        return;
      }
      if (ctx.moves === 0 && !ctx.state.v) {
        // new matches always start with the mode, then the first disc
        const s = api.move({ setup: 2, mode: selMode });
        if (!s.ok) { api.toast(s.error); api.sfx('bad'); return; }
      }
      const r = api.move(pop ? { pop: col } : { col });
      if (!r.ok) {
        api.toast(r.error);
        api.sfx('bad');
        api.haptic(40);
        if (lifted !== col) lift(col, liftedBy || 'tap');
        shake();
      }
    }
    // a tap on a locked board: a gentle cue, never a move
    function cue() {
      if (!ctx || ctx.canMove || ctx.over) return;
      popPlate();
      const now = Date.now();
      if (now - cueAt < 1400) return;
      cueAt = now;
      const who = ctx.acts[0];
      api.toast(ctx.moves === 0 ? `${api.name(who)} is picking a mode…` : `${api.name(who)}’s turn`);
    }
    guard.addEventListener('pointerdown', cue);
    guard.addEventListener('click', cue);

    // a touch lifts then drops; a mouse previews on hover and drops on click
    strip.addEventListener('pointerdown', (e) => { lastPT = e.pointerType || ''; });
    strip.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !ctx || !ctx.canMove) return;
      const b = e.target.closest('.g4-col');
      if (b) lift(Number(b.dataset.col), 'hover');
    });
    strip.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && liftedBy === 'hover') unlift(); });
    strip.addEventListener('click', (e) => {
      const b = e.target.closest('.g4-col');
      if (!b || !ctx || !ctx.canMove) return;
      if (e.detail === 0 && !lastPT) return; // a keyboard click: the key handler already did it
      const col = Number(b.dataset.col);
      const pt = e.pointerType || lastPT || 'touch';
      lastPT = '';
      if (pt === 'mouse' || lifted === col) drop(col);
      else lift(col, 'tap');
    });
    // Tab onto a column previews it
    strip.addEventListener('focusin', (e) => {
      const b = e.target.closest && e.target.closest('.g4-col');
      if (!b || !ctx || !ctx.canMove) return;
      const col = Number(b.dataset.col);
      setRoving(col);
      let kb = false;
      try { kb = b.matches(':focus-visible'); } catch { /* old webviews */ }
      if (kb && lifted !== col) lift(col, 'key');
    });
    modesEl.addEventListener('click', (e) => {
      const b = e.target.closest('.g4-mc');
      if (!b || !ctx || !ctx.canMove || ctx.moves > 0) return;
      selMode = b.dataset.mode;
      store.setData({ mode: selMode });
      api.sfx('tap');
      renderCap();
      renderTop();
    });
    actsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.g4-act');
      if (!b) return;
      api.sfx('tap');
      setAct(b.dataset.act);
    });
    const focusedCol = () => {
      const t = document.activeElement;
      return t && t.classList && t.classList.contains('g4-col') && root.contains(t) ? Number(t.dataset.col) : null;
    };
    const aim = (col) => { lift(col, 'key'); try { buttons[col].focus({ preventScroll: true }); } catch { /* fine */ } };
    const onKey = (e) => {
      if (!ctx || !ctx.canMove || !root.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('#game-root .gm-sheet:not([hidden]), #game-root .gm-end:not([hidden])')) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const foreignButton = t && t.closest && t.closest('button, a') && !root.contains(t);
      const ownButton = t && t.closest && t.closest('.g4-mc, .g4-act');
      if (/^[1-7]$/.test(e.key)) { e.preventDefault(); aim(Number(e.key) - 1); return; }
      if ((e.key === 'p' || e.key === 'P') && modeOf(ctx.state) === 'pop' && ctx.moves > 0) { e.preventDefault(); setAct(act === 'pop' ? 'drop' : 'pop'); return; }
      if (ownButton) return; // Enter / Space on a chip works the chip
      const fc = focusedCol();
      const from = fc != null ? fc : lifted != null ? lifted : null;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const d = e.key === 'ArrowLeft' ? -1 : 1;
        aim(from == null ? cursor : Math.max(0, Math.min(COLS - 1, from + d)));
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') && !foreignButton) {
        e.preventDefault();
        const col = from != null ? from : cursor;
        if (lifted === col) drop(col);
        else aim(col);
      }
    };
    document.addEventListener('keydown', onKey);
    // Escape puts a lifted disc away first. Core closes the game on Escape unless it was handled, and its
    // listener is registered earlier, so this one runs in the capture phase. With nothing lifted Esc closes as before.
    const onEsc = (e) => {
      if (e.key !== 'Escape' || lifted == null || !ctx || !ctx.canMove || !root.isConnected) return;
      if (document.querySelector('#game-root .gm-sheet:not([hidden]), #game-root .gm-end:not([hidden]), .sheet-wrap')) return;
      e.preventDefault();
      unlift();
    };
    document.addEventListener('keydown', onEsc, true);
    const offData = (() => { try { return store.onData(() => { if (ctx) renderTop(); }); } catch { return null; } })();
    layout();

    // ── records: count a match once, when this view watched it end ──
    function countMatch(c) {
      const d = store.data();
      const s = c.state;
      const w = s.win ? s.win.who : null;
      const mode = modeOf(s);
      if (d.last_id === c.matchId) { // the other phone counted it first: read what it saw before
        return { streak: d.p_streak || 0, who: d.p_streak_who || '', quick: d.p_quick || 0, mw: d.p_mw || 0 };
      }
      const pre = { streak: d.streak || 0, who: d.streak_who || '', quick: d.quick_best || 0, mw: w ? d[`${mode}_${w}_n`] || 0 : 0 };
      const patch = { last_id: c.matchId, games_n: (d.games_n || 0) + 1, p_streak: pre.streak, p_streak_who: pre.who, p_quick: pre.quick, p_mw: pre.mw };
      if (!w) {
        patch.draws_n = (d.draws_n || 0) + 1;
        patch.streak = 0;
        patch.streak_who = '';
      } else {
        const k = pre.who === w ? pre.streak + 1 : 1;
        patch.streak = k;
        patch.streak_who = w;
        if (k > (d.streak_best || 0)) { patch.streak_best = k; patch.streak_best_who = w; }
        patch[`wins_${w}_n`] = (d[`wins_${w}_n`] || 0) + 1;
        patch[`${mode}_${w}_n`] = pre.mw + 1;
        const q = 100 - movesBy(s, w, c.first);
        if (!(s.win && s.win.gift) && q > pre.quick) { patch.quick_best = q; patch.quick_best_who = w; }
        if (s.bl && s.bl[w] >= 2) patch[`comeback_${w}_n`] = (d[`comeback_${w}_n`] || 0) + 1;
      }
      store.setData(patch);
      return pre;
    }

    return {
      update(c) {
        const prevSeen = seen;
        const wasOver = overSeen;
        ctx = c;
        seen = c.moves;
        overSeen = c.over;
        const moved = prevSeen !== c.moves;
        const lm = c.last && c.last.move;
        const isDrop = !!lm && lm.col !== undefined;
        const isPop = !!lm && lm.pop !== undefined;
        // a new move since the last paint: animate it. On first paint, replay the partner's last move.
        const animate = !!(isDrop || isPop) && (prevSeen == null ? c.mode === 'online' && c.last.who !== c.me : c.moves > prevSeen && c.moves <= prevSeen + 2);
        let landMs = 0;
        let anim = null;
        if (animate && isDrop) {
          const col = lm.col;
          const row = c.state.cols[col].length - 1;
          const ms = reduced() ? 0 : Math.round(330 + (ROWS - row) * 55);
          anim = reduced() ? null : { key: `${col}-${row}`, ms };
          landMs = Math.round(ms * 0.62);
          later(() => {
            api.sfx('place');
            api.haptic(16);
            if (!reduced()) { board.classList.remove('thud'); void board.getBoundingClientRect(); board.classList.add('thud'); }
          }, landMs);
          // dropped into the hole the other side needed: stamp it
          const won = c.state.win && c.state.win.who === c.last.who;
          if (!won && c.prev && runsThrough(c.state.cols, col, row, other(c.last.who)).length) {
            later(() => { stamp('Blocked!', col, row); api.sfx('hit'); }, landMs + 60);
          }
        } else if (animate && isPop) {
          const ms = reduced() ? 0 : 420;
          anim = reduced() ? null : { popCol: lm.pop, who: c.last.who, ms };
          landMs = Math.round(ms * 0.5);
          later(() => { api.sfx('pop'); api.haptic(16); }, 60);
        }
        if (moved || !c.canMove) { lifted = null; liftedBy = null; act = 'drop'; }
        renderCap();
        renderDiscs(c, anim);
        renderWin(c, c.over && animate ? landMs + 220 : 0);
        buttons.forEach((b, i) => {
          b.disabled = !c.canMove;
          const cap = capOf(c.state, i);
          b.setAttribute('aria-label', `Column ${i + 1}${c.state.cols[i].length >= cap ? ', full' : ''}${cap < ROWS ? ', capped by the ghost' : ''}`);
        });
        root.classList.toggle('is-locked', !c.canMove);
        root.classList.toggle('is-over', c.over);
        renderLift(true);
        renderTop();
        renderPlate();
        if (moved && prevSeen != null) popPlate();
        // the finale's moment line (and the books, if this view saw it end)
        if (c.over) {
          if (momentFor0 !== c.matchId) {
            momentFor0 = c.matchId;
            const st = prevSeen != null && wasOver === false ? countMatch(c) : null;
            const text = momentFor(c.state, c.first, api.name, st);
            momentEl.textContent = text;
            momentEl.hidden = !text;
            momentEl.classList.remove('show');
            if (text) later(() => momentEl.classList.add('show'), animate ? landMs + 1000 : 0);
          }
        } else if (momentFor0) {
          momentFor0 = '';
          momentEl.hidden = true;
          momentEl.classList.remove('show');
        }
      },
      destroy() {
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('keydown', onEsc, true);
        try { mq && mq.removeEventListener('change', onMq); } catch { /* fine */ }
        try { offData && offData(); } catch { /* fine */ }
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
