// Defuse module: MAZE. The bomb shows a 6x6 grid of dots with two hollow rings, a square (you) and
// a triangle (the goal), plus four arrow keys. It never shows a wall: a move into one is a strike.
// The manual holds a book of mazes, one per ring pair. Find the maze with the bomb's two rings, then
// call the route. Mazes are redrawn from the round seed every round, so nothing can be memorised.
//
// Encoding (also what the manual page prints in data-walls): 36 characters, one per cell in reading
// order (row 1 first, column A first). Each character is '0'..'3': +1 = wall on the cell's east side,
// +2 = wall on its south side. Outer edges always carry walls. Cell index i = row * 6 + col, named
// "B3" (column letter, row number). Directions: U/D/L/R; up is toward row 1.
//
//   R (rules)  { n, mirror, mazes: [{ w: walls, m: [cellA, cellB] }], e?: { k, c, d } }  e = errata (see below)
//   S (puzzle) { k: maze index, m: [cellA, cellB] (rings), p: start cell, g: goal cell }
//   solve()    the route as a string of U/D/L/R (the only simple path in a perfect maze)
//   save()     { p: cell, v: [visited cells], b: [bumped walls] }
import { int, pick, shuffle } from './util.js';

const N = 6;
const CELLS = N * N;
const COLS = 'ABCDEF';
const DIRS = 'UDLR';
const name = (i) => COLS[i % N] + (Math.floor(i / N) + 1);
const wallBit = (w, i, b) => ((w.charCodeAt(i) - 48) & b) !== 0;

/** Neighbour of cell i in direction d, or -1 off the board. */
function nbr(i, d) {
  const c = i % N;
  const r = (i - c) / N;
  if (d === 'U') return r > 0 ? i - N : -1;
  if (d === 'D') return r < N - 1 ? i + N : -1;
  if (d === 'L') return c > 0 ? i - 1 : -1;
  return c < N - 1 ? i + 1 : -1;
}
/** Can you walk from i in direction d? */
function open(w, i, d) {
  const j = nbr(i, d);
  if (j < 0) return false;
  if (d === 'R') return !wallBit(w, i, 1);
  if (d === 'L') return !wallBit(w, j, 1);
  if (d === 'D') return !wallBit(w, i, 2);
  return !wallBit(w, j, 2);
}
/** The walls string with the wall between i and its neighbour in direction d (R or D) opened. */
function openWall(w, i, d) {
  const a = w.split('');
  a[i] = String((w.charCodeAt(i) - 48) & (d === 'R' ? 2 : 1));
  return a.join('');
}
function closeWall(w, i, d) {
  const a = w.split('');
  a[i] = String((w.charCodeAt(i) - 48) | (d === 'R' ? 1 : 2));
  return a.join('');
}
/** Breadth-first distances from cell a (-1 = unreachable). */
function dists(w, a) {
  const d = new Array(CELLS).fill(-1);
  d[a] = 0;
  const q = [a];
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (const x of DIRS) { const j = open(w, i, x) ? nbr(i, x) : -1; if (j >= 0 && d[j] < 0) { d[j] = d[i] + 1; q.push(j); } }
  }
  return d;
}
/** The shortest route a to b as 'RRDL…'. */
function route(w, a, b) {
  const from = new Array(CELLS).fill(null);
  from[a] = '';
  const q = [a];
  for (let h = 0; h < q.length && from[b] === null; h++) {
    const i = q[h];
    for (const x of DIRS) { const j = open(w, i, x) ? nbr(i, x) : -1; if (j >= 0 && from[j] === null) { from[j] = from[i] + x; q.push(j); } }
  }
  return from[b] || '';
}

