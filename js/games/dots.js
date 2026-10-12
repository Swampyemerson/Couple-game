// Dots & Boxes. Draw a line between two neighbouring dots; close a box to claim it and go again.
// Most boxes (points) when every line is drawn wins.
// Touch: tap a gap to pick the line, tap it again to draw it. Mouse: hover previews, click draws.
// Keyboard: arrows move between lines, Enter or Space picks one, again to draw it.
//
// Versioning. Matches saved before the modes existed have no setup move and keep replaying with
// the original 5x5-dot rules. New matches start with { setup: 2, mode } as the very first move
// (see docs/games/dots.md). The state field `v` is already the vertical lines, so the version
// lives in `ver`.
import { registerGame, randInt, shuffled, gameDataApi } from './core.js';

const other = (w) => (w === 'a' ? 'b' : 'a');

// ── board shape (per state: legacy states have no `n` and are 5 dots wide) ──
const dimOf = (s) => { const N = s.n || 5; return { N, B: N - 1 }; };
const idxOf = (N, B, l, r, c) => (l === 'h' ? r * B + c : r * N + c);
const key = (l, r, c) => `${l}-${r}-${c}`;
const unkey = (k) => { const [l, r, c] = k.split('-'); return [l, Number(r), Number(c)]; };
const drawn = (s, l, r, c) => { const { N, B } = dimOf(s); return (l === 'h' ? s.h : s.v)[idxOf(N, B, l, r, c)]; };
const edgesOf = (r, c) => [['h', r, c], ['h', r + 1, c], ['v', r, c], ['v', r, c + 1]];
const complete = (s, r, c) => edgesOf(r, c).every(([l, rr, cc]) => drawn(s, l, rr, cc));
const sidesOf = (s, r, c) => edgesOf(r, c).filter(([l, rr, cc]) => drawn(s, l, rr, cc)).length;
function boxesBeside(s, l, r, c) {
  const { B } = dimOf(s);
  const out = [];
  if (l === 'h') { if (r > 0) out.push([r - 1, c]); if (r < B) out.push([r, c]); } else { if (c > 0) out.push([r, c - 1]); if (c < B) out.push([r, c]); }
  return out;
}
function linesOf(N) {
  const B = N - 1;
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < B; c++) out.push(['h', r, c]);
  for (let r = 0; r < B; r++) for (let c = 0; c < N; c++) out.push(['v', r, c]);
  return out;
}
function parseMove(s, m) {
  const { N, B } = dimOf(s);
  const l = m && m.l;
  const r = m && m.r;
  const c = m && m.c;
  if ((l !== 'h' && l !== 'v') || !Number.isInteger(r) || !Number.isInteger(c)) throw new Error('Tap between two dots');
  const ok = l === 'h' ? r >= 0 && r < N && c >= 0 && c < B : r >= 0 && r < B && c >= 0 && c < N;
  if (!ok) throw new Error('Tap between two dots');
  return { l, r, c };
}
/** Boxes this line would close right now. */
function wouldClose(s, l, r, c) {
  const { N, B } = dimOf(s);
  const t = { n: s.n, h: s.h.slice(), v: s.v.slice() };
  (l === 'h' ? t.h : t.v)[idxOf(N, B, l, r, c)] = 'x';
  return boxesBeside(s, l, r, c).filter(([br, bc]) => !s.boxes[br * B + bc] && complete(t, br, bc));
}
const boxPts = (s, bi) => (bi === s.heart ? 2 : 1);
function points(s) {
  const p = { a: 0, b: 0 };
  s.boxes.forEach((w, bi) => { if (w) p[w] += boxPts(s, bi); });
  return p;
}
const totalPts = (s) => { const { B } = dimOf(s); return B * B + (s.heart != null ? 1 : 0); };
const linesTotal = (s) => { const { N, B } = dimOf(s); return 2 * N * B; };
const linesDrawn = (s) => s.order.length + (s.pre ? s.pre.length : 0);

// ── modes ──
const MODES = {
  classic: { n: 5, name: 'Classic', blurb: '4×4 boxes. The one you know and love.' },
  quick: { n: 4, name: 'Quick', blurb: '3×3 boxes. Done before the kettle boils.' },
  big: { n: 6, name: 'Big', blurb: '5×5 boxes. Room to scheme.' },
  sweet: { n: 5, name: 'Sweetheart', blurb: 'One heart box is worth 2. Close it for a question for two.' },
  scramble: { n: 5, name: 'Scramble', blurb: 'A few lines start drawn, so every game opens differently.' },
};
const MODE_IDS = ['classic', 'quick', 'big', 'sweet', 'scramble'];
const hasMode = (m) => typeof m === 'string' && Object.prototype.hasOwnProperty.call(MODES, m);

const PROMPTS = [
  'Tell them the moment you knew.',
  'Plan your next date in ten words.',
  'Name one tiny thing they do that you secretly adore.',
  'Share a memory of us that you replay on a rough day.',
  'Describe our perfect lazy Sunday.',
  'Give them a compliment you have never said out loud.',
  'What was your first impression of them?',
  'Where should we travel together next, and why there?',
  'Share a song that reminds you of us.',
  'What are you most looking forward to doing together this year?',
  'Tell them what you were thinking on our first date.',
  'Name three things you are grateful for about them, fast.',
  'What small ritual of ours do you never want to lose?',
  'Which of their habits makes you smile every single time?',
  'A free weekend and no limits. What do we do?',
  'Say what you love about the way they laugh.',
  'What is the bravest thing you have seen them do?',
  'Describe the best meal we have ever shared.',
  'Tell them a dream you have not mentioned yet.',
  'Pick a team name for the two of you, and defend it.',
  'What is the thing that always makes you feel safe with them?',
  'Tell them about a time they made your day without knowing it.',
  'Which place feels like home because of them?',
  'Hand over a hug, a kiss or a high five. They choose.',
  'Which of their traits do you hope rubs off on you?',
  'Retell our meet-cute in thirty seconds.',
  'What is something they taught you?',
  'Describe their smile without using the word beautiful.',
  'What are we cooking together next?',
  'Say one thing you are proud of them for lately.',
  'What is the silliest thing we have ever done together?',
  'Pick the song for our next dance in the kitchen.',
  'What tiny adventure can we squeeze into this week?',
  'What would you put in a time capsule about us?',
  'Say one thing you would like to get better at for them, kindly.',
  'What is the cosiest moment we have shared?',
  'Which movie scene feels like us?',
  'Whisper one secret wish for our future.',
  'Say thank you for something small they did this week.',
  'What is your favourite thing about our mornings?',
  'We open a tiny café together. What is on the menu?',
  'Tell them something you notice about them that nobody else does.',
  'Do our best inside joke. Right now.',
  'What did you think we would be like, and what are we actually like?',
  'Pick a day next month for a date and promise it out loud.',
];

