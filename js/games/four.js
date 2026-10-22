// Four in a Row: 7 columns × 6 rows with gravity. Tap a column to lift your disc over it,
// tap the same column again to drop it (a mouse drops on click, keys 1–7 / arrows / Tab + Enter).
// Four in a line wins; a full board is a draw.
//
// Modes (v2, chosen by a setup move before the first disc, see docs/games/four.md):
//   classic  the original rules
//   ghost    Ghost Column: a seeded non-centre column is capped at three discs
//   pop      PopOut: instead of dropping, pop one of your own bottom-row discs out
//   blockers Blockers: three seeded neutral stones ('x') sit on the floor; they fill space but never make a line
import { registerGame, randInt, shuffled, gameDataApi } from './core.js';

const COLS = 7;
const ROWS = 6;
const other = (w) => (w === 'a' ? 'b' : 'a');
const DIRS = [[1, 0, 'across'], [0, 1, 'down'], [1, 1, 'diag'], [1, -1, 'diag']];

const MODES = {
  classic: { name: 'Classic', desc: 'The original. First to line up four.' },
  ghost: { name: 'Ghost Column', desc: 'A ghost caps one column at three discs.' },
  pop: { name: 'PopOut', desc: 'Or pop your own bottom disc out.' },
  blockers: { name: 'Blockers', desc: 'Three stones sit on the floor. Nobody owns them.' },
};
const MODE_IDS = ['classic', 'ghost', 'pop', 'blockers'];
const CHIP_NAMES = { classic: 'Classic', ghost: 'Ghost', pop: 'PopOut', blockers: 'Blockers' }; // short, so four chips fit one row at 360 px
const isMode = (m) => typeof m === 'string' && Object.prototype.hasOwnProperty.call(MODES, m);
const GHOST_COLS = [0, 1, 2, 4, 5, 6];
const GHOST_CAP = 3;
const POP_MOVES = 100; // PopOut can go round forever: a hundred moves with no four is a draw
const ghostFor = (seed) => GHOST_COLS[randInt(GHOST_COLS.length, seed, 'ghost')];
const STONES = 3;
/** Blockers: three distinct non-centre columns, sorted, from the match seed. */
const stonesFor = (seed) => shuffled(GHOST_COLS, `${seed}:stones`).slice(0, STONES).sort((p, q) => p - q);
/** How many holes the board has in this match. */
const slotsOf = (s) => COLS * ROWS - (s.v === 2 && s.mode === 'ghost' ? ROWS - GHOST_CAP : 0) - (s.stones ? s.stones.length : 0);
const modeOf = (s) => (s && s.v === 2 && isMode(s.mode) ? s.mode : 'classic');
const capOf = (s, c) => (s.v === 2 && s.mode === 'ghost' && s.ghost === c ? GHOST_CAP : ROWS);
const canDrop = (s) => s.cols.some((stack, c) => stack.length < capOf(s, c));
const canPop = (s, w) => s.cols.some((stack) => stack[0] === w);
/** How many different drops would win right now for `who` (the cell itself is not read, so this works before and after a drop). */
function dropWins(s, who) {
  let n = 0;
  for (let c = 0; c < COLS; c++) {
    const r = s.cols[c].length;
    if (r < capOf(s, c) && runsThrough(s.cols, c, r, who).length) n++;
  }
  return n;
}
/** A drop that leaves its player two or more winning drops (a fork), from a position that had fewer, with nothing for the other side to win with at once. */
const setTrap = (before, after, who) => dropWins(after, who) >= 2 && dropWins(before, who) < 2 && dropWins(after, other(who)) === 0;

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
  trap: ['{w} set a trap {l} couldn’t escape.', 'Two threats at once. {l} could only watch.', 'A fork! {w} saw it coming. Probably.', '{w} built a double threat and cashed it in.', '{l} blocked one. {w} took the other.'],
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
  if (s.tr && s.tr[w] > 0 && !win.gift) order.push('trap');
  if (pre && pre.who === l && pre.streak >= 2) order.push('broke');
  if (pre && pre.who === w && pre.streak + 1 >= 3) order.push('streak');
  if (s.bl && s.bl[w] >= 2) order.push('comeback');
  if (!win.pop && s.n >= slotsOf(s) - 6 && mode !== 'pop') order.push('photo');
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
  else if ((d.trap_a_n || 0) + (d.trap_b_n || 0) >= 2) flavour = `Traps set: ${name('a')} ${d.trap_a_n || 0} · ${name('b')} ${d.trap_b_n || 0}`;
  else if (dr && !wa && !wb) flavour = 'Perfectly even so far.';
  return [tally, flavour];
}