/** A perfect maze by a growing tree: mostly "newest cell" (long corridors), sometimes a random one (branchy). */
function carve(r) {
  const e = new Array(CELLS).fill(1);
  const s = new Array(CELLS).fill(1);
  const seen = new Array(CELLS).fill(false);
  const p = 0.12 + r() * 0.55;
  const first = int(r, CELLS);
  seen[first] = true;
  const act = [first];
  while (act.length) {
    const ai = r() < p ? int(r, act.length) : act.length - 1;
    const i = act[ai];
    const opts = [];
    for (const d of DIRS) { const j = nbr(i, d); if (j >= 0 && !seen[j]) opts.push([d, j]); }
    if (!opts.length) { act.splice(ai, 1); continue; }
    const [d, j] = pick(r, opts);
    if (d === 'R') e[i] = 0; else if (d === 'L') e[j] = 0; else if (d === 'D') s[i] = 0; else s[j] = 0;
    seen[j] = true;
    act.push(j);
  }
  return e.map((v, i) => v + 2 * s[i]).join('');
}

const lo = (T) => ((T.level | 0) >= 3 ? 6 : 4);
const hi = (T) => [8, 11, 14, 18][Math.max(0, Math.min(3, (T.level | 0) - 1))];

/** Start/goal pairs (neither on a ring) with route length in [lo, hi]. With orig: only pairs the opened wall shortens. */
function pairs(w, m, from, to, orig) {
  const out = [];
  for (let p = 0; p < CELLS; p++) {
    if (m.includes(p)) continue;
    const d = dists(w, p);
    const o = orig ? dists(orig, p) : null;
    for (let g = 0; g < CELLS; g++) {
      if (g === p || m.includes(g)) continue;
      if (d[g] >= from && d[g] <= to && (!o || o[g] > d[g])) out.push([p, g]);
    }
  }
  return out;
}

// ── manual drawing ────────────────────────────────────────────────────────
const PAD = 16;
const CELL = 22;
const BOX = PAD + N * CELL + 4;

function mazeSVG(mz, i, mirror) {
  const X = (c) => PAD + (mirror ? N - 1 - c : c) * CELL;
  const Y = (r) => PAD + r * CELL;
  let d = '';
  for (let k = 0; k < CELLS; k++) {
    const c = k % N;
    const r = (k - c) / N;
    if (wallBit(mz.w, k, 1)) { const x = mirror ? X(c) : X(c) + CELL; d += `M${x} ${Y(r)}V${Y(r) + CELL}`; }
    if (wallBit(mz.w, k, 2)) d += `M${X(c)} ${Y(r) + CELL}H${X(c) + CELL}`;
  }
  // outer wall: the east/south bits already draw the right and bottom edges; add the other two
  const left = mirror ? PAD + N * CELL : PAD;
  d += `M${PAD} ${PAD}H${PAD + N * CELL}M${left} ${PAD}V${PAD + N * CELL}`;
  const dots = Array.from({ length: CELLS }, (_, k) => `<circle cx="${X(k % N) + CELL / 2}" cy="${Y(Math.floor(k / N)) + CELL / 2}" r="1.1"/>`).join('');
  const rings = mz.m.map((k) => `<circle class="dx-mz-pr" cx="${X(k % N) + CELL / 2}" cy="${Y(Math.floor(k / N)) + CELL / 2}" r="6.2"/>`).join('');
  const cl = Array.from({ length: N }, (_, c) => `<text x="${X(c) + CELL / 2}" y="12.4">${COLS[c]}</text>`).join('');
  const rl = Array.from({ length: N }, (_, r) => `<text x="8" y="${Y(r) + CELL / 2 + 4.2}">${r + 1}</text>`).join('');
  const mk = mz.m.map(name).join(',');
  return `<svg class="dx-mz-svg" viewBox="0 0 ${BOX} ${BOX}" role="img" aria-label="Maze ${i + 1}, rings at ${mz.m.map(name).join(' and ')}" data-maze="${i}" data-markers="${mk}" data-walls="${mz.w}"><g class="dx-mz-pd">${dots}</g><g class="dx-mz-pl">${cl}${rl}</g><path class="dx-mz-pw" d="${d}"/>${rings}</svg>`;
}