/** Fill in a freshly chosen mode (used by the setup move and by the picker's preview). */
function configure(s, mode) {
  const m = MODES[mode];
  s.ver = 2;
  s.mode = mode;
  s.n = m.n;
  const { N, B } = dimOf(s);
  s.h = Array(N * B).fill(null);
  s.v = Array(N * B).fill(null);
  s.boxes = Array(B * B).fill(null);
  if (mode === 'sweet') {
    s.heart = randInt(B * B, s.seed, 'heart');
    s.prompt = randInt(PROMPTS.length, s.seed, 'prompt');
  }
  if (mode === 'scramble') {
    // 4 to 6 lines that close nothing and leave no box with three sides
    const want = 4 + randInt(3, s.seed, 'scramble');
    const sides = Array(B * B).fill(0);
    const pre = [];
    for (const [l, r, c] of shuffled(linesOf(N), `${s.seed}|scramble`)) {
      if (pre.length >= want) break;
      const bs = boxesBeside(s, l, r, c);
      if (bs.some(([br, bc]) => sides[br * B + bc] >= 2)) continue;
      bs.forEach(([br, bc]) => { sides[br * B + bc]++; });
      (l === 'h' ? s.h : s.v)[idxOf(N, B, l, r, c)] = 's';
      pre.push(key(l, r, c));
    }
    s.pre = pre;
  }
  return s;
}

// ── analysis of a position's history (pure; the view and the records use it) ──
function analyze(s) {
  const { N, B } = dimOf(s);
  const t = { n: s.n, h: Array(N * B).fill(null), v: Array(N * B).fill(null), boxes: Array(B * B).fill(null) };
  if (s.pre) for (const k of s.pre) { const [l, r, c] = unkey(k); (l === 'h' ? t.h : t.v)[idxOf(N, B, l, r, c)] = 's'; }
  const capturable = () => {
    const out = [];
    for (let br = 0; br < B; br++) for (let bc = 0; bc < B; bc++) if (!t.boxes[br * B + bc] && sidesOf(t, br, bc) === 3) out.push(br * B + bc);
    return out;
  };
  const missing = (bi) => edgesOf(Math.floor(bi / B), bi % B).map(([l, r, c]) => key(l, r, c)).find((k) => !drawn(t, ...unkey(k)));
  const steps = [];
  const runs = [];
  const pts = { a: 0, b: 0 };
  const behind = { a: 0, b: 0 }; // the most each player has trailed by
  let run = null;
  s.order.forEach((k, i) => {
    const [l, r, c] = unkey(k);
    const who = drawn(s, l, r, c);
    const before = capturable();
    (l === 'h' ? t.h : t.v)[idxOf(N, B, l, r, c)] = who;
    const closed = [];
    for (const [br, bc] of boxesBeside(t, l, r, c)) {
      const bi = br * B + bc;
      if (!t.boxes[bi] && complete(t, br, bc)) { t.boxes[bi] = who; closed.push(bi); }
    }
    const gain = closed.reduce((n, bi) => n + boxPts(s, bi), 0);
    pts[who] += gain;
    if (!run || run.who !== who) { run = { who, from: i, to: i, boxes: 0, pts: 0 }; runs.push(run); }
    run.to = i;
    run.boxes += closed.length;
    run.pts += gain;
    // A sacrifice: mid-chain, the player declines a box they could take and instead leaves a
    // two-box pair that one line closes, handing it over to keep control.
    let sac = false;
    if (!closed.length && run.boxes > 0 && before.length === 1) {
      const after = capturable();
      sac = after.length === 2 && after.includes(before[0]) && missing(after[0]) === missing(after[1]);
    }
    steps.push({ k, who, closed, run: run.boxes, sac });
    for (const p of ['a', 'b']) behind[p] = Math.max(behind[p], pts[other(p)] - pts[p]);
  });
  let best = { n: 0, who: null };
  for (const rn of runs) if (rn.boxes > best.n) best = { n: rn.boxes, who: rn.who };
  return { steps, runs, pts, behind, best, sacs: steps.filter((x) => x.sac) };
}

// ── what we say at the end, and at the start ──
const MOMENTS = {
  draw: [
    'Dead level. You two are suspiciously well matched.',
    'A draw! Tied up, just like you two.',
    'Nobody wins, nobody loses. Cuddle break?',
    'Perfectly even. The universe approves.',
  ],
  deal: [
    '{W} gave up two boxes on purpose to keep control. Ruthless, but romantic.',
    'That sneaky sacrifice, {W}? Straight out of the pro handbook.',
    '{W} played the long game. {L} will be hearing about it.',
  ],
  chainRecord: [
    'A {n}-box chain: a new record for the two of you!',
    'A {n}-box chain. Longest ever. Frame the board.',
    'New chain record: {n} boxes in one turn!',
  ],
  comeback: [
    '{W} was behind and came all the way back. Dramatic!',
    'What a turnaround. {L} had it, then {W} did.',
    'Down and out? Not {W}. Comeback of the week.',
    '{W} stole the lead back box by box.',
  ],
  broke: [
    '{W} ends {L}’s run of {n}. The tables have turned.',
    'Streak snapped at {n}! {L} will want a rematch.',
    '{L}’s {n}-game run is over. Breakfast is on {L}, perhaps.',
  ],
  streak: [
    '{n} wins in a row for {W}. Is {L} letting them?',
    '{W} is on a {n}-game streak. Be kind, {W}.',
    'That is {n} straight for {W}. {L} may demand a rematch.',
  ],
  firstMode: [
    'First win in {mode} goes to {W}!',
    '{W} takes the first {mode} win. History made.',
    'A first for {mode}, and it is {W}’s.',
  ],
  rout: [
    '{W} ran away with that one. {L} gets a hug anyway.',
    'A landslide for {W}. Breakfast is on {L}.',
    'Not close at all. {L} makes the tea.',
  ],
  photo: [
    'Won by a single point. Hearts racing.',
    'A squeaker! {W} by a whisker.',
    'That could have gone either way. {W} by a hair.',
  ],
  chain: [
    '{n} boxes in one go. {W} hoovered up the board.',
    'That {n}-box chain decided it, {W}.',
    'Big chain energy from {W}.',
  ],
  win: [
    '{W} takes it. {L} has a great rematch face.',
    'Nicely played, {W}. {L} will be back.',
    'One for {W}. Fresh game?',
    'Good game, both of you. {W} gets the bragging rights.',
  ],
};
const STRIP = {
  first: ['First game of Dots & Boxes. Be gentle.', 'A clean page. No record yet, no mercy needed.', 'Your first game here. Winner picks dinner?'],
  streak: ['{W} is on a {n}-game streak · break it?', '{n} in a row for {W}. Your move, {L}.', '{W} has won {n} straight. Time to fight back?'],
  last: ['{W} won last time. Rematch energy?', 'Last game went to {W}. {L}, thoughts?', '{W} leads by a nose. Level it up?'],
  level: ['All square: {a} wins each. Decider?', 'Dead level at {a} apiece. Who blinks?', 'Even Steven, {a} to {a}. Make it count.'],
  draws: ['{d} Someone has to blink.', '{d} Nobody has cracked yet.', '{d} Time to break the deadlock?'],
  series: ['{A} {x}, {B} {y}. {d}', 'Series: {A} {x} · {B} {y}. {d}', 'The score so far: {A} {x}, {B} {y}. {d}'],
};
const fill = (str, vars) => str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : vars[k]));