/** The series line under the moment: totals and the streak after this match. `st` = records before it, or `post` = records after it. */
function ledgerLine(name, st, s, post) {
  let wa; let wb; let dr; let k; let who;
  if (post) { wa = post.wins_a_n || 0; wb = post.wins_b_n || 0; dr = post.draws_n || 0; k = post.streak || 0; who = post.streak_who || ''; }
  else {
    const w = s.win ? s.win.who : null;
    wa = st.wa + (w === 'a' ? 1 : 0); wb = st.wb + (w === 'b' ? 1 : 0); dr = st.dr + (w ? 0 : 1);
    k = w ? (st.who === w ? st.streak + 1 : 1) : 0; who = w || '';
  }
  return `Series: ${name('a')} ${wa} · ${name('b')} ${wb}${dr ? ` · ${dr} draw${dr === 1 ? '' : 's'}` : ''}${k >= 2 && who ? ` · ${name(who)} on ${k}` : ''}`;
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
    <text class="g4-cap-t g4-reg-b" x="${gx + 1.6}" y="${TOP + P + 208}" text-anchor="middle">MAX 3</text><text class="g4-cap-t g4-reg-a" x="${gx - 1.2}" y="${TOP + P + 206.4}" text-anchor="middle">MAX 3</text><text class="g4-cap-t" x="${gx}" y="${TOP + P + 207}" text-anchor="middle">MAX 3</text>`;
}
// The pieces are plain HTML boxes (so the fall, squash and shake run on the compositor) wrapping a tiny static SVG.
// The ink fill is printed a hair off the black outline, like a second plate that is slightly out of register.
const STONE_INNER = `<circle class="g4-st-fill" r="${DISC}" cx="-1.4" cy="-1"/><circle class="g4-st-body" r="${DISC}"/><path class="g4-st-crack" d="M8 -6L14 2L6 8L12 18"/><path class="g4-st-crack" d="M-20 -14A28 28 0 0 1 -4 -24"/>`;
const DISC_INNER = `<circle class="g4-d-fill" r="${DISC}" cx="-1.4" cy="-1"/><circle class="g4-d-body" r="${DISC}"/><circle class="g4-d-ring" r="27"/><circle class="g4-d-groove" r="22"/><circle class="g4-d-dot" r="9"/>`;
const discSvg = (inner) => `<svg class="g4-ds" viewBox="-${DISC} -${DISC} ${2 * DISC} ${2 * DISC}" aria-hidden="true">${inner}</svg>`;
/** Position of a piece-sized box centred on a cell, as percentages of the board stage. */
const boxAt = (x, y) => `left:${pct(cx(x) - DISC, VW)};top:${pct(cy(y) - DISC, VH)}`;
/** translate() that puts a piece-sized box (placed at 0,0) on a point, in percent of its own size, so it scales with the board. */
const slide = (px, py) => `translate(${(((px - DISC) / (2 * DISC)) * 100).toFixed(3)}%, ${(((py - DISC) / (2 * DISC)) * 100).toFixed(3)}%)`;
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
    s.tr = { a: 0, b: 0 };
    if (move.mode === 'ghost') s.ghost = ghostFor(s.seed);
    if (move.mode === 'blockers') { s.stones = stonesFor(s.seed); for (const c of s.stones) s.cols[c].push('x'); }
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
  const before = s.v === 2 ? clone(s) : null;
  s.cols[col].push(who);
  s.n++;
  const runs = runsThrough(s.cols, col, r, who);
  if (runs.length) s.win = { who, runs };
  if (s.v === 2) {
    s.mv[who]++;
    if (blocked && !s.win) s.bl[who]++;
    if (s.tr && !s.win && setTrap(before, s, who)) s.tr[who]++;
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
.g-four { --g4-chrome: 360px; --g4-ar: ${(VW / VH).toFixed(4)}; --g4-y0r: 0; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 10px; padding: 4px 0 10px; user-select: none; -webkit-user-select: none; touch-action: manipulation; min-height: 0; }
.g-four .g4-bd { order: 0; display: flex; flex-direction: column; align-items: center; width: 100%; }
.g-four .g4-side { display: contents; }
.g-four .g4-top { order: 2; display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }
.g-four .g4-bottom { order: 1; display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
.g-four .g4-wrap { position: relative; aspect-ratio: var(--g4-ar); width: max(180px, min(100%, 560px, calc((100vh - var(--g4-chrome)) * var(--g4-ar)))); width: max(180px, min(100%, 560px, calc((100dvh - var(--g4-chrome)) * var(--g4-ar)))); }
/* The stage is the whole drawing (lift row, board, feet) at one fixed aspect ratio, so every layer inside is placed in percent
   and nothing is measured. The compact landscape crop just slides it up. */
.g-four .g4-stage { position: absolute; left: 0; top: 0; width: 100%; aspect-ratio: ${(VW / VH).toFixed(5)}; transform: translateY(calc(var(--g4-y0r) * -100%)); contain: layout style; }
.g-four .g4-board, .g-four .g4-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.g-four .g4-svg { display: block; overflow: visible; pointer-events: none; }
.g-four .g4-edge { fill: var(--g-ink); }
.g-four .g4-foot { fill: var(--g-ink); }
.g-four .g4-back { fill: color-mix(in srgb, var(--g-ink) 9%, var(--g-bg)); }
.g-four .g4-face { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 2px; vector-effect: non-scaling-stroke; }
.g-four .g4-face-reg { fill: none; stroke: var(--p-b); stroke-width: 2px; vector-effect: non-scaling-stroke; opacity: 0.7; transform: translate(1.6px, 1.1px); }
.g-four .g4-rule { fill: none; stroke: var(--g-ink); stroke-width: 1px; vector-effect: non-scaling-stroke; opacity: 0.35; }
/* paper tooth over the card stock of the frame (masked to the frame's own shape, holes included) and a halftone behind the holes */
.g-four .g4-facegrain { position: absolute; inset: 0; pointer-events: none; background: var(--g-grain) 0 0 / var(--g-grain-size); -webkit-mask: var(--g4-mask) 0 0 / 100% 100% no-repeat; mask: var(--g4-mask) 0 0 / 100% 100% no-repeat; }
.g-four .g4-half { position: absolute; pointer-events: none; left: ${pct(P, VW)}; top: ${pct(TOP + P, VH)}; width: ${pct(COLS * U, VW)}; height: ${pct(ROWS * U, VH)}; background: var(--g-halftone) 0 0 / 5px 5px; }

.g-four .g4-cap { fill: color-mix(in srgb, var(--g-hl) 38%, var(--g-card)); stroke: var(--g-ink); stroke-width: 2px; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.g-four .g4-ghost-body { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 2.5px; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.g-four .g4-ghost-eye { fill: var(--g-ink); }
.g-four .g4-cap-t { fill: var(--g-ink); font: 400 21px var(--g-font-display); letter-spacing: 1px; }
.g-four .g4-cap-t.g4-reg-a { fill: var(--p-a); opacity: 0.75; } .g-four .g4-cap-t.g4-reg-b { fill: var(--p-b); opacity: 0.75; }
.g-four .g4-capg.preview { opacity: 0.55; }

/* ── pieces: HTML boxes, so every motion below is transform / opacity on the compositor ── */
.g-four .g4-d, .g-four .g4-lift, .g-four .g4-ghost { position: absolute; width: ${pct(2 * DISC, VW)}; height: ${pct(2 * DISC, VH)}; }
.g-four .g4-d { pointer-events: none; }
.g-four .g4-fall, .g-four .g4-sq, .g-four .g4-bob, .g-four .g4-shk { position: relative; width: 100%; height: 100%; }
.g-four .g4-sq, .g-four .g4-bob { transform-origin: 50% 100%; }
.g-four .g4-ds { position: relative; display: block; width: 100%; height: 100%; overflow: visible; }
.g-four .g4-d-body { fill: none; stroke: var(--g-ink); stroke-width: 2px; vector-effect: non-scaling-stroke; }
.g-four .g4-a .g4-d-fill, .g-four .g4-chip.g4-a { fill: var(--p-a); background: var(--p-a); }
.g-four .g4-b .g4-d-fill, .g-four .g4-chip.g4-b { fill: var(--p-b); background: var(--p-b); }
.g-four .g4-d-ring { fill: none; stroke: var(--g-ink); stroke-width: 4; opacity: 0.32; }
.g-four .g4-d-groove { fill: none; stroke: var(--g-on-ink); stroke-width: 3; opacity: 0.3; }
.g-four .g4-d-dot { fill: var(--g-on-ink); stroke: var(--g-ink); stroke-width: 2px; vector-effect: non-scaling-stroke; opacity: 0; }
.g-four .g4-d.is-last .g4-d-dot { opacity: 1; }
/* the ink: paper tooth over the whole disc, and a halftone crescent for the shaded side */
.g-four .g4-sq::before, .g-four .g4-bob::before { content: ''; position: absolute; z-index: 1; inset: 1%; border-radius: 50%; pointer-events: none; background: var(--g-grain) 0 0 / var(--g-grain-size); }
.g-four .g4-sq::after, .g-four .g4-bob::after { content: ''; position: absolute; z-index: 1; inset: 1%; border-radius: 50%; pointer-events: none; background: var(--g-halftone) 0 0 / 5px 5px; -webkit-mask-image: radial-gradient(circle at 34% 30%, transparent 46%, #000 78%); mask-image: radial-gradient(circle at 34% 30%, transparent 46%, #000 78%); }
.g-four .g4-x .g4-sq::before, .g-four .g4-x .g4-sq::after { display: none; }
.g-four .g4-fall { transition: opacity 400ms; }
.g-four .g4-fall.is-falling { animation: g4-drop var(--fm, 400ms) cubic-bezier(0.55, 0.02, 0.9, 0.55) both; }
.g-four .g4-fall.is-falling > .g4-sq { animation: g4-land 380ms var(--fm, 400ms) both; }
/* gravity (ease-in), then the disc squashes into the board, hops, and settles */
@keyframes g4-drop { from { transform: translateY(calc(var(--dyr, 6) * -100%)); } to { transform: none; } }
@keyframes g4-land {
  0% { transform: scale(1.14, 0.8); animation-timing-function: cubic-bezier(0.2, 0.8, 0.3, 1); }
  30% { transform: translateY(-14%) scale(0.96, 1.06); animation-timing-function: cubic-bezier(0.6, 0, 0.9, 0.5); }
  58% { transform: scale(1.06, 0.93); animation-timing-function: ease-out; }
  78% { transform: translateY(-3%) scale(0.99, 1.01); animation-timing-function: ease-in; }
  100% { transform: none; }
}
.g-four .g4-fall.is-sliding { animation: g4-slide 300ms cubic-bezier(0.5, 0, 0.8, 0.6) both; }
@keyframes g4-slide { from { transform: translateY(-119%); } to { transform: none; } }
@keyframes g4-out { from { transform: translateY(0) rotate(0); opacity: 1; } to { transform: translateY(330%) rotate(24deg); opacity: 0; } }
.g-four.is-won .g4-d:not(.is-win) .g4-fall { opacity: 0.38; }
.g-four.is-won .g4-d.is-win .g4-sq { animation: g4-hop 560ms var(--wd, 0ms) both; }
@keyframes g4-hop { 0% { transform: none; } 24% { transform: scale(1.1, 0.88); } 50% { transform: translateY(-16%) scale(0.96, 1.06); } 78% { transform: scale(1.04, 0.96); } 100% { transform: none; } }

.g-four.is-compact .g4-lift { display: none; }
.g-four .g4-lift { left: 0; top: 0; transition: transform 150ms cubic-bezier(0.3, 0.7, 0.4, 1); opacity: 0; pointer-events: none; }
.g-four .g4-lift.on { opacity: 1; }
.g-four .g4-lift.instant { transition: none; }
.g-four .g4-lift-shadow { fill: var(--g-ink); }
.g-four .g4-lift .g4-ds { overflow: visible; }
.g-four .g4-lift.on .g4-bob { animation: g4-pop 220ms cubic-bezier(0.3, 1.6, 0.5, 1) both, g4-bob 1.6s 220ms ease-in-out infinite; }
@keyframes g4-pop { from { transform: translateY(54%) scale(0.6); } to { transform: none; } }
@keyframes g4-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7%); } }
.g-four .g4-ghost { left: 0; top: 0; opacity: 0; transition: opacity 150ms; pointer-events: none; }
.g-four .g4-ghost.on { opacity: 1; }
.g-four .g4-ghost svg { display: block; width: 100%; height: 100%; overflow: visible; }
.g-four .g4-ghost circle { fill: none; stroke-width: 7; stroke-dasharray: 13 10; stroke-linecap: round; }
.g-four .g4-ghost.on svg { animation: g4-spin 6s linear infinite; }
.g-four .g4-ghost.g4-a circle { stroke: var(--p-a); } .g-four .g4-ghost.g4-b circle { stroke: var(--p-b); }
@keyframes g4-spin { to { transform: rotate(360deg); } }
.g-four .g4-popring { fill: none; stroke: var(--g-ink); stroke-width: 6; stroke-dasharray: 9 9; stroke-linecap: round; opacity: 0; }
.g-four .g4-popring.on { opacity: 0.55; }
.g-four .g4-popring.sel { opacity: 1; stroke-width: 10; stroke-dasharray: none; }

/* the finale: a ring stamped on each winning disc, then the line inked through them */
.g-four .g4-marks { position: absolute; inset: 0; pointer-events: none; }
.g-four .g4-wr { position: absolute; width: ${pct(2 * DISC, VW)}; height: ${pct(2 * DISC, VH)}; animation: g4-ring 380ms cubic-bezier(0.3, 1.5, 0.5, 1) both; }
.g-four .g4-wr svg, .g-four .g4-puff svg { display: block; width: 100%; height: 100%; overflow: visible; }
.g-four .g4-wr-ink { fill: none; stroke: var(--g-ink); stroke-width: 15; }
.g-four .g4-wr-hl { fill: none; stroke: var(--g-hl); stroke-width: 9; }
.g-four .g4-wr-o { fill: none; stroke: var(--g-ink); stroke-width: 6; stroke-dasharray: 10 8; opacity: 0.7; }
.g-four .g4-wo { position: absolute; width: ${pct(2 * DISC, VW)}; height: ${pct(2 * DISC, VH)}; }
@keyframes g4-ring { from { transform: scale(0.4); opacity: 0; } to { transform: none; opacity: 1; } }
.g-four .g4-sk { position: absolute; height: ${pct(22, VH)}; transform: rotate(var(--rot)) scaleX(0); animation: g4-draw 440ms cubic-bezier(0.6, 0, 0.3, 1) both; }
.g-four .g4-sk i { position: absolute; display: block; border-radius: 999px; }
.g-four .g4-sk-ink { inset: 0; background: var(--g-ink); }
.g-four .g4-sk-hl { left: var(--hi); right: var(--hi); top: 20.5%; bottom: 20.5%; background: var(--g-hl); }
@keyframes g4-draw { from { transform: rotate(var(--rot)) scaleX(0); } to { transform: rotate(var(--rot)) scaleX(1); } }
/* a ring of ink that spreads from where a disc lands */
.g-four .g4-puff { position: absolute; width: ${pct(2 * DISC, VW)}; height: ${pct(2 * DISC, VH)}; animation: g4-puff 460ms cubic-bezier(0.2, 0.7, 0.3, 1) both; }
.g-four .g4-puff circle { fill: none; stroke: var(--g-ink); stroke-width: 3; }
@keyframes g4-puff { from { transform: scale(0.9); opacity: 0.6; } to { transform: scale(1.55); opacity: 0; } }

.g-four .g4-strip { position: absolute; top: 0; display: flex; left: ${pct(P, VW)}; width: ${pct(COLS * U, VW)}; height: ${pct(TOP + BH, VH)}; }
.g-four .g4-col { flex: 1; height: 100%; min-width: 0; margin: 0; padding: 0; border: 0; border-radius: 12px; background: transparent; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.g-four .g4-col:disabled { cursor: default; }
.g-four .g4-col:focus { outline: none; }
.g-four .g4-col:focus-visible { box-shadow: inset 0 0 0 3px var(--g-ink); }
.g-four .g4-guard { position: absolute; top: 0; left: ${pct(P, VW)}; width: ${pct(COLS * U, VW)}; height: ${pct(TOP + BH, VH)}; display: none; }
.g-four.is-locked:not(.is-over) .g4-guard { display: block; }
.g-four .g4-colhl { position: absolute; left: ${pct(P, VW)}; top: ${pct(TOP + P, VH)}; width: ${pct(U, VW)}; height: ${pct(ROWS * U, VH)}; opacity: 0; pointer-events: none; transition: opacity 120ms; }
.g-four .g4-colhl.g4-a { background: var(--g-halftone-a) 0 0 / 5px 5px, color-mix(in srgb, var(--p-a) 24%, var(--g-bg)); }
.g-four .g4-colhl.g4-b { background: var(--g-halftone-b) 0 0 / 5px 5px, color-mix(in srgb, var(--p-b) 24%, var(--g-bg)); }
.g-four .g4-colhl.on { opacity: 1; }
.g-four .g4-colhl.press { opacity: 0.6; }
.g-four .g4-nums { display: none; width: 100%; padding: 0 ${pct(VW - BW + P, VW)} 0 ${pct(P, VW)}; margin-top: -2px; }
.g-four .g4-nums span { flex: 1; text-align: center; font: 900 0.78rem/1 var(--g-font-display); color: var(--g-muted); }
.g-four .g4-nums span.on { color: var(--g-ink); }
@media (hover: hover) and (pointer: fine) { .g-four .g4-nums { display: flex; } }

.g-four .g4-stamp { position: absolute; transform: translate(-50%, -50%) rotate(-9deg); pointer-events: none; padding: 5px 12px; border: 3px solid var(--g-ink); border-radius: 8px; background: var(--g-grain) 0 0 / var(--g-grain-size), var(--g-hl); color: var(--g-on-ink); font: 900 clamp(1rem, 5vw, 1.5rem)/1 var(--g-font-display); text-shadow: var(--g-misreg); box-shadow: var(--g-shadow); white-space: nowrap; animation: g4-stamp 1700ms ease-out both; }
@keyframes g4-stamp { 0% { transform: translate(-50%, -50%) rotate(-9deg) scale(1.9); opacity: 0; } 12% { transform: translate(-50%, -50%) rotate(-9deg) scale(1); opacity: 1; } 80% { opacity: 1; } 100% { transform: translate(-50%, -64%) rotate(-9deg); opacity: 0; } }

.g-four .g4-riv { display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: 100%; text-align: center; font: 800 0.86rem/1.25 var(--g-font-body); color: var(--g-ink); text-wrap: balance; }
.g-four .g4-riv .g4-riv-b { color: var(--g-muted); font-weight: 700; }
.g-four .g4-modes { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; max-width: 100%; }
.g-four .g4-mc { min-height: 44px; padding: 6px 10px; font-size: 0.85rem; cursor: pointer; box-shadow: var(--g-shadow-sm); touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.g-four .g4-mc:active { transform: translate(2px, 2px); box-shadow: none; }
.g-four .g4-mc:focus-visible, .g-four .g4-act:focus-visible { outline: 3px solid var(--g-ink); outline-offset: 2px; }
.g-four .g4-mdesc { margin: 0; max-width: 34ch; text-align: center; font: 600 0.82rem/1.3 var(--g-font-body); color: var(--g-muted); text-wrap: balance; }
.g-four .g4-label { min-height: 28px; }
.g-four .g4-acts { display: flex; gap: 8px; }
.g-four .g4-act { min-height: 44px; min-width: 96px; justify-content: center; font-size: 0.9rem; cursor: pointer; box-shadow: var(--g-shadow-sm); touch-action: manipulation; }
.g-four .g4-act:active { transform: translate(2px, 2px); box-shadow: none; }
.g-four .g4-moment { margin: 0; max-width: min(100%, 34ch); padding: 8px 14px; border: 2px solid var(--g-ink); border-radius: var(--g-radius); background: var(--g-grain) 0 0 / var(--g-grain-size), var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow); font: 900 0.9rem/1.25 var(--g-font-display); text-align: center; text-wrap: balance; transform: rotate(-1.5deg); opacity: 0; }
.g-four .g4-ledger { margin: 0; font: 800 0.8rem/1.3 var(--g-font-body); color: var(--g-muted); text-align: center; text-wrap: balance; opacity: 0; }
.g-four .g4-ledger.show { opacity: 1; transition: opacity 400ms; }
.g-four .g4-st-fill { fill: color-mix(in srgb, var(--g-ink) 38%, var(--g-card)); }
.g-four .g4-st-body { fill: color-mix(in srgb, var(--g-ink) 38%, var(--g-card)); stroke: var(--g-ink); stroke-width: 2px; vector-effect: non-scaling-stroke; }
.g-four .g4-x .g4-st-body { fill: none; }
.g-four .g4-st-ring { fill: none; stroke: var(--g-ink); stroke-width: 4; stroke-dasharray: 5 7; opacity: 0.5; }
.g-four .g4-st-crack { fill: none; stroke: var(--g-ink); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; opacity: 0.6; }
.g-four .g4-moment.show { animation: g4-moment 420ms cubic-bezier(0.3, 1.5, 0.5, 1) both; }
@keyframes g4-moment { from { transform: rotate(-1.5deg) scale(1.5); opacity: 0; } to { transform: rotate(-1.5deg); opacity: 1; } }
.g-four [hidden] { display: none !important; }

.g-four .g4-plate { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 16px 8px 10px; border-radius: 999px; background: var(--g-grain) 0 0 / var(--g-grain-size), var(--g-card); border: 2px solid var(--g-ink); box-shadow: var(--g-shadow); font: 900 0.98rem/1.2 var(--g-font-display); color: var(--g-ink); max-width: 100%; text-wrap: balance; }

.g-four .g4-plate.wait { color: var(--g-muted); border-color: var(--g-line); }
.g-four .g4-plate.wait .g4-plate-t { text-shadow: none; }
.g-four .g4-chip { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--g-ink); box-shadow: inset 0 0 0 4px color-mix(in srgb, var(--g-ink) 22%, transparent); }
.g-four .g4-chip.none { background: transparent; border-style: dashed; box-shadow: none; }

@media (max-height: 720px) and (orientation: portrait) { .g-four { --g4-chrome: 342px; } .g-four .g4-riv-b { display: none; } }
@media (orientation: landscape) and (min-width: 560px) {
  .g-four { --g4-chrome: 175px; flex-direction: row; align-items: center; justify-content: center; gap: 18px; padding: 0; }
  .g-four .g4-bd { width: auto; flex: none; }
  .g-four .g4-wrap { width: max(160px, min(560px, calc((100vh - var(--g4-chrome)) * var(--g4-ar)))); width: max(160px, min(560px, calc((100dvh - var(--g4-chrome)) * var(--g4-ar)))); }
  .g-four .g4-side { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; flex: 1 1 0; min-width: 0; max-width: 340px; }
  .g-four .g4-top, .g-four .g4-bottom { order: 0; gap: 6px; }
}
@media (prefers-reduced-motion: reduce) {
  .g-four *, .g-four .g4-lift.on .g4-bob { animation: none !important; transition: none !important; }
  .g-four .g4-moment.show, .g-four .g4-ledger.show { opacity: 1; }
}
`,

  mount(el, api) {
    const store = api.data ? api : gameDataApi('four');
    const root = document.createElement('div');
    root.className = 'g-four';
    root.innerHTML = `
      <div class="g4-bd">
        <div class="g4-wrap">
          <div class="g4-stage">
            <div class="g4-board">
              <svg class="g4-svg" viewBox="0 0 ${VW} ${VH}" aria-hidden="true">
                <path class="g4-edge" d="${roundRect(0, TOP, BW, TOP + BH, 26)}" transform="translate(7 9)"/>
                <path class="g4-foot" d="M44 ${TOP + BH - 4}h104l-14 26h-76z"/>
                <path class="g4-foot" d="M${BW - 148} ${TOP + BH - 4}h104l-14 26h-76z"/>
                <rect class="g4-back" x="${P}" y="${TOP + P}" width="${COLS * U}" height="${ROWS * U}"/>
              </svg>
              <div class="g4-half"></div>
              <div class="g4-colhl"></div>
              <div class="g4-discs"></div>
              <svg class="g4-svg" viewBox="0 0 ${VW} ${VH}" aria-hidden="true">
                <path class="g4-face-reg" fill-rule="evenodd" d="${facePath()}"/>
                <path class="g4-face" fill-rule="evenodd" d="${facePath()}"/>
                <path class="g4-rule" d="${roundRect(7, TOP + 7, BW - 7, TOP + BH - 7, 19)}"/>
              </svg>
              <div class="g4-facegrain"></div>
              <svg class="g4-svg" viewBox="0 0 ${VW} ${VH}" aria-hidden="true">
                <g class="g4-capg"></g>
                <g class="g4-poprings">${Array.from({ length: COLS }, (_, c) => `<circle class="g4-popring" r="${HOLE - 4}" cx="${cx(c)}" cy="${cy(0)}"/>`).join('')}</g>
              </svg>
              <div class="g4-ghost"><svg viewBox="-${DISC} -${DISC} ${2 * DISC} ${2 * DISC}" aria-hidden="true"><circle r="${HOLE - 7}"/></svg></div>
              <div class="g4-marks"></div>
            </div>
            <div class="g4-lift instant"><div class="g4-shk"><div class="g4-bob"><svg class="g4-ds" viewBox="-${DISC} -${DISC} ${2 * DISC} ${2 * DISC}" aria-hidden="true"><circle class="g4-lift-shadow" cx="6" cy="8" r="${DISC}"/>${DISC_INNER}</svg></div></div></div>
          </div>
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
            ${MODE_IDS.map((m) => `<button type="button" class="g-chip g4-mc" role="radio" data-mode="${m}" aria-checked="false" title="${MODES[m].name}">${CHIP_NAMES[m]}</button>`).join('')}
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
          <p class="g4-ledger" hidden></p>
        </div>
      </div>`;
    root.style.setProperty('--g4-mask', `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${VW} ${VH}'><path fill-rule='evenodd' d='${facePath()}'/></svg>`)}")`);
    el.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const wrap = $('.g4-wrap');
    const board = $('.g4-board');
    const discLayer = $('.g4-discs');
    const marks = $('.g4-marks');
    const ghost = $('.g4-ghost');
    const colhl = $('.g4-colhl');
    const liftG = $('.g4-lift');
    const shk = $('.g4-shk');
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
    const ledgerEl = $('.g4-ledger');
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
    let pressCol = null; // a finger is down on this column (zero-latency feedback before the tap lands)
    const discEls = new Map();
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
    // one-shot motion through the Web Animations API: restartable without reading layout, compositor-only transforms
    const play = (e, kf, o) => { if (!e || !e.animate || reduced()) return; try { e.animate(kf, o); } catch { /* old webview: no motion */ } };
    const setCls = (e, v) => { if (e.getAttribute('class') !== v) e.setAttribute('class', v); };
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
      root.style.setProperty('--g4-y0r', (y0 / VH).toFixed(5));
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
      let stones = null;
      if (s.v === 2 && s.mode === 'ghost') g = s.ghost;
      else if (ctx.moves === 0 && ctx.canMove && selMode === 'ghost') { g = ghostFor(s.seed); preview = true; }
      else if (ctx.moves === 0 && ctx.canMove && selMode === 'blockers') { stones = stonesFor(s.seed); preview = true; }
      const key = stones ? `s${stones.join('')}` : g == null ? '' : `${g}${preview ? 'p' : ''}`;
      if (key === capKey) return;
      capKey = key;
      capG.innerHTML = stones ? stones.map((c) => `<g transform="translate(${cx(c)} ${cy(0)})">${STONE_INNER}</g>`).join('') : g == null ? '' : capSvg(g);
      capG.setAttribute('class', `g4-capg${preview ? ' preview' : ''}`);
    }

    function mkDisc(x, y, who, cls, dy, ms) {
      const g = document.createElement('div');
      g.className = `g4-d g4-${who}`;
      g.dataset.who = who;
      g.setAttribute('style', boxAt(x, y));
      const f = document.createElement('div');
      f.className = 'g4-fall';
      const q = document.createElement('div');
      q.className = 'g4-sq';
      q.innerHTML = discSvg(who === 'x' ? STONE_INNER : DISC_INNER);
      f.appendChild(q);
      if (cls) {
        if (dy != null) { f.style.setProperty('--dyr', (dy / (2 * DISC)).toFixed(3)); f.style.setProperty('--fm', `${ms}ms`); }
        else if (ms) f.style.animationDuration = `${ms}ms`;
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
          if (anim && anim.key === k) g = mkDisc(x, y, who, 'is-falling', cy(y) - LIFT_Y, anim.fall);
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

    let winKey = '';
    function renderWin(c, delay) {
      const win = c.state.win;
      const key = win ? `${c.matchId}|${win.runs.map((r) => r.cells.join(';')).join('/')}` : '';
      if (key === winKey) return; // already drawn (a later update must not restart the finale)
      winKey = key;
      marks.innerHTML = '';
      root.classList.remove('is-won');
      for (const g of discEls.values()) { g.classList.remove('is-win'); g.firstChild.style.removeProperty('--wd'); }
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
          if (g) { g.classList.add('is-win'); g.firstChild.style.setProperty('--wd', `${delay + 300 + i * 90}ms`); }
          html += `<div class="g4-wr" style="${boxAt(x, y)};animation-delay:${delay + i * 110}ms"><svg viewBox="-${DISC} -${DISC} ${2 * DISC} ${2 * DISC}"><circle class="g4-wr-ink" r="46"/><circle class="g4-wr-hl" r="46"/></svg></div>`;
          i++;
        }
      }
      for (const run of win.runs) {
        const [a0, a1] = [run.cells[0], run.cells[run.cells.length - 1]];
        const x0 = cx(a0[0]);
        const y0 = cy(a0[1]);
        const len = Math.hypot(cx(a1[0]) - x0, cy(a1[1]) - y0) + 22;
        const rot = (Math.atan2(cy(a1[1]) - y0, cx(a1[0]) - x0) * 180) / Math.PI;
        html += `<div class="g4-sk" style="left:${pct(x0 - 11, VW)};top:${pct(y0 - 11, VH)};width:${pct(len, VW)};--rot:${rot.toFixed(2)}deg;--hi:${pct(4.5, len)};transform-origin:${pct(11, len)} 50%;animation-delay:${delay + i * 110 + 60}ms"><i class="g4-sk-ink"></i><i class="g4-sk-hl"></i></div>`;
      }
      // PopOut: the other side lined up four too, but the popper wins. Show theirs dashed.
      for (const run of win.both || []) {
        for (const [x, y] of run.cells) if (!seenCells.has(`${x}-${y}`)) html += `<div class="g4-wo" style="${boxAt(x, y)}"><svg viewBox="-${DISC} -${DISC} ${2 * DISC} ${2 * DISC}" style="display:block;width:100%;height:100%;overflow:visible"><circle class="g4-wr-o" r="46"/></svg></div>`;
      }
      marks.innerHTML = html;
      if (delay > 0) {
        later(() => { root.classList.add('is-won'); api.sfx('good'); api.haptic(30); }, delay);
        // once the line has inked through, the whole board takes a little hit
        later(() => play(board, [{ transform: 'translateY(0)' }, { transform: `translateY(${((6 / VH) * 100).toFixed(2)}%)`, offset: 0.3 }, { transform: 'translateY(0)' }], { duration: 260, easing: 'ease-out' }), delay + i * 110 + 520);
      } else root.classList.add('is-won');
    }

    function puff(col, row) {
      const e = document.createElement('div');
      e.className = 'g4-puff';
      e.setAttribute('style', boxAt(col, row));
      e.innerHTML = `<svg viewBox="-${DISC} -${DISC} ${2 * DISC} ${2 * DISC}"><circle r="${DISC}"/></svg>`;
      marks.appendChild(e);
      later(() => e.remove(), 520);
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

    let instantRaf = 0;
    let liftAt = -1;
    function renderLift(instant) {
      const c = ctx;
      if (!c) return;
      const on = lifted != null && c.canMove;
      const pop = popping();
      const who = c.actor || 'a';
      const showDisc = on && !pop;
      const jump = instant || !liftG.classList.contains('on');
      setCls(liftG, `g4-lift g4-${who}${showDisc ? ' on' : ''}${jump || liftG.classList.contains('instant') ? ' instant' : ''}`);
      if (showDisc && liftAt !== lifted) {
        liftAt = lifted;
        liftG.style.transform = slide(cx(lifted), LIFT_Y);
      }
      if (!showDisc) liftAt = -1;
      // jumps skip the glide; the glide comes back two frames later (no layout read to flush the style)
      if (liftG.classList.contains('instant')) {
        cancelAnimationFrame(instantRaf);
        instantRaf = requestAnimationFrame(() => { instantRaf = requestAnimationFrame(() => liftG.classList.remove('instant')); });
      }
      const canLand = on && !pop && !full(lifted);
      setCls(ghost, `g4-ghost${canLand ? ' on' : ''} g4-${who}`);
      if (canLand) ghost.style.transform = slide(cx(lifted), cy(c.state.cols[lifted].length));
      setCls(colhl, `g4-colhl g4-${who}${on ? ' on' : pressCol != null ? ' press' : ''}`);
      const hlc = on ? lifted : pressCol;
      if (hlc != null) colhl.style.transform = `translateX(${hlc * 100}%)`;
      rings.forEach((rg, i) => {
        const mine = pop && c.state.cols[i][0] === c.actor;
        setCls(rg, `g4-popring${mine ? ' on' : ''}${mine && on && i === lifted ? ' sel' : ''}`);
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
    const popPlate = () => play(plate, [{ transform: 'scale(0.92)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.3, 1.5, 0.5, 1)' });

    function renderTop() {
      const c = ctx;
      if (!c) return;
      const empty = c.moves === 0 && !c.over;
      const picking = empty && c.canMove;
      const [t1, t2] = rivalry(store.data(), api.name, picking ? modeNow() : 'classic', c.matchId || c.state.seed);
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
    // a refused move: the disc over the column shakes its head, and the column rocks too (the lift row is hidden when compact)
    function shake() {
      const kf = [{ transform: 'translateX(0)' }, { transform: 'translateX(-16%)', offset: 0.2 }, { transform: 'translateX(14%)', offset: 0.4 }, { transform: 'translateX(-9%)', offset: 0.6 }, { transform: 'translateX(4%)', offset: 0.8 }, { transform: 'translateX(0)' }];
      play(shk, kf, { duration: 360, easing: 'ease-out' });
      play(compact ? board : null, [{ transform: 'translateX(0)' }, { transform: 'translateX(-0.7%)', offset: 0.25 }, { transform: 'translateX(0.6%)', offset: 0.5 }, { transform: 'translateX(-0.3%)', offset: 0.75 }, { transform: 'translateX(0)' }], { duration: 300, easing: 'ease-out' });
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
    strip.addEventListener('pointerdown', (e) => {
      lastPT = e.pointerType || '';
      // press-in: the column lights up the moment a finger lands, before the tap is even complete
      const b = e.target.closest && e.target.closest('.g4-col');
      if (b && ctx && ctx.canMove && lastPT !== 'mouse') { pressCol = Number(b.dataset.col); renderLift(false); }
    });
    const unpress = () => { if (pressCol != null) { pressCol = null; if (ctx) renderLift(false); } };
    strip.addEventListener('pointercancel', unpress);
    strip.addEventListener('pointerup', () => { if (pressCol != null) later(unpress, 0); });
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
        return { streak: d.p_streak || 0, who: d.p_streak_who || '', quick: d.p_quick || 0, mw: d.p_mw || 0, wa: d.p_wa || 0, wb: d.p_wb || 0, dr: d.p_dr || 0 };
      }
      const pre = { streak: d.streak || 0, who: d.streak_who || '', quick: d.quick_best || 0, mw: w ? d[`${mode}_${w}_n`] || 0 : 0, wa: d.wins_a_n || 0, wb: d.wins_b_n || 0, dr: d.draws_n || 0 };
      const patch = { last_id: c.matchId, games_n: (d.games_n || 0) + 1, p_streak: pre.streak, p_streak_who: pre.who, p_quick: pre.quick, p_mw: pre.mw, p_wa: pre.wa, p_wb: pre.wb, p_dr: pre.dr };
      if (s.tr) for (const q of ['a', 'b']) if (s.tr[q] > 0) patch[`trap_${q}_n`] = (d[`trap_${q}_n`] || 0) + s.tr[q];
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
          // a fall that takes as long as gravity says: the further it drops, the longer (and faster at the end)
          const fall = reduced() ? 0 : Math.round(110 + 150 * Math.sqrt((cy(row) - LIFT_Y) / U));
          anim = reduced() ? null : { key: `${col}-${row}`, fall };
          landMs = fall;
          later(() => {
            api.sfx('place');
            api.haptic(16);
            puff(col, row);
            play(board, [{ transform: 'translateY(0)' }, { transform: `translateY(${((5 / VH) * 100).toFixed(2)}%)`, offset: 0.3 }, { transform: 'translateY(0)' }], { duration: 200, easing: 'ease-out' });
          }, landMs);
          // dropped into the hole the other side needed: stamp it
          const won = c.state.win && c.state.win.who === c.last.who;
          let blockedAt = 0;
          if (!won && c.prev && runsThrough(c.state.cols, col, row, other(c.last.who)).length) {
            blockedAt = landMs + 60;
            later(() => { stamp('Blocked!', col, row); api.sfx('hit'); }, blockedAt);
          }
          // two ways to win at once, and the other side has nothing to win with: a trap
          if (!won && c.prev && setTrap(c.prev, c.state, c.last.who)) {
            later(() => { stamp('Trap!', col, 3); api.sfx('good'); }, blockedAt ? blockedAt + 600 : landMs + 60);
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
          if (b.disabled !== !c.canMove) b.disabled = !c.canMove;
          const cap = capOf(c.state, i);
          const label = `Column ${i + 1}${c.state.cols[i].length >= cap ? ', full' : ''}${cap < ROWS ? ', capped by the ghost' : ''}`;
          if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
        });
        root.classList.toggle('is-locked', !c.canMove);
        root.classList.toggle('is-over', c.over);
        pressCol = null;
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
            // the series line: the same on both phones (records before + this match, or the books after it)
            const dd = store.data();
            const ledger = st ? ledgerLine(api.name, st, c.state) : dd.last_id === c.matchId ? ledgerLine(api.name, null, c.state, dd) : '';
            ledgerEl.textContent = ledger;
            ledgerEl.hidden = !ledger;
            ledgerEl.classList.remove('show');
            if (ledger) later(() => ledgerEl.classList.add('show'), animate ? landMs + 1250 : 0);
          }
        } else if (momentFor0) {
          momentFor0 = '';
          momentEl.hidden = true;
          momentEl.classList.remove('show');
          ledgerEl.hidden = true;
          ledgerEl.classList.remove('show');
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