// ── the bomb ──────────────────────────────────────────────────────────────
const GRID = 176;
const GO = 16;
const GS = 26;
const cx = (i) => GO + (i % N) * GS + GS / 2;
const cy = (i) => GO + Math.floor(i / N) * GS + GS / 2;
const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 15.5L12 8.5l6.5 7"/></svg>';
const KEYS = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' };
const WORD = { U: 'up', D: 'down', L: 'left', R: 'right' };

function bombHTML(S, mz) {
  const dots = Array.from({ length: CELLS }, (_, i) => `<circle cx="${cx(i)}" cy="${cy(i)}" r="1.9"/>`).join('');
  const cl = Array.from({ length: N }, (_, c) => `<text x="${GO + c * GS + GS / 2}" y="12">${COLS[c]}</text>`).join('');
  const rl = Array.from({ length: N }, (_, r) => `<text x="8" y="${GO + r * GS + GS / 2 + 4}">${r + 1}</text>`).join('');
  const rings = mz.m.map((i) => `<circle class="dx-mz-ring" cx="${cx(i)}" cy="${cy(i)}" r="8.6"/>`).join('');
  const gx = cx(S.g);
  const gy = cy(S.g);
  const goal = `<polygon class="dx-mz-goal" points="${gx},${gy - 8.5} ${gx + 8.5},${gy + 7} ${gx - 8.5},${gy + 7}"/>`;
  const label = `Maze. Rings at ${mz.m.map(name).join(' and ')}. Goal triangle at ${name(S.g)}.`;
  const btn = (d) => `<button type="button" class="dx-mz-btn" data-dir="${d}" aria-label="Move ${WORD[d]}">${CHEV}</button>`;
  return `<div class="dx-mz">
    <div class="dx-mz-screen"><svg viewBox="0 0 ${GRID} ${GRID}" role="img" aria-label="${label}">
      <g class="dx-mz-labels">${cl}${rl}</g><g class="dx-mz-dots">${dots}</g>
      <g class="dx-mz-trail"></g><g class="dx-mz-bumps"></g>${rings}${goal}
      <g class="dx-mz-me"><g class="dx-mz-nudge"><rect x="-7" y="-7" width="14" height="14" rx="1.5"/></g></g>
    </svg></div>
    <div class="dx-mz-pad" role="group" aria-label="Move the square">${btn('U')}${btn('L')}${btn('D')}${btn('R')}</div>
  </div>`;
}