/** The line for the end of a match. `before` = the records as they stood before it (null when unknown). */
function pickMoment(s, an, result, before, nameOf, seed) {
  const w = result.winner;
  const mode = s.mode || 'classic';
  const total = totalPts(s);
  const vars = { W: w ? nameOf(w) : '', L: w ? nameOf(other(w)) : '', n: 0, mode: (MODES[mode] || MODES.classic).name };
  const pick = (sit) => fill(MOMENTS[sit][randInt(MOMENTS[sit].length, seed, 'moment', sit)], vars);
  if (!w) return pick('draw');
  const margin = Math.abs(an.pts.a - an.pts.b);
  if (an.sacs.some((x) => x.who === w)) return pick('deal');
  if (before && an.best.n >= 4 && an.best.n > before.chain) { vars.n = an.best.n; return pick('chainRecord'); }
  if (an.behind[w] >= Math.max(3, Math.round(total * 0.2))) return pick('comeback');
  if (before && before.streakWho === other(w) && before.streak >= 2) { vars.n = before.streak; return pick('broke'); }
  if (before && before.streakWho === w && before.streak + 1 >= 3) { vars.n = before.streak + 1; return pick('streak'); }
  if (before && before.mw === 0 && mode !== 'classic') return pick('firstMode');
  if (margin >= total * 0.5) return pick('rout');
  if (margin <= 1) return pick('photo');
  if (an.best.n >= 5 && an.best.who === w) { vars.n = an.best.n; return pick('chain'); }
  return pick('win');
}
function pickStrip(d, nameOf, seed) {
  const num = (k) => (typeof d[k] === 'number' ? d[k] : 0);
  const games = num('games_n');
  const vars = { a: num('w_a_n'), b: num('w_b_n'), A: nameOf('a'), B: nameOf('b'), x: num('w_a_n'), y: num('w_b_n') };
  const pick = (sit) => fill(STRIP[sit][randInt(STRIP[sit].length, seed, 'strip', sit)], vars);
  if (!games) return pick('first');
  const sw = d.streak_who === 'a' || d.streak_who === 'b' ? d.streak_who : '';
  const n = num('streak');
  if (sw && n >= 2) { vars.W = nameOf(sw); vars.L = nameOf(other(sw)); vars.n = n; return pick('streak'); }
  const draws = num('draws_n');
  vars.d = draws ? `${draws} draw${draws === 1 ? '' : 's'}.` : '';
  if (!vars.a && !vars.b) return pick('draws');
  if (sw && vars.a !== vars.b) { vars.W = nameOf(sw); vars.L = nameOf(other(sw)); return pick('last'); }
  if (vars.a === vars.b && vars.a) return pick('level');
  return pick('series');
}

// ── geometry (SVG user units): a fixed 500-unit canvas, so lines and dots keep their weight at any size ──
const VB = 500;
const MARGIN = 50;
const geomOf = (B) => {
  const S = (VB - 2 * MARGIN) / B;
  const px = (c) => MARGIN + c * S;
  const ends = (l, r, c) => (l === 'h' ? [px(c), px(r), px(c + 1), px(r)] : [px(c), px(r), px(c), px(r + 1)]);
  return {
    S, px, B,
    boxIn: S / 2 - 9,
    lineD: (l, r, c) => { const [x1, y1, x2, y2] = ends(l, r, c); return `M${x1} ${y1}L${x2} ${y2}`; },
    hit(l, r, c) {
      const h = S / 2;
      if (l === 'h') { const y = px(r); const x0 = px(c); return `${x0},${y} ${x0 + h},${y - h} ${x0 + S},${y} ${x0 + h},${y + h}`; }
      const x = px(c); const y0 = px(r);
      return `${x},${y0} ${x + h},${y0 + h} ${x},${y0 + S} ${x - h},${y0 + h}`;
    },
  };
};
const HEART_D = 'M0 17C-3 14-17 5-17-6-17-14-11-19-5-19-2-19 0-17 0-14 0-17 2-19 5-19 11-19 17-14 17-6 17 5 3 14 0 17Z';

