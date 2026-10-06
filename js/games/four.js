// Four in a Row: 7 columns × 6 rows with gravity. Tap a column to lift your disc over it,
// tap the same column again to drop it (a mouse drops on click, keys 1–7 / arrows + Enter).
// Four in a line wins; a full board is a draw.
import { registerGame } from './core.js';

const COLS = 7;
const ROWS = 6;
const other = (w) => (w === 'a' ? 'b' : 'a');
const DIRS = [[1, 0, 'across'], [0, 1, 'down'], [1, 1, 'diag'], [1, -1, 'diag']];

/** Every line of four or more through (c, r) for `who`. r counts up from the bottom. */
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

// ── geometry (SVG user units) ──
const U = 100; // one cell
const P = 16; // frame around the holes
const TOP = 112; // the lift row above the board
const BW = COLS * U + 2 * P;
const BH = ROWS * U + 2 * P;
const VW = BW + 10;
const VH = TOP + BH + 30;
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
const DISC_INNER = `<circle class="g4-d-body" r="${DISC}"/><circle class="g4-d-ring" r="27"/><circle class="g4-d-groove" r="22"/><circle class="g4-d-dot" r="9"/>`;
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, cls) => { const e = document.createElementNS(SVGNS, tag); if (cls) e.setAttribute('class', cls); return e; };