const css = `
.g-defuse .dx-mz { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 14px; padding-bottom: 5px; }
.g-defuse .dx-mz-screen { width: min(100%, 232px); aspect-ratio: 1; padding: 4px; background: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: inset 0 -5px 0 rgb(255 255 255 / 0.06), var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
.g-defuse .dx-mz-screen svg { display: block; width: 100%; height: 100%; overflow: visible; }
.g-defuse .dx-mz-labels text { fill: #8d8a80; font: 800 11px/1 var(--g-font-body); text-anchor: middle; opacity: 0.9; }
.g-defuse .dx-mz-dots circle { fill: #77746b; }
.g-defuse .dx-mz-trail circle { fill: #4d4a58; }
.g-defuse .dx-mz-ring { fill: none; stroke: var(--dx-yellow); stroke-width: 2.4; }
.g-defuse .dx-mz-goal { fill: var(--dx-red); stroke: var(--dx-white); stroke-width: 1.6; stroke-linejoin: round; }
.g-defuse .dx-mz-me { transition: transform 0.12s ease-out; }
.g-defuse .dx-mz-me rect { fill: var(--dx-white); stroke: var(--dx-dark); stroke-width: 1.5; }
.g-defuse .dx-mz-bumps line { stroke: var(--dx-red); stroke-width: 3; stroke-linecap: round; }
.g-defuse .dx-mz-pad { display: grid; grid-template-columns: repeat(3, 52px); grid-template-rows: repeat(2, 52px); gap: 9px; }
.g-defuse .dx-mz-btn { display: grid; place-items: center; width: 52px; height: 52px; padding: 0; background: var(--dx-white); color: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--g-ink); transition: transform 0.16s var(--g-ease-spring); touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.g-defuse .dx-mz-btn svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 3.6; stroke-linecap: round; stroke-linejoin: round; }
.g-defuse .dx-mz-btn[data-dir="U"] { grid-column: 2; grid-row: 1; }
.g-defuse .dx-mz-btn[data-dir="L"] { grid-column: 1; grid-row: 2; } .g-defuse .dx-mz-btn[data-dir="L"] svg { transform: rotate(-90deg); }
.g-defuse .dx-mz-btn[data-dir="D"] { grid-column: 2; grid-row: 2; } .g-defuse .dx-mz-btn[data-dir="D"] svg { transform: rotate(180deg); }
.g-defuse .dx-mz-btn[data-dir="R"] { grid-column: 3; grid-row: 2; } .g-defuse .dx-mz-btn[data-dir="R"] svg { transform: rotate(90deg); }
.g-defuse .dx-mz-btn:active { transform: translateY(4px); box-shadow: 0 1px 0 var(--g-ink); }
.g-defuse .dx-mz-btn:focus-visible { outline: 3px solid var(--p-a); outline-offset: 3px; }
.g-defuse .dx-mod.is-solved .dx-mz-btn { opacity: 0.55; }

/* the manual's book of mazes */
.g-defuse .dx-mz-book { display: grid; grid-template-columns: repeat(auto-fill, minmax(138px, 1fr)); gap: 12px; margin: 10px 0 4px; }
.g-defuse .dx-mz-fig { margin: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px 8px 6px; background: var(--g-bg); border: 2px solid var(--g-ink); border-radius: 10px; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
.g-defuse .dx-mz-id { display: flex; align-items: center; gap: 6px; font: 800 0.92rem/1 ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; letter-spacing: 0.06em; }
.g-defuse .dx-mz-id i { flex: none; width: 13px; height: 13px; border: 2.2px solid var(--g-ink); border-radius: 50%; }
.g-defuse .dx-mz-id i + b + i { margin-left: 2px; }
.g-defuse .dx-mz-svg { display: block; width: 100%; height: auto; background: var(--g-card); }
.g-defuse .dx-mz-pw { fill: none; stroke: var(--g-ink); stroke-width: 2.3; stroke-linecap: square; stroke-linejoin: miter; }
.g-defuse .dx-mz-pd circle { fill: var(--g-muted); opacity: 0.55; }
.g-defuse .dx-mz-pl text { fill: var(--g-muted); font: 800 12px/1 var(--g-font-body); text-anchor: middle; }
.g-defuse .dx-mz-pr { fill: var(--g-hl-soft, none); stroke: var(--g-ink); stroke-width: 2; }
.g-defuse .dx-mz-flip { margin: 10px 0 0; padding: 10px 12px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-hl-soft, var(--g-bg)); font-weight: 700; font-size: 0.98rem; }
@media (max-width: 440px) { .g-defuse .dx-mz-book { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .g-defuse .dx-mz-fig { padding: 6px 6px 4px; } }
`;