registerGame({
  id: 'dots',
  title: 'Dots & Boxes',
  blurb: 'Draw lines, close boxes, steal the chain.',
  kind: 'turns',
  team: false,
  tags: ['brainy'],
  platforms: ['phone', 'computer'],
  minutes: 8,
  endDelay: 2400,
  dotsInfo: { MODES, MODE_IDS, MOMENTS, STRIP, PROMPTS, analyze, pickMoment, pickStrip }, // for the tests
  howTo: [
    'Take turns drawing a line between two dots.',
    'Tap a gap to pick it, tap again to draw it.',
    'Close a box and it’s yours, and you go again.',
    'Most boxes when the lines run out wins. Try the other modes!',
  ],

  // ── rules (pure, deterministic) ──
  init: ({ first }) => ({ h: Array(20).fill(null), v: Array(20).fill(null), boxes: Array(16).fill(null), turn: first, order: [], got: 0 }),
  next: (s) => (linesDrawn(s) >= linesTotal(s) ? [] : [s.turn]),
  apply(s, who, move) {
    if (move && move.setup !== undefined) {
      // the one setup move: first of the match, from the first mover, passes no turn
      if (s.ver || s.order.length) throw new Error('The mode is picked before the first line');
      if (who !== s.turn) throw new Error('Not your turn');
      if (move.setup !== 2 || !hasMode(move.mode)) throw new Error('Unknown mode');
      return configure(s, move.mode);
    }
    const { N, B } = dimOf(s);
    const { l, r, c } = parseMove(s, move);
    if (who !== s.turn) throw new Error('Not your turn');
    const arr = l === 'h' ? s.h : s.v;
    if (arr[idxOf(N, B, l, r, c)]) throw new Error('That line is already drawn');
    arr[idxOf(N, B, l, r, c)] = who;
    s.order.push(key(l, r, c));
    let got = 0;
    for (const [br, bc] of boxesBeside(s, l, r, c)) {
      const bi = br * B + bc;
      if (!s.boxes[bi] && complete(s, br, bc)) { s.boxes[bi] = who; got++; }
    }
    s.got = got;
    if (!got) s.turn = other(who);
    return s;
  },
  score: (s) => points(s),
  result(s) {
    const { a, b } = points(s);
    const unit = s.heart != null ? 'points' : 'boxes';
    if (a === b) return { winner: null, text: `${a} all`, sub: `Same number of ${unit}. It’s a draw.`, score: a };
    const w = a > b ? 'a' : 'b';
    return { winner: w, sub: `${Math.max(a, b)} ${unit} to ${Math.min(a, b)}` };
  },

  // ── view ──
  css: `
.g-dots { --gd-s: min(94vw, 420px); flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 12px; padding: 16px 4px 8px; overflow-x: hidden; overflow-y: auto; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.g-dots.is-land { padding-top: 6px; flex-direction: row; align-items: center; justify-content: center; gap: 18px; }
.g-dots .gd-wrap { position: relative; flex: none; width: var(--gd-s); height: var(--gd-s); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow); }
.g-dots .gd-wrap::after { content: ''; position: absolute; inset: 6px; border: 1px solid var(--g-ink); border-radius: calc(var(--g-radius) - 5px); opacity: 0.3; pointer-events: none; }
.g-dots .gd-svg { display: block; width: 100%; height: 100%; overflow: visible; }
.g-dots .gd-guide { fill: none; stroke: var(--g-muted); stroke-width: 3.5; stroke-linecap: round; stroke-dasharray: 0.1 12; opacity: 0.55; }
.g-dots .gd-guide.off { display: none; }
.g-dots .gd-dot { fill: var(--g-ink); }
.g-dots .gd-ln { fill: none; stroke: var(--g-ink); stroke-width: 8; stroke-linecap: round; }
.g-dots .gd-ln.is-new { stroke-dasharray: 1 1; animation: gd-draw 300ms cubic-bezier(0.5, 0, 0.3, 1) both; }
.g-dots .gd-lo { fill: none; stroke-width: 15; stroke-linecap: round; opacity: 0.9; }
.g-dots .gd-lo.gd-a { stroke: var(--p-a); } .g-dots .gd-lo.gd-b { stroke: var(--p-b); } .g-dots .gd-lo.gd-s { stroke: var(--g-line); }
.g-dots .gd-ln-hl { fill: none; stroke: var(--g-hl); stroke-width: 26; stroke-linecap: round; animation: gd-fade 300ms ease-out both; }
@keyframes gd-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes gd-fade { from { opacity: 0; } to { opacity: 1; } }
.g-dots .gd-box rect { stroke: var(--g-ink); stroke-width: 2px; vector-effect: non-scaling-stroke; }
.g-dots .gd-box.gd-a rect, .g-dots .gd-chip.gd-a { fill: var(--p-a); background: var(--p-a); }
.g-dots .gd-box.gd-b rect, .g-dots .gd-chip.gd-b { fill: var(--p-b); background: var(--p-b); }
.g-dots .gd-box text { fill: var(--g-on-ink); font-family: var(--g-font-display); font-weight: 900; text-anchor: middle; dominant-baseline: central; }
.g-dots .gd-box .gd-stamp { transform-box: fill-box; transform-origin: center; }
.g-dots .gd-box.is-new .gd-stamp { animation: gd-stamp 380ms cubic-bezier(0.3, 1.6, 0.5, 1) both; animation-delay: var(--sd, 0ms); }
@keyframes gd-stamp { from { transform: scale(1.5) rotate(-12deg); opacity: 0; } 60% { opacity: 1; } to { transform: none; opacity: 1; } }
.g-dots .gd-heart { fill: var(--p-b-soft); stroke: var(--g-ink); stroke-width: 2px; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.g-dots .gd-box .gd-heart { fill: none; stroke: var(--g-on-ink); opacity: 0.55; }
.g-dots .gd-box.gd-open .gd-heart { fill: var(--p-b-soft); stroke: var(--g-ink); opacity: 1; }
.g-dots.is-done .gd-box.is-win .gd-stamp { animation: gd-cheer 520ms cubic-bezier(0.3, 1.6, 0.5, 1) both; animation-delay: var(--wd, 0ms); }
@keyframes gd-cheer { 0% { transform: none; } 45% { transform: scale(1.12) rotate(-4deg); } 100% { transform: none; } }
.g-dots.is-done.has-winner .gd-box:not(.is-win) { opacity: 0.45; transition: opacity 500ms; }
.g-dots .gd-pl, .g-dots .gd-pl-ink { fill: none; stroke-linecap: round; opacity: 0; }
.g-dots .gd-pl { stroke-width: 8; }
.g-dots .gd-pl-ink { stroke: var(--g-ink); stroke-width: 14; }
.g-dots .gd-pg.gd-a .gd-pl { stroke: var(--p-a); } .g-dots .gd-pg.gd-b .gd-pl { stroke: var(--p-b); }
.g-dots .gd-pg.is-hover .gd-pl { opacity: 0.6; }
.g-dots .gd-pg.is-sel .gd-pl-ink { opacity: 1; }
.g-dots .gd-pg.is-sel .gd-pl { opacity: 1; stroke-width: 7; stroke-linecap: butt; stroke-dasharray: 12 8; animation: gd-march 700ms linear infinite; }
@keyframes gd-march { to { stroke-dashoffset: -20; } }
.g-dots .gd-gb { stroke: none; opacity: 0.3; }
.g-dots .gd-gb.gd-a { fill: var(--p-a); } .g-dots .gd-gb.gd-b { fill: var(--p-b); }
.g-dots .gd-hit { fill: transparent; pointer-events: all; cursor: pointer; outline: none; }
.g-dots .gd-hit.is-drawn { cursor: default; }
.g-dots.is-locked .gd-hit { pointer-events: none; cursor: default; }
.g-dots .gd-pop { position: absolute; left: 50%; top: -14px; z-index: 3; max-width: 88%; padding: 8px 16px; transform: translateX(-50%) rotate(-3deg); background: var(--g-hl); color: var(--g-on-ink); border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm); box-shadow: var(--g-shadow); font: 900 1.05rem/1.15 var(--g-font-display); text-align: center; text-wrap: balance; pointer-events: none; }
.g-dots.is-land .gd-pop { top: 6px; }
.g-dots .gd-pop[hidden] { display: none; }
.g-dots .gd-pop.in { animation: gd-popin 360ms cubic-bezier(0.3, 1.6, 0.5, 1) both; }
@keyframes gd-popin { from { transform: translateX(-50%) rotate(-3deg) scale(0.6); opacity: 0; } to { transform: translateX(-50%) rotate(-3deg); opacity: 1; } }
.g-dots .gd-side { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; max-width: 480px; min-width: 0; }
.g-dots.is-land .gd-side { flex: 1 1 0; width: auto; max-width: 340px; }
.g-dots .gd-strip { margin: 0; text-align: center; color: var(--g-muted); font: 800 0.82rem/1.3 var(--g-font-body); text-wrap: balance; }
.g-dots .gd-picker { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.g-dots .gd-picker[hidden], .g-dots .gd-strip[hidden], .g-dots .gd-desc[hidden], .g-dots .gd-modeline[hidden], .g-dots .gd-card[hidden], .g-dots .gd-m[hidden] { display: none; }
.g-dots .gd-mode { min-height: 44px; padding: 6px 14px; font-size: 0.86rem; cursor: pointer; box-shadow: var(--g-shadow-sm); touch-action: manipulation; }
.g-dots .gd-mode:active { transform: translate(2px, 2px); box-shadow: none; }
.g-dots .gd-mode.is-on { background: var(--g-hl); color: var(--g-on-ink); }
.g-dots .gd-mode:focus-visible, .g-dots .gd-done:focus-visible { outline: 3px solid var(--p-a); outline-offset: 2px; }
.g-dots .gd-desc { margin: 0; text-align: center; color: var(--g-ink); font: 700 0.84rem/1.3 var(--g-font-body); text-wrap: balance; }
.g-dots .gd-modeline { margin: 0; }
.g-dots .gd-card { width: 100%; padding: 10px 12px; text-align: center; background: color-mix(in srgb, var(--p-b-soft) 70%, var(--g-card)); border: 2px solid var(--g-ink); border-radius: var(--g-radius); box-shadow: var(--g-shadow-sm); }
.g-dots .gd-card-k { margin: 0 0 2px; font: 800 0.7rem/1.2 var(--g-font-body); letter-spacing: 0.08em; text-transform: uppercase; color: var(--g-ink); }
.g-dots .gd-card-t { margin: 0 0 8px; font: 900 1.02rem/1.25 var(--g-font-display); color: var(--g-ink); text-wrap: balance; }
.g-dots .gd-done { min-height: 44px; padding: 6px 18px; cursor: pointer; }
.g-dots .gd-plate { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 16px 8px 10px; border-radius: 999px; background: var(--g-card); border: 2px solid var(--g-ink); box-shadow: var(--g-shadow); font: 900 0.98rem/1.2 var(--g-font-display); color: var(--g-ink); max-width: 100%; text-wrap: balance; }
.g-dots .gd-plate.wait { color: var(--g-muted); border-color: var(--g-line); }
.g-dots .gd-plate.pop { animation: gd-plate 280ms cubic-bezier(0.3, 1.6, 0.5, 1); }
.g-dots .gd-plate.extra { background: var(--g-hl-soft); border-color: var(--g-ink); }
@keyframes gd-plate { from { transform: scale(0.9); } to { transform: none; } }
.g-dots .gd-chip { flex: none; width: 22px; height: 22px; border-radius: 5px; border: 2px solid var(--g-ink); }
.g-dots .gd-chip.none { background: transparent; border-style: dashed; }
.g-dots .gd-m { margin: 0; text-align: center; font: 800 0.88rem/1.3 var(--g-font-body); color: var(--g-ink); text-wrap: balance; }
.gm[data-game="dots"] .gm-status:empty { display: none; }
@media (prefers-reduced-motion: reduce) {
  .g-dots * { animation: none !important; transition: none !important; }
}
`,

  mount(el, api) {
    const root = document.createElement('div');
    root.className = 'g-dots';
    root.innerHTML = `
      <div class="gd-wrap">
        <svg class="gd-svg" viewBox="0 0 ${VB} ${VB}">
          <g class="gd-boxes"></g>
          <g class="gd-guides"></g>
          <g class="gd-hls"></g>
          <g class="gd-unders"></g>
          <g class="gd-lines"></g>
          <g class="gd-ghosts"></g>
          <g class="gd-pg"><path class="gd-pl-ink" d="M0 0"/><path class="gd-pl" d="M0 0"/></g>
          <g class="gd-dots"></g>
          <g class="gd-hits" role="group" aria-label="Lines between the dots"></g>
        </svg>
        <div class="gd-pop" hidden role="status"></div>
      </div>
      <div class="gd-side">
        <p class="gd-strip" hidden></p>
        <div class="gd-picker" role="radiogroup" aria-label="Game mode" hidden></div>
        <p class="gd-desc" hidden></p>
        <p class="gd-modeline" hidden><span class="g-chip is-hl gd-modechip"></span></p>
        <div class="gd-card" hidden><div class="gd-card-k"></div><div class="gd-card-t"></div><div class="gd-card-b"></div></div>
        <div class="gd-plate" aria-live="polite"><span class="gd-chip"></span><span class="gd-plate-t"></span></div>
        <p class="gd-m" hidden></p>
      </div>`;
    el.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const svg = $('.gd-svg');
    const wrap = $('.gd-wrap');
    const boxLayer = $('.gd-boxes');
    const guideLayer = $('.gd-guides');
    const hlLayer = $('.gd-hls');
    const underLayer = $('.gd-unders');
    const lineLayer = $('.gd-lines');
    const ghostLayer = $('.gd-ghosts');
    const dotLayer = $('.gd-dots');
    const pg = $('.gd-pg');
    const hits = $('.gd-hits');
    const pop = $('.gd-pop');
    const side = $('.gd-side');
    const strip = $('.gd-strip');
    const picker = $('.gd-picker');
    const desc = $('.gd-desc');
    const modeline = $('.gd-modeline');
    const card = $('.gd-card');
    const plate = $('.gd-plate');
    const momentEl = $('.gd-m');
    const D = typeof api.data === 'function' ? api : gameDataApi('dots');
    const initial = (w) => (String(api.name(w) || w).trim()[0] || w).toUpperCase();

    // the shared per-game data (records, streaks, the last picked mode)
    const dget = () => { try { return D.data() || {}; } catch { return {}; } };
    const dset = (patch) => { try { D.setData(patch); } catch { /* the page still works without records */ } };
    const lsKey = (id) => `ju.dots.heart.${id}`;
    const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
    const lsPut = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

    let ctx = null;
    let G = null; // geometry of the board that is drawn
    let gN = 0;
    let seenLines = null; // how many lines were drawn at the last paint
    let sel = null; // { l, r, c, by: 'tap' | 'key' | 'hover' | 'peek' }
    let cursor = null; // the keyboard's line (roving tabindex)
    let goalX = 0; // keeps the column while moving up and down
    let lastPT = '';
    let prevOver = null;
    let selMode = hasMode(dget().mode) ? dget().mode : 'classic';
    let view = null; // the state that is drawn (a preview while a mode is being picked)
    let an = null;
    let momentText = '';
    let momentOn = false;
    let cardReady = true;
    let popTimer = 0;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

    // ── sizing: the board takes what the stage leaves, beside the plate in landscape ──
    function fit() {
      const W = root.clientWidth - 8;
      const H0 = root.clientHeight;
      if (W < 80 || H0 < 100) return;
      const land = W > (H0 - 26) * 1.2;
      const H = H0 - (land ? 14 : 26);
      root.classList.toggle('is-land', land);
      let size;
      if (land) size = Math.min(H, W - 230 - 18, 620);
      else size = Math.min(W, 540, H - side.offsetHeight - 12);
      size = Math.max(Math.floor(size), 190);
      root.style.setProperty('--gd-s', `${size}px`);
    }
    let ro = null;
    try { ro = new ResizeObserver(() => fit()); ro.observe(root); } catch { /* old webview: fit runs on every update */ }
    window.addEventListener('resize', fit);

    // ── the board for this many dots (rebuilt only when the size changes) ──
    function build(N) {
      const B = N - 1;
      G = geomOf(B);
      gN = N;
      guideLayer.innerHTML = linesOf(N).map(([l, r, c]) => `<path class="gd-guide" data-k="${key(l, r, c)}" d="${G.lineD(l, r, c)}"/>`).join('');
      const dots = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) dots.push(`<circle class="gd-dot" cx="${G.px(c)}" cy="${G.px(r)}" r="8.5"/>`);
      dotLayer.innerHTML = dots.join('');
      hits.innerHTML = linesOf(N).map(([l, r, c]) => `<polygon class="gd-hit" tabindex="-1" data-k="${key(l, r, c)}" data-l="${l}" data-r="${r}" data-c="${c}" points="${G.hit(l, r, c)}" role="button" aria-label="${l === 'h' ? 'Across' : 'Down'} line, row ${r + 1}, column ${c + 1}"/>`).join('');
      cursor = null;
    }

    const lastOwnerRun = (s) => {
      // the newest turn: trailing lines drawn by whoever drew last
      const order = s.order;
      const lastOwner = order.length ? drawn(s, ...unkey(order[order.length - 1])) : null;
      let k = order.length;
      while (k > 0 && drawn(s, ...unkey(order[k - 1])) === lastOwner) k--;
      return k;
    };

    function renderBoard(c, s, fresh) {
      const { B } = dimOf(s);
      const order = s.order;
      const recent = new Set(c.over ? [] : order.slice(lastOwnerRun(s)));
      let lines = '';
      let unders = '';
      let hls = '';
      const off = new Set();
      const lineAt = (kk, i, owner, isNew) => {
        const d = G.lineD(...unkey(kk));
        const delay = isNew ? (i - fresh.from) * fresh.gap : 0;
        if (recent.has(kk)) hls += `<path class="gd-ln-hl" d="${d}" style="animation-delay:${delay}ms"/>`;
        unders += `<path class="gd-lo gd-${owner}" d="${d}"/>`;
        lines += `<path class="gd-ln${isNew ? ' is-new' : ''}" pathLength="1" d="${d}" style="animation-delay:${delay}ms"/>`;
        off.add(kk);
      };
      if (s.pre) for (const kk of s.pre) lineAt(kk, -1, 's', false);
      order.forEach((kk, i) => lineAt(kk, i, drawn(s, ...unkey(kk)), i >= fresh.from));
      for (const g of guideLayer.children) g.classList.toggle('off', off.has(g.dataset.k));
      lineLayer.innerHTML = lines;
      underLayer.innerHTML = unders;
      hlLayer.innerHTML = hls;
      // boxes
      const winner = c.over && c.result ? c.result.winner : null;
      let boxes = '';
      const fs = Math.round(G.S * 0.46);
      s.boxes.forEach((w, bi) => {
        const br = Math.floor(bi / B);
        const bc = bi % B;
        const x = G.px(bc) + G.S / 2;
        const y = G.px(br) + G.S / 2;
        const heart = bi === s.heart;
        const hs = (G.boxIn * 0.9) / 17;
        if (!w) {
          if (heart) boxes += `<g class="gd-box gd-open" transform="translate(${x} ${y})"><path class="gd-heart" transform="scale(${hs.toFixed(3)})" d="${HEART_D}"/></g>`;
          return;
        }
        const isNew = fresh.boxes.has(bi);
        const sd = isNew ? fresh.boxes.get(bi) : 0;
        boxes += `<g class="gd-box gd-${w}${isNew ? ' is-new' : ''}${winner === w ? ' is-win' : ''}" transform="translate(${x} ${y})"><g class="gd-stamp" style="--sd:${sd}ms;--wd:${bi * 25}ms"><rect x="${-G.boxIn}" y="${-G.boxIn}" width="${2 * G.boxIn}" height="${2 * G.boxIn}" rx="7"/>${heart ? `<path class="gd-heart" transform="scale(${hs.toFixed(3)})" d="${HEART_D}"/>` : ''}<text y="3" style="font-size:${fs}px">${initial(w)}</text></g></g>`;
      });
      boxLayer.innerHTML = boxes;
      for (const h of hits.children) {
        const own = drawn(s, h.dataset.l, Number(h.dataset.r), Number(h.dataset.c));
        h.classList.toggle('is-drawn', !!own);
        h.setAttribute('aria-disabled', String(!c.canMove || !!own));
        h.setAttribute('aria-label', `${h.dataset.l === 'h' ? 'Across' : 'Down'} line, row ${Number(h.dataset.r) + 1}, column ${Number(h.dataset.c) + 1}${own ? (own === 's' ? ', already drawn' : `, drawn by ${api.name(own)}`) : ''}`);
      }
      ensureCursor(s);
    }

    function renderSel() {
      const c = ctx;
      const on = sel && c && c.canMove && view;
      const who = (c && c.actor) || 'a';
      if (!on) { pg.setAttribute('class', 'gd-pg'); ghostLayer.innerHTML = ''; return; }
      for (const p of pg.children) p.setAttribute('d', G.lineD(sel.l, sel.r, sel.c));
      pg.setAttribute('class', `gd-pg gd-${who} ${sel.by === 'tap' || sel.by === 'key' ? 'is-sel' : 'is-hover'}`);
      ghostLayer.innerHTML = wouldClose(view, sel.l, sel.r, sel.c)
        .map(([br, bc]) => `<rect class="gd-gb gd-${who}" x="${G.px(bc) + G.S / 2 - G.boxIn}" y="${G.px(br) + G.S / 2 - G.boxIn}" width="${2 * G.boxIn}" height="${2 * G.boxIn}" rx="7"/>`).join('');
    }

    // ── keyboard: one tab stop, arrows move between lines ──
    const lineX = (l, r, c) => (l === 'h' ? c + 0.5 : c);
    const lineRow = (l, r) => (l === 'h' ? 2 * r : 2 * r + 1);
    function setCursor(k, focus) {
      cursor = k;
      for (const h of hits.children) h.setAttribute('tabindex', h.dataset.k === k ? '0' : '-1');
      if (k) { const [l, r, c] = unkey(k); goalX = lineX(l, r, c); }
      if (focus) { const h = hits.querySelector(`[data-k="${k}"]`); if (h) h.focus({ preventScroll: true }); }
    }
    function ensureCursor(s) {
      const hasFocus = hits.contains(document.activeElement);
      if (cursor && !drawn(s, ...unkey(cursor))) { if (!hits.querySelector('[tabindex="0"]')) setCursor(cursor, false); return; }
      const { B } = dimOf(s);
      const gx = cursor ? goalX : B / 2;
      const gy = cursor ? lineRow(...unkey(cursor).slice(0, 2)) : B;
      let best = null;
      let bd = Infinity;
      for (const [l, r, c] of linesOf(dimOf(s).N)) {
        if (drawn(s, l, r, c)) continue;
        const d = Math.abs(lineX(l, r, c) - gx) + Math.abs(lineRow(l, r) / 2 - gy / 2);
        if (d < bd) { bd = d; best = key(l, r, c); }
      }
      cursor = null;
      if (best) setCursor(best, hasFocus);
    }
    function moveCursor(dx, dy) {
      const s = view;
      if (!s || !cursor) return;
      const { N, B } = dimOf(s);
      const [cl, cr, cc] = unkey(cursor);
      const row = lineRow(cl, cr);
      const free = linesOf(N).filter(([l, r, c]) => !drawn(s, l, r, c));
      if (dx) {
        const same = free.filter(([l, r]) => lineRow(l, r) === row).map(([l, r, c]) => ({ k: key(l, r, c), x: lineX(l, r, c) })).sort((p, q) => p.x - q.x);
        const here = lineX(cl, cr, cc);
        const to = dx > 0 ? same.find((p) => p.x > here + 0.01) : [...same].reverse().find((p) => p.x < here - 0.01);
        if (to) { setCursor(to.k, true); return to.k; }
        return null;
      }
      for (let y = row + dy; y >= 0 && y <= 2 * B; y += dy) {
        const inRow = free.filter(([l, r]) => lineRow(l, r) === y).map(([l, r, c]) => ({ k: key(l, r, c), x: lineX(l, r, c) }));
        if (!inRow.length) continue;
        inRow.sort((p, q) => Math.abs(p.x - goalX) - Math.abs(q.x - goalX) || p.x - q.x);
        const keep = goalX;
        setCursor(inRow[0].k, true);
        goalX = keep;
        return inRow[0].k;
      }
      return null;
    }
    function onKey(e) {
      const h = e.target.closest && e.target.closest('.gd-hit');
      if (!h || !ctx || !view) return;
      const kk = h.dataset.k;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (dir) {
        e.preventDefault();
        if (cursor !== kk) setCursor(kk, false);
        const to = moveCursor(dir[0], dir[1]);
        if (to && ctx.canMove) { const [l, r, c] = unkey(to); sel = { l, r, c, by: 'peek' }; renderSel(); renderPlate(); }
        return;
      }
      if (e.key === 'Escape') { if (sel) { e.preventDefault(); clearSel(); } return; }
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      const [l, r, c] = unkey(kk);
      if (!ctx.canMove) { if (!ctx.over) api.toast(`${api.name(ctx.acts[0] || other(ctx.me))}’s turn`); return; }
      if (drawn(view, l, r, c)) { api.toast('That line is already drawn'); api.sfx('bad'); return; }
      if (sel && sel.by === 'key' && sel.l === l && sel.r === r && sel.c === c) commit(l, r, c);
      else pick(l, r, c, 'key');
    }

    function renderPicker() {
      const c = ctx;
      const picking = !!c && pickingNow(c);
      picker.hidden = !picking;
      desc.hidden = !picking;
      // chips exist only while a mode is being picked, so the waiting phone has nothing to tap
      if (picking && !picker.children.length) picker.innerHTML = MODE_IDS.map((m) => `<button type="button" class="g-chip gd-mode" role="radio" data-mode="${m}">${MODES[m].name}</button>`).join('');
      if (!picking) picker.innerHTML = '';
      if (picking) {
        for (const b of picker.children) { const on = b.dataset.mode === selMode; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); }
        desc.textContent = MODES[selMode].blurb;
      }
      const s = c && c.state;
      const label = s && s.ver && s.mode && s.mode !== 'classic' ? MODES[s.mode].name : '';
      modeline.hidden = !label;
      if (label) $('.gd-modechip').textContent = label;
    }
    const pickingNow = (c) => !c.over && !c.state.ver && c.state.order.length === 0 && c.canMove;
    const waitingPick = (c) => !c.over && !c.state.ver && c.state.order.length === 0 && !c.canMove;

    function renderStrip() {
      const c = ctx;
      const on = !!c && !c.over && c.state.order.length === 0;
      strip.hidden = !on;
      if (on) strip.textContent = pickStrip(dget(), api.name, c.matchId);
    }

    function renderCard() {
      const c = ctx;
      const s = c && c.state;
      const closer = s && s.heart != null ? s.boxes[s.heart] : null;
      const show = !!closer && cardReady && !lsGet(lsKey(c.matchId));
      card.hidden = !show;
      if (!show) $('.gd-card-b').innerHTML = '';
      if (show) {
        if (!$('.gd-done')) $('.gd-card-b').innerHTML = '<button type="button" class="gm-btn gm-btn-ghost gd-done">Done, carry on</button>';
        $('.gd-card-k').textContent = `${api.name(closer)} closed the heart`;
        $('.gd-card-t').textContent = PROMPTS[s.prompt % PROMPTS.length];
      }
    }

    function renderPlate() {
      const c = ctx;
      if (!c) return;
      const s = c.state;
      const online = c.mode === 'online';
      let who = c.actor;
      let text;
      let wait = false;
      let extra = false;
      const run = an && an.steps.length ? an.steps[an.steps.length - 1].run : 0;
      if (c.over) {
        const p = points(s);
        who = c.result && c.result.winner;
        const unit = s.heart != null ? 'points' : 'boxes';
        text = who ? `${api.name(who)} wins, ${Math.max(p.a, p.b)} to ${Math.min(p.a, p.b)}` : `${p.a} ${unit} each. A draw!`;
      } else if (waitingPick(c)) {
        who = c.acts[0] || null;
        wait = true;
        text = `${api.name(who)} is picking a mode…`;
      } else if (!c.canMove) {
        who = c.acts[0] || null;
        wait = true;
        text = c.last && c.last.who === who && s.got ? `${api.name(who)} has ${run === 1 ? 'a box' : `${run} boxes`} and goes again` : `${api.name(who)}’s turn`;
      } else if (sel && (sel.by === 'tap' || sel.by === 'key')) {
        text = sel.by === 'key' ? 'Press Enter again to draw it' : 'Tap it again to draw it';
      } else if (sel && sel.by === 'peek') {
        text = 'Enter picks this line';
      } else if (sel && sel.by === 'hover') {
        text = 'Click to draw it';
      } else if (c.last && c.last.who === who && s.got) {
        extra = true;
        const lead = run >= 3 ? `Chain of ${run}!` : run === 2 ? 'Two boxes!' : 'Box!';
        text = online ? `${lead} Go again` : `${lead} ${api.name(who)}, go again`;
      } else if (pickingNow(c)) {
        text = online ? 'Your turn · pick a mode, then a line' : `${api.name(who)}, pick a mode, then a line`;
      } else {
        text = online ? 'Your turn · draw a line' : `${api.name(who)}, draw a line`;
      }
      $('.gd-chip').className = `gd-chip ${who ? 'gd-' + who : 'none'}`;
      plate.classList.toggle('wait', wait);
      plate.classList.toggle('extra', extra);
      $('.gd-plate-t').textContent = text;
      momentEl.hidden = !(c.over && momentOn && momentText);
      momentEl.textContent = momentText;
    }
    const popPlate = () => { plate.classList.remove('pop'); void plate.offsetWidth; plate.classList.add('pop'); };

    // ── the little stamp over the board: chain counter, sacrifice call ──
    function say(text) {
      pop.textContent = text;
      pop.hidden = false;
      pop.classList.remove('in');
      void pop.offsetWidth;
      if (!reduced()) pop.classList.add('in');
      clearTimeout(popTimer);
      popTimer = later(() => { pop.hidden = true; }, 1700);
    }
    const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
    function chainNote(k) {
      try {
        if (api.muted()) return;
        const ac = api.audio();
        if (!ac) { api.sfx('good'); return; }
        const f = 330 * Math.pow(2, PENT[Math.min(k, PENT.length) - 1] / 12);
        const t = ac.currentTime + 0.005;
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + 0.27);
      } catch { /* no audio */ }
    }

    // ── input ──
    function pick(l, r, c, by) {
      if (!ctx || !ctx.canMove) return;
      const same = sel && sel.l === l && sel.r === r && sel.c === c;
      if (same && sel.by === by) return;
      sel = { l, r, c, by };
      if (by === 'tap' || by === 'key') { api.sfx('tap'); api.haptic(8); }
      if (cursor !== key(l, r, c)) setCursor(key(l, r, c), by === 'key');
      renderSel();
      renderPlate();
    }
    function clearSel() {
      if (!sel) return;
      sel = null;
      renderSel();
      renderPlate();
    }
    function commit(l, r, c) {
      if (!ctx || !ctx.canMove) return;
      if (!ctx.state.ver && ctx.state.order.length === 0) {
        // the first line of a match: the mode goes first, in the same breath
        const set = api.move({ setup: 2, mode: selMode });
        if (!set.ok) { api.toast(set.error); api.sfx('bad'); clearSel(); return; }
      }
      const res = api.move({ l, r, c });
      if (!res.ok) { api.toast(res.error); api.sfx('bad'); api.haptic(40); clearSel(); }
    }
    const hitOf = (e) => { const h = e.target.closest && e.target.closest('.gd-hit'); return h ? [h.dataset.l, Number(h.dataset.r), Number(h.dataset.c)] : null; };

    svg.addEventListener('pointerdown', (e) => { lastPT = e.pointerType || ''; });
    svg.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !ctx || !ctx.canMove || !view) return;
      const h = hitOf(e);
      if (!h || drawn(view, ...h)) { if (sel && sel.by === 'hover') clearSel(); return; }
      pick(...h, 'hover');
    });
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && sel && sel.by === 'hover') clearSel(); });
    svg.addEventListener('click', (e) => {
      const h = hitOf(e);
      if (!h || !ctx || !ctx.canMove || !view) return;
      const pt = e.pointerType || lastPT || 'touch';
      lastPT = '';
      const [l, r, c] = h;
      if (pt === 'mouse') { commit(l, r, c); return; }
      if (drawn(view, l, r, c)) { api.toast('That line is already drawn'); api.sfx('bad'); clearSel(); return; }
      if (sel && sel.by === 'tap' && sel.l === l && sel.r === r && sel.c === c) commit(l, r, c);
      else pick(l, r, c, 'tap');
    });
    svg.addEventListener('keydown', onKey);
    svg.addEventListener('focusin', (e) => {
      const h = e.target.closest && e.target.closest('.gd-hit');
      if (!h || !ctx || !view) return;
      if (h.dataset.k !== cursor) setCursor(h.dataset.k, false);
      let kb = false;
      try { kb = h.matches(':focus-visible'); } catch { /* old webview */ }
      if (kb && ctx.canMove && !drawn(view, h.dataset.l, Number(h.dataset.r), Number(h.dataset.c))) { sel = { l: h.dataset.l, r: Number(h.dataset.r), c: Number(h.dataset.c), by: 'peek' }; renderSel(); renderPlate(); }
    });
    picker.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.gd-mode');
      if (!b || !ctx || !pickingNow(ctx)) return;
      selMode = b.dataset.mode;
      dset({ mode: selMode });
      api.sfx('tap');
      sel = null;
      inst.update(ctx);
    });
    card.addEventListener('click', (e) => {
      if (!(e.target.closest && e.target.closest('.gd-done'))) return;
      if (ctx) lsPut(lsKey(ctx.matchId), '1');
      renderCard();
      fit();
    });

    // ── records: counted once per match, by whichever phone sees it end ──
    function tally(c) {
      const d = dget();
      if (d.last_id === c.matchId) return;
      const num = (k) => (typeof d[k] === 'number' ? d[k] : 0);
      const s = c.state;
      const w = c.result && c.result.winner;
      const mode = s.mode || 'classic';
      const margin = Math.abs(an.pts.a - an.pts.b);
      const patch = {
        last_id: c.matchId,
        games_n: num('games_n') + 1,
        // what stood before this match, so both phones tell the same story at the end
        p_g: num('games_n'), p_streak: num('streak'), p_streak_who: d.streak_who || '', p_chain: num('chain_best'), p_margin: num('margin_best'), p_mw: w ? num(`${mode}_${w}_n`) : 0,
      };
      if (!w) patch.draws_n = num('draws_n') + 1;
      else {
        patch.streak = d.streak_who === w ? num('streak') + 1 : 1;
        patch.streak_who = w;
        if (patch.streak > num('streak_best')) { patch.streak_best = patch.streak; patch.streak_best_who = w; }
        patch[`${mode}_${w}_n`] = num(`${mode}_${w}_n`) + 1;
        patch[`w_${w}_n`] = num(`w_${w}_n`) + 1;
        if (margin > num('margin_best')) { patch.margin_best = margin; patch.margin_best_who = w; }
      }
      if (an.best.n > num('chain_best')) { patch.chain_best = an.best.n; patch.chain_best_who = an.best.who; }
      dset(patch);
    }
    function momentNow(c) {
      const d = dget();
      const counted = d.last_id === c.matchId;
      const before = counted ? { streak: d.p_streak || 0, streakWho: d.p_streak_who || '', chain: d.p_chain || 0, mw: d.p_mw || 0 } : null;
      return pickMoment(c.state, an, c.result, before, api.name, c.state.seed);
    }

    function paint() {
      const c = ctx;
      if (!c) return;
      renderPicker();
      renderStrip();
      renderPlate();
      renderSel();
      fit();
    }

    api.setStatus(''); // the plate says it all; the stage's status line stays empty (and hidden) while playing
    const offData = (() => { try { return D.onData(() => { renderStrip(); }); } catch { return null; } })();

    const inst = {
      update(c) {
        ctx = c;
        const s0 = c.state;
        // while the first mover is choosing, the board shows the mode they have selected
        view = pickingNow(c) ? configure(JSON.parse(JSON.stringify(s0)), selMode) : s0;
        const s = view;
        const { N } = dimOf(s);
        if (N !== gN) build(N);
        an = analyze(s0);
        const n = s0.order.length;
        const prev = seenLines;
        seenLines = n;
        // where the latest turn began: the trailing run of lines by whoever drew last
        let turnStart = n;
        if (c.last) while (turnStart > 0 && drawn(s0, ...unkey(s0.order[turnStart - 1])) === c.last.who) turnStart--;
        let from = n;
        // new lines since the last paint, but never more than the latest turn (after a reconnect,
        // a pile of moves can land at once; replaying all of them one by one would take ages)
        if (prev != null && n > prev) from = Math.max(prev, turnStart);
        else if (prev == null && c.mode === 'online' && c.last && c.last.who !== c.me && n) from = turnStart; // opening the game: replay the partner's latest turn
        if (reduced()) from = n;
        const gap = n - from > 1 ? 260 : 0;
        const boxDelay = new Map();
        for (let i = from; i < n; i++) for (const bi of an.steps[i].closed) boxDelay.set(bi, (i - from) * gap + 220);
        if (n !== prev) sel = null;
        if (!c.canMove) sel = null;
        const heartFresh = s0.heart != null && boxDelay.has(s0.heart);
        cardReady = !heartFresh;
        if (heartFresh) { lsPut(lsKey(c.matchId), ''); later(() => { cardReady = true; renderCard(); fit(); }, boxDelay.get(s0.heart) + 500); }
        renderBoard(c, s, { from, gap, boxes: boxDelay });
        renderCard();
        root.classList.toggle('is-locked', !c.canMove);
        root.classList.remove('is-done');
        root.classList.toggle('has-winner', !!(c.over && c.result && c.result.winner));
        // the end: count it once, find the line to say
        momentOn = false;
        momentText = '';
        if (c.over) {
          if (prevOver === false) tally(c);
          momentText = momentNow(c);
        }
        const wait = boxDelay.size ? Math.max(...boxDelay.values()) + 420 : 0;
        if (c.over) {
          if (wait) later(() => root.classList.add('is-done'), wait); else root.classList.add('is-done');
          if (prevOver === false) later(() => { momentOn = true; renderPlate(); fit(); }, wait + 150); else momentOn = true;
        }
        prevOver = c.over;
        paint();
        if (n > from) {
          for (let i = from; i < n; i++) later(() => { api.sfx(i === n - 1 ? 'place' : 'tick'); }, (i - from) * gap);
          for (let i = from; i < n; i++) {
            const st = an.steps[i];
            const at = (i - from) * gap + 220;
            if (st.closed.length) {
              const hit = (k) => later(() => { chainNote(k); if (k >= 3) say(`Chain of ${k}!`); api.haptic(25); }, at + (k - (st.run - st.closed.length + 1)) * 130);
              for (let k = st.run - st.closed.length + 1; k <= st.run; k++) hit(k);
            }
            if (st.sac) later(() => { say(`${api.name(st.who)} gives up 2 to keep control`); api.sfx('pop'); }, (i - from) * gap + 120);
          }
          if (prev != null) popPlate();
        }
      },
      destroy() {
        for (const t of timers) clearTimeout(t);
        timers.clear();
        if (ro) ro.disconnect();
        window.removeEventListener('resize', fit);
        if (offData) offData();
      },
    };
    return inst;
  },
});