registerGame({
  id: 'four',
  title: 'Four in a Row',
  blurb: 'Drop discs. Line up four before they do.',
  kind: 'turns',
  team: false,
  tags: ['quick'],
  platforms: ['phone', 'computer'],
  minutes: 5,
  endDelay: 1900,
  howTo: [
    'Tap a column to lift your disc over it. Tap it again to drop.',
    'Discs fall to the lowest open hole.',
    'Four in a row wins: across, up and down, or diagonal.',
    'Board full with no four? It’s a draw.',
  ],

  // ── rules (pure, deterministic) ──
  init: ({ first }) => ({ cols: Array.from({ length: COLS }, () => []), turn: first, n: 0, win: null }),
  next: (s) => (s.win || s.n >= COLS * ROWS ? [] : [s.turn]),
  apply(s, who, move) {
    const col = move && move.col;
    if (!Number.isInteger(col) || col < 0 || col >= COLS) throw new Error('Pick one of the seven columns');
    if (who !== s.turn) throw new Error('Not your turn');
    if (s.cols[col].length >= ROWS) throw new Error('That column is full');
    const r = s.cols[col].length;
    s.cols[col].push(who);
    s.n++;
    const runs = runsThrough(s.cols, col, r, who);
    if (runs.length) s.win = { who, runs };
    s.turn = other(who);
    return s;
  },
  result(s) {
    if (s.win) {
      const dirs = [...new Set(s.win.runs.map((x) => x.dir))];
      const sub = dirs.length > 1 ? 'Two lines with one disc!' : dirs[0] === 'across' ? 'Four across' : dirs[0] === 'down' ? 'Four stacked up' : 'Four on the diagonal';
      return { winner: s.win.who, sub };
    }
    return { winner: null, text: 'Board full', sub: 'Nobody lined up four. It’s a draw.' };
  },

  // ── view ──
  css: `
.g-four { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 2px 0 10px; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.g-four .g4-wrap { position: relative; width: min(100%, 560px, calc((100vh - 250px) * ${(VW / VH).toFixed(3)})); width: min(100%, 560px, calc((100dvh - 250px) * ${(VW / VH).toFixed(3)})); min-width: 260px; }
.g-four .g4-svg { display: block; width: 100%; height: auto; overflow: visible; }
.g-four .g4-edge { fill: var(--g-ink); }
.g-four .g4-foot { fill: var(--g-ink); }
.g-four .g4-back { fill: color-mix(in srgb, var(--g-ink) 9%, var(--g-bg)); }
.g-four .g4-face { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 2px; vector-effect: non-scaling-stroke; }
.g-four .g4-rule { fill: none; stroke: var(--g-ink); stroke-width: 1px; vector-effect: non-scaling-stroke; opacity: 0.35; }
.g-four .g4-board.thud { animation: g4-thud 190ms ease-out; }
@keyframes g4-thud { 0% { transform: translateY(0); } 35% { transform: translateY(5px); } 100% { transform: translateY(0); } }

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
.g-four.is-won .g4-d:not(.is-win) .g4-fall { opacity: 0.38; }

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

.g-four .g4-wr { transform-box: fill-box; transform-origin: center; animation: g4-ring 380ms cubic-bezier(0.3, 1.5, 0.5, 1) both; }
.g-four .g4-wr-ink { fill: none; stroke: var(--g-ink); stroke-width: 15; }
.g-four .g4-wr-hl { fill: none; stroke: var(--g-hl); stroke-width: 9; }
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
.g-four .g4-colhl { opacity: 0; transition: opacity 120ms; }
.g-four .g4-colhl.g4-a { fill: color-mix(in srgb, var(--p-a) 30%, var(--g-bg)); }
.g-four .g4-colhl.g4-b { fill: color-mix(in srgb, var(--p-b) 30%, var(--g-bg)); }
.g-four .g4-colhl.on { opacity: 1; }
.g-four .g4-nums { display: none; width: 100%; padding: 0 ${pct(VW - BW + P, VW)} 0 ${pct(P, VW)}; margin-top: -2px; }
.g-four .g4-nums span { flex: 1; text-align: center; font: 800 0.78rem/1 var(--g-font-display); color: var(--g-muted); }
.g-four .g4-nums span.on { color: var(--g-ink); }
@media (hover: hover) and (pointer: fine) { .g-four .g4-nums { display: flex; } }

.g-four .g4-plate { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 16px 8px 10px; border-radius: 999px; background: var(--g-card); border: 2px solid var(--g-ink); box-shadow: var(--g-shadow); font: 800 0.98rem/1.2 var(--g-font-display); color: var(--g-ink); max-width: 100%; }
.g-four .g4-plate.wait { color: var(--g-muted); border-color: var(--g-line); }
.g-four .g4-plate.pop { animation: g4-plate 260ms cubic-bezier(0.3, 1.5, 0.5, 1); }
@keyframes g4-plate { from { transform: scale(0.92); } to { transform: none; } }
.g-four .g4-chip { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--g-ink); box-shadow: inset 0 0 0 4px color-mix(in srgb, var(--g-ink) 22%, transparent); }
.g-four .g4-chip.none { background: transparent; border-style: dashed; box-shadow: none; }
@media (prefers-reduced-motion: reduce) {
  .g-four *, .g-four .g4-lift.on .g4-bob { animation: none !important; transition: none !important; }
}
`,

  mount(el, api) {
    const root = document.createElement('div');
    root.className = 'g-four';
    root.innerHTML = `
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
            <circle class="g4-ghost" r="${HOLE - 7}" cx="0" cy="0"/>
            <g class="g4-marks"></g>
          </g>
          <g class="g4-lift instant"><g class="g4-bob"><circle class="g4-lift-shadow" cx="6" cy="8" r="${DISC}"/>${DISC_INNER}</g></g>
        </svg>
        <div class="g4-strip" role="group" aria-label="Columns">
          ${Array.from({ length: COLS }, (_, c) => `<button type="button" class="g4-col" data-col="${c}" aria-label="Column ${c + 1}"></button>`).join('')}
        </div>
      </div>
      <div class="g4-nums" aria-hidden="true">${Array.from({ length: COLS }, (_, c) => `<span>${c + 1}</span>`).join('')}</div>
      <div class="g4-plate" aria-live="polite"><span class="g4-chip"></span><span class="g4-plate-t"></span></div>`;
    el.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const board = $('.g4-board');
    const discLayer = $('.g4-discs');
    const marks = $('.g4-marks');
    const ghost = $('.g4-ghost');
    const colhl = $('.g4-colhl');
    const liftG = $('.g4-lift');
    const bob = $('.g4-bob');
    const strip = $('.g4-strip');
    const plate = $('.g4-plate');
    const buttons = [...root.querySelectorAll('.g4-col')];
    const nums = [...root.querySelectorAll('.g4-nums span')];

    let ctx = null;
    let seen = null; // moves count at the last update
    let lifted = null; // column the disc hovers over
    let liftedBy = null; // 'tap' | 'hover' | 'key'
    let lastPT = '';
    let plateText = '';
    const discEls = new Map();
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
    const full = (col) => !ctx || ctx.state.cols[col].length >= ROWS;

    function renderDiscs(c, animKey, fallMs) {
      const want = new Set();
      c.state.cols.forEach((stack, x) => stack.forEach((who, y) => {
        const k = `${x}-${y}`;
        want.add(k);
        let g = discEls.get(k);
        if (g && g.dataset.who !== who) { g.remove(); g = null; }
        if (!g) {
          g = svgEl('g', `g4-d g4-${who}`);
          g.dataset.who = who;
          g.setAttribute('transform', `translate(${cx(x)} ${cy(y)})`);
          const f = svgEl('g', 'g4-fall');
          f.innerHTML = DISC_INNER;
          if (k === animKey) {
            f.style.setProperty('--dy', `${LIFT_Y - cy(y)}px`);
            f.style.animationDuration = `${fallMs}ms`;
            f.classList.add('is-falling');
          }
          g.appendChild(f);
          discLayer.appendChild(g);
          discEls.set(k, g);
        }
      }));
      for (const [k, g] of discEls) if (!want.has(k)) { g.remove(); discEls.delete(k); }
      const lc = c.last && c.last.move ? c.last.move.col : null;
      const lastK = lc != null && c.state.cols[lc] ? `${lc}-${c.state.cols[lc].length - 1}` : null;
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
      marks.innerHTML = html;
      if (delay > 0) later(() => { root.classList.add('is-won'); api.sfx('good'); api.haptic(30); }, delay);
      else root.classList.add('is-won');
    }

    function renderLift(instant) {
      const on = lifted != null && !!ctx && ctx.canMove;
      const who = (ctx && ctx.actor) || 'a';
      const jump = instant || !liftG.classList.contains('on');
      liftG.setAttribute('class', `g4-lift g4-${who}${on ? ' on' : ''}${jump ? ' instant' : ''}`);
      if (on) {
        liftG.style.transform = `translate(${cx(lifted)}px, ${LIFT_Y}px)`;
        // flush the jump, then let later column changes glide
        if (jump) { void liftG.getBoundingClientRect(); liftG.classList.remove('instant'); }
      }
      const canLand = on && !full(lifted);
      ghost.setAttribute('class', `g4-ghost${canLand ? ' on' : ''} g4-${who}`);
      if (canLand) { ghost.setAttribute('cx', cx(lifted)); ghost.setAttribute('cy', cy(ctx.state.cols[lifted].length)); }
      colhl.setAttribute('class', `g4-colhl g4-${who}${on ? ' on' : ''}`);
      if (on) colhl.setAttribute('x', P + lifted * U);
      buttons.forEach((b, i) => { b.classList.toggle('is-lifted', on && i === lifted); b.setAttribute('aria-pressed', on && i === lifted ? 'true' : 'false'); });
      nums.forEach((n, i) => n.classList.toggle('on', on && i === lifted));
    }

    function renderPlate() {
      const c = ctx;
      if (!c) return;
      let who = c.actor;
      let text;
      let wait = false;
      const online = c.mode === 'online';
      if (c.over) {
        const w = c.state.win && c.state.win.who;
        who = w || null;
        text = w ? `${api.name(w)} lined up four` : 'Board full. It’s a draw.';
      } else if (!c.canMove) {
        who = c.acts[0] || null;
        wait = true;
        text = `${api.name(who)}’s turn`;
      } else if (lifted == null) {
        text = online ? 'Your turn · tap a column' : `${api.name(who)}, tap a column`;
      } else if (full(lifted)) {
        text = 'That column is full. Pick another.';
      } else {
        text = liftedBy === 'hover' ? 'Click to drop' : liftedBy === 'key' ? 'Enter or Space to drop' : `Tap column ${lifted + 1} again to drop`;
      }
      $('.g4-chip').className = `g4-chip ${who ? 'g4-' + who : 'none'}`;
      plate.classList.toggle('wait', wait);
      if (text !== plateText) {
        plateText = text;
        $('.g4-plate-t').textContent = text;
      }
    }
    const popPlate = () => { plate.classList.remove('pop'); void plate.offsetWidth; plate.classList.add('pop'); };

    function lift(col, by) {
      if (!ctx || !ctx.canMove || col < 0 || col >= COLS) return;
      const was = lifted;
      lifted = col;
      liftedBy = by;
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
    function drop(col) {
      if (!ctx || !ctx.canMove) return;
      const r = api.move({ col });
      if (!r.ok) {
        api.toast(r.error);
        api.sfx('bad');
        api.haptic(40);
        if (lifted !== col) lift(col, liftedBy || 'tap');
        shake();
      }
    }

    // input: touch lifts then drops; a mouse previews on hover and drops on click
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
      const col = Number(b.dataset.col);
      const pt = e.pointerType || lastPT || 'touch';
      lastPT = '';
      if (pt === 'mouse' || lifted === col) drop(col);
      else lift(col, 'tap');
    });
    const onKey = (e) => {
      if (!ctx || !ctx.canMove || !root.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('#game-root .gm-sheet:not([hidden]), #game-root .gm-end:not([hidden])')) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const foreignButton = t && t.closest && t.closest('button, a') && !root.contains(t);
      if (/^[1-7]$/.test(e.key)) { e.preventDefault(); lift(Number(e.key) - 1, 'key'); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const d = e.key === 'ArrowLeft' ? -1 : 1;
        lift(lifted == null ? 3 : Math.max(0, Math.min(COLS - 1, lifted + d)), 'key');
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') && !foreignButton) {
        e.preventDefault();
        if (lifted == null) lift(3, 'key');
        else drop(lifted);
      }
    };
    document.addEventListener('keydown', onKey);

    return {
      update(c) {
        const prevSeen = seen;
        ctx = c;
        seen = c.moves;
        const moved = prevSeen !== c.moves;
        // a new move since the last paint: animate it. On first paint, replay the partner's last move.
        const animate = c.last && (prevSeen == null ? c.mode === 'online' && c.last.who !== c.me : c.moves === prevSeen + 1);
        let landMs = 0;
        let animKey = null;
        let fallMs = 0;
        if (animate && c.last.move) {
          const col = c.last.move.col;
          const row = c.state.cols[col].length - 1;
          animKey = `${col}-${row}`;
          fallMs = reduced() ? 0 : Math.round(330 + (ROWS - row) * 55);
          landMs = Math.round(fallMs * 0.62);
          later(() => {
            api.sfx('place');
            api.haptic(16);
            if (!reduced()) { board.classList.remove('thud'); void board.getBoundingClientRect(); board.classList.add('thud'); }
          }, landMs);
        }
        if (moved || !c.canMove) { lifted = null; liftedBy = null; }
        renderDiscs(c, reduced() ? null : animKey, fallMs);
        renderWin(c, c.over && animate ? landMs + 220 : 0);
        buttons.forEach((b, i) => {
          b.disabled = !c.canMove;
          b.setAttribute('aria-label', `Column ${i + 1}${c.state.cols[i].length >= ROWS ? ', full' : ''}`);
        });
        root.classList.toggle('is-locked', !c.canMove);
        renderLift(true);
        renderPlate();
        if (moved && prevSeen != null) popPlate();
      },
      destroy() {
        document.removeEventListener('keydown', onKey);
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