export const MAZE = {
  id: 'maze',
  name: 'Maze',
  tab: 'Maze',
  tiers: ['chill', 'normal', 'spicy', 'wild'],
  needy: false,
  remote: false,
  css,

  rules(r, T) {
    const lvl = T.level | 0;
    const n = lvl >= 3 ? 9 : 6;
    const walls = new Set();
    const rings = new Set();
    const mazes = [];
    while (mazes.length < n) {
      const w = carve(r);
      let a = int(r, CELLS);
      let b = int(r, CELLS - 1);
      if (b >= a) b++;
      if (a > b) [a, b] = [b, a];
      if (walls.has(w) || rings.has(a * CELLS + b)) continue;
      walls.add(w);
      rings.add(a * CELLS + b);
      mazes.push({ w, m: [a, b] });
    }
    mazes.sort((x, y) => x.m[0] - y.m[0] || x.m[1] - y.m[1]);
    return { n, mirror: lvl >= 4 ? 1 : 0, mazes };
  },

  // A wall the printer forgot: in one maze a wall is not there. Only offered where it shortens some route.
  errata(r, R, T) {
    const from = lo(T);
    const to = hi(T);
    for (const k of shuffle(r, R.mazes.map((_, i) => i))) {
      const mz = R.mazes[k];
      const cands = [];
      for (let i = 0; i < CELLS; i++) {
        const d = dists(mz.w, i);
        for (const x of 'RD') { const j = nbr(i, x); if (j >= 0 && !open(mz.w, i, x) && d[j] >= 7) cands.push([i, x, j]); }
      }
      for (const [i, x, j] of shuffle(r, cands).slice(0, 8)) {
        const w2 = openWall(mz.w, i, x);
        if (!pairs(w2, mz.m, from, to, mz.w).length) continue;
        const note = `<p class="dx-mz-slip" data-errata="maze" data-maze="${k}" data-markers="${mz.m.map(name).join(',')}" data-cell="${name(i)}" data-dir="${x}">Correction: in the maze with rings at <b>${name(mz.m[0])}</b> and <b>${name(mz.m[1])}</b>, the wall between <b>${name(i)}</b> and <b>${name(j)}</b> was never printed. Treat that gap as open.</p>`;
        return { R: { ...R, mazes: R.mazes.map((m, y) => (y === k ? { ...m, w: w2 } : m)), e: { k, c: i, d: x } }, note };
      }
    }
    return null;
  },

  page(R) {
    const flip = R.mirror ? `<p class="dx-mz-flip" data-mirror="1"><b>This page was printed mirrored.</b> Column A is on the right-hand side and F on the left, so left on the page is right on the bomb, and right is left. Go by the coordinate letters. Up and down are not flipped.</p>` : '';
    const figs = R.mazes.map((mz, i) => `<figure class="dx-mz-fig"><figcaption class="dx-mz-id"><i></i><b>${name(mz.m[0])}</b><i></i><b>${name(mz.m[1])}</b></figcaption>${mazeSVG(mz, i, !!R.mirror)}</figure>`).join('');
    return `<p class="dx-intro">Your partner can’t see the walls, and you can’t see where they are. Together you get the square to the triangle without hitting a wall.</p>
<ol class="dx-rules">
<li><span>Ask for the <b>two rings</b> (hollow circles on their grid), for example “B2 and E5”. Find the one maze below that has exactly those two rings.</span></li>
<li><span>Ask where the <b>square</b> is and where the <b>triangle</b> is. Columns are the letters A to F, rows are the numbers 1 to 6, printed on the edge of the grid.</span></li>
<li><span>Trace a route from the square to the triangle and call it one move at a time: <b>up</b>, <b>down</b>, <b>left</b> or <b>right</b>. Up is toward row 1.</span></li>
</ol>
${flip}
<div class="dx-mz-book" data-count="${R.mazes.length}" data-mirror="${R.mirror ? 1 : 0}">${figs}</div>
<p class="dx-note">A move into a wall is a strike, and the square stays where it is. The rings never sit on the square or the triangle. No two mazes share a pair of rings.</p>`;
  },

  gen(r, E, R, T) {
    const e = R.e || null;
    const k = e ? e.k : int(r, R.mazes.length);
    const mz = R.mazes[k];
    const orig = e ? closeWall(mz.w, e.c, e.d) : null;
    let list = pairs(mz.w, mz.m, lo(T), hi(T), orig);
    if (!list.length && orig) list = pairs(mz.w, mz.m, lo(T), 99, orig);
    if (!list.length) list = pairs(mz.w, mz.m, lo(T), hi(T), null);
    if (!list.length) list = pairs(mz.w, mz.m, lo(T), 99, null);
    const [p, g] = pick(r, list);
    return { k, m: [...mz.m], p, g };
  },

  solve(S, E, R) {
    return route(R.mazes[S.k].w, S.p, S.g);
  },

  mount(box, S, R, host) {
    const w = R.mazes[S.k].w;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ok = (v) => Number.isInteger(v) && v >= 0 && v < CELLS;
    let pos = S.p;
    let seen = [S.p];
    let bumps = [];
    const sv = host.saved;
    if (sv && ok(sv.p)) {
      pos = sv.p;
      seen = Array.isArray(sv.v) ? sv.v.filter(ok).slice(-80) : [pos];
      bumps = Array.isArray(sv.b) ? sv.b.filter((v) => Number.isInteger(v) && v >= 0 && v < CELLS * 4).slice(-24) : [];
    }
    box.innerHTML = bombHTML(S, R.mazes[S.k]);
    const me = box.querySelector('.dx-mz-me');
    const nudge = box.querySelector('.dx-mz-nudge');
    const trail = box.querySelector('.dx-mz-trail');
    const bumpG = box.querySelector('.dx-mz-bumps');
    let last = null; // { k, at } the last wall hit, for the double-tap debounce

    const NS = 'http://www.w3.org/2000/svg';
    const place = () => {
      me.style.transform = `translate(${cx(pos)}px, ${cy(pos)}px)`;
      trail.textContent = '';
      for (const i of seen) {
        if (i === pos) continue;
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', cx(i)); c.setAttribute('cy', cy(i)); c.setAttribute('r', 3.4);
        trail.appendChild(c);
      }
      bumpG.textContent = '';
      for (const b of bumps) {
        const i = b >> 2;
        const d = DIRS[b & 3];
        const x = cx(i);
        const y = cy(i);
        const l = document.createElementNS(NS, 'line');
        const h = GS / 2 - 1;
        const q = 8;
        if (d === 'U' || d === 'D') { const yy = y + (d === 'U' ? -h : h); l.setAttribute('x1', x - q); l.setAttribute('x2', x + q); l.setAttribute('y1', yy); l.setAttribute('y2', yy); }
        else { const xx = x + (d === 'L' ? -h : h); l.setAttribute('y1', y - q); l.setAttribute('y2', y + q); l.setAttribute('x1', xx); l.setAttribute('x2', xx); }
        bumpG.appendChild(l);
      }
    };
    place();

    function move(d) {
      if (host.busy()) return;
      if (open(w, pos, d)) {
        pos = nbr(pos, d);
        if (!seen.includes(pos)) seen.push(pos);
        place();
        host.sfx('tap');
        if (pos === S.g) host.solve();
        return;
      }
      // a wall: one tap, one strike (a double tap on the same wall within 400 ms is one mistake)
      const now = host.now();
      const key = pos * 4 + DIRS.indexOf(d);
      if (last && last.k === key && now - last.at < 400) return;
      last = { k: key, at: now };
      if (!bumps.includes(key)) bumps.push(key);
      place();
      if (!reduce && nudge.animate) {
        const v = { U: [0, -3], D: [0, 3], L: [-3, 0], R: [3, 0] }[d];
        nudge.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${v[0]}px, ${v[1]}px)` }, { transform: 'translate(0,0)' }], { duration: 170 });
      }
      host.strike('maze');
    }

    return {
      click(e) {
        const b = e.target.closest && e.target.closest('[data-dir]');
        if (b && box.contains(b)) move(b.dataset.dir);
      },
      key(e) {
        if (e.type !== 'keydown' || e.repeat) return;
        const d = KEYS[e.key];
        if (!d || e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        move(d);
      },
      save() { return { p: pos, v: seen.slice(-80), b: bumps.slice(-24) }; },
      destroy() { box.textContent = ''; },
    };
  },

  drive(S, E, R, live) {
    const from = live && Number.isInteger(live.p) ? live.p : S.p;
    return route(R.mazes[S.k].w, from, S.g).split('').map((d) => ({ sel: `.dx-mz-btn[data-dir="${d}"]`, act: 'tap' }));
  },
};
