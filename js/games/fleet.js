// Battleships: hide five ships on an 8×8 chart, then take turns shelling each other's waters.
//
// Rules (pure): phase 'place' is simultaneous (each player locks in one { fleet } move), then
// 'battle' alternates { r, c } shots, `first` firing first. A hit (or sink) fires again; a miss
// passes the turn. Ships may touch but never overlap. First to sink all five wins.
//
// View: only ctx.viewer's own fleet is ever drawn. Enemy ships reach the DOM only once sunk
// (or when the game is over); before that the target chart shows nothing but your own shots.
import { registerGame } from './core.js';

const N = 8;
const SIZES = [4, 3, 3, 2, 2];
const LETTERS = 'ABCDEFGH';
const coord = (r, c) => LETTERS[c] + (r + 1);
const foeOf = (w) => (w === 'a' ? 'b' : 'a');
const onChart = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const cellsOf = (s) => Array.from({ length: s.len }, (_, i) => (s.dir === 'v' ? [s.r + i, s.c] : [s.r, s.c + i]));
const covers = (s, r, c) => (s.dir === 'v' ? c === s.c && r >= s.r && r < s.r + s.len : r === s.r && c >= s.c && c < s.c + s.len);
const isInt = Number.isInteger;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ── rules ────────────────────────────────────────────────────────────────
function checkFleet(fleet) {
  if (!Array.isArray(fleet) || fleet.length !== SIZES.length) throw new Error('A fleet is five ships: one 4-long, two 3-long and two 2-long.');
  for (const s of fleet) {
    if (!s || typeof s !== 'object' || !isInt(s.r) || !isInt(s.c) || !isInt(s.len) || (s.dir !== 'h' && s.dir !== 'v')) throw new Error('That fleet doesn’t make sense.');
  }
  const lens = fleet.map((s) => s.len).sort().join();
  if (lens !== [...SIZES].sort().join()) throw new Error('A fleet is five ships: one 4-long, two 3-long and two 2-long.');
  const taken = new Set();
  for (const s of fleet) {
    for (const [r, c] of cellsOf(s)) {
      if (!onChart(r, c)) throw new Error('A ship is hanging off the chart.');
      if (taken.has(r * N + c)) throw new Error('Ships can’t overlap.');
      taken.add(r * N + c);
    }
  }
  return fleet.map((s) => ({ r: s.r, c: s.c, len: s.len, dir: s.dir }));
}

/** Indices of w's ships that have been sunk. */
const sunkOf = (s, w) => s.shots.filter((x) => x.by === foeOf(w) && x.sunk >= 0).map((x) => x.sunk);
const afloat = (s, w) => SIZES.length - sunkOf(s, w).length;
/** Indices of the most recent unbroken run of shots by one player, ending before `end`. */
function lastRun(shots, end = shots.length) {
  const out = [];
  if (end <= 0) return out;
  const by = shots[end - 1].by;
  for (let i = end - 1; i >= 0 && shots[i].by === by; i--) out.unshift(i);
  return out;
}
/** The latest run of shots fired by `w` (anywhere in the log). */
function lastRunBy(shots, w) {
  for (let i = shots.length - 1; i >= 0; i--) if (shots[i].by === w) return lastRun(shots, i + 1);
  return [];
}

const rules = {
  init: ({ first }) => ({ first, phase: 'place', turn: first, fleets: { a: null, b: null }, shots: [], winner: null }),
  next(s) {
    if (s.phase === 'place') return [s.first, foeOf(s.first)].filter((w) => !s.fleets[w]);
    if (s.phase === 'battle') return [s.turn];
    return [];
  },
  apply(s, who, mv) {
    if (!mv || typeof mv !== 'object') throw new Error('That move doesn’t make sense.');
    if (s.phase === 'place') {
      if (s.fleets[who]) throw new Error('Your fleet is already in position.');
      if (!('fleet' in mv)) throw new Error('Hide your fleet first.');
      s.fleets[who] = checkFleet(mv.fleet);
      if (s.fleets.a && s.fleets.b) { s.phase = 'battle'; s.turn = s.first; }
      return s;
    }
    if (s.phase !== 'battle') throw new Error('The battle is over.');
    if (who !== s.turn) throw new Error('Not your turn. Wait for their shot.');
    const { r, c } = mv;
    if (!isInt(r) || !isInt(c) || !onChart(r, c)) throw new Error('That’s off the chart.');
    if (s.shots.some((x) => x.by === who && x.r === r && x.c === c)) throw new Error(`You already fired at ${coord(r, c)}.`);
    const foe = foeOf(who);
    const fleet = s.fleets[foe];
    const idx = fleet.findIndex((ship) => covers(ship, r, c));
    const shot = { by: who, r, c, hit: idx >= 0 ? 1 : 0, sunk: -1 };
    s.shots.push(shot);
    if (idx >= 0) {
      const mine = s.shots.filter((x) => x.by === who);
      if (cellsOf(fleet[idx]).every(([rr, cc]) => mine.some((x) => x.r === rr && x.c === cc))) shot.sunk = idx;
      if (afloat(s, foe) === 0) { s.phase = 'over'; s.winner = who; }
      // a hit fires again: the turn stays put
    } else s.turn = foe;
    return s;
  },
  result(s) {
    const w = s.winner;
    if (!w) return { winner: null };
    const mine = s.shots.filter((x) => x.by === w);
    const hits = mine.filter((x) => x.hit).length;
    const left = afloat(s, w);
    return {
      winner: w,
      sub: `Sank all five in ${mine.length} shots (${Math.round((hits / Math.max(1, mine.length)) * 100)}% on target)${left === SIZES.length ? ' without losing a ship.' : `, with ${left} ${left === 1 ? 'ship' : 'ships'} still afloat.`}`,
    };
  },
  score(s) {
    if (s.phase === 'place') return null;
    return { a: afloat(s, 'a'), b: afloat(s, 'b') };
  },
};

// ── drawing helpers ─────────────────────────────────────────────────────
/** An inked ship silhouette. Horizontal: bow to the right. Vertical: bow down. */
function shipSVG(len, dir, simple = false) {
  const W = len * 100;
  const hull = `M14 25H${W - 66}C${W - 30} 25 ${W - 12} 40 ${W - 4} 50C${W - 12} 60 ${W - 30} 75 ${W - 66} 75H14Q7 75 7 68V32Q7 25 14 25Z`;
  const T = (x, fwd) => `<circle cx="${x}" cy="50" r="10"/><path class="fl-gun" d="M${x + (fwd ? 9 : -9)} 50H${x + (fwd ? 30 : -30)}"/>`;
  let deck;
  if (simple) deck = `<rect x="${Math.round(W * 0.36)}" y="39" width="${len * 16}" height="22" rx="5"/>`;
  else if (len === 2) deck = `<rect x="28" y="38" width="56" height="24" rx="5"/>${T(128, true)}`;
  else if (len === 3) deck = `${T(56, false)}<rect x="94" y="36" width="72" height="28" rx="5"/>${T(206, true)}`;
  else deck = `${T(50, false)}${T(100, false)}<rect x="136" y="35" width="82" height="30" rx="5"/><rect x="228" y="41" width="22" height="18" rx="4"/>${T(296, true)}`;
  const body = `<path class="fl-hull" d="${hull}"/><g class="fl-deck">${deck}</g>`;
  return dir === 'v'
    ? `<svg viewBox="0 0 100 ${W}" aria-hidden="true" focusable="false"><g transform="translate(100 0) rotate(90)">${body}</g></svg>`
    : `<svg viewBox="0 0 ${W} 100" aria-hidden="true" focusable="false">${body}</svg>`;
}
const BURST = (() => {
  const outer = [42, 33, 45, 35, 41, 31, 44, 36];
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 * i) / 16 - Math.PI / 2;
    const rr = i % 2 ? 17 : outer[i / 2];
    pts.push(`${(50 + rr * Math.cos(a)).toFixed(1)},${(50 + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><polygon class="fl-burst" points="${pts.join(' ')}"/><circle class="fl-core" cx="50" cy="50" r="11"/></svg>`;
})();
const SPLASH = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle class="fl-ripple" cx="50" cy="50" r="30"/><circle class="fl-ring" cx="50" cy="50" r="22"/><circle class="fl-dot" cx="50" cy="50" r="8"/></svg>';
const WRECK = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path class="fl-x-under" d="M31 31L69 69M69 31L31 69"/><path class="fl-x" d="M31 31L69 69M69 31L31 69"/></svg>';

const at = (r, c, w = 1, h = 1) => `--r:${r};--c:${c};--w:${w};--h:${h}`;
const shipAt = (s) => at(s.r, s.c, s.dir === 'h' ? s.len : 1, s.dir === 'v' ? s.len : 1);

function chartHTML({ cls = '', cells, layer = '', extra = '' }) {
  return `<div class="fl-chart ${cls}">
    <div class="fl-lab fl-lab-c" aria-hidden="true">${[...LETTERS].map((l) => `<span>${l}</span>`).join('')}</div>
    <div class="fl-lab fl-lab-r" aria-hidden="true">${Array.from({ length: N }, (_, i) => `<span>${i + 1}</span>`).join('')}</div>
    <div class="fl-grid">${cells}<div class="fl-layer">${layer}</div></div>${extra}
  </div>`;
}
const plainCells = () => '<span class="fl-cell"></span>'.repeat(N * N);

/** A random legal fleet (UI only, so Math.random is fine). Prefers ships that don't touch. */
function randomFleet() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const spread = attempt < 300;
    const occ = new Set();
    const halo = new Set();
    const out = [];
    for (const len of SIZES) {
      let done = false;
      for (let t = 0; t < 80 && !done; t++) {
        const dir = Math.random() < 0.5 ? 'h' : 'v';
        const r = Math.floor(Math.random() * (dir === 'v' ? N - len + 1 : N));
        const c = Math.floor(Math.random() * (dir === 'h' ? N - len + 1 : N));
        const cells = cellsOf({ r, c, len, dir });
        const block = spread ? halo : occ;
        if (cells.some(([rr, cc]) => block.has(rr * N + cc))) continue;
        for (const [rr, cc] of cells) {
          occ.add(rr * N + cc);
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) halo.add((rr + dr) * N + (cc + dc));
        }
        out.push({ r, c, dir });
        done = true;
      }
      if (!done) break;
    }
    if (out.length === SIZES.length) return out;
  }
  return null;
}

// ── styles ───────────────────────────────────────────────────────────────
const CSS = `
.g-fleet { --gut: 14px; --fl-edge: var(--g-edge, var(--g-ink)); position: relative; container-type: inline-size; width: 100%; margin: 0 auto; padding: 0 0 4px; color: var(--g-ink); font-family: var(--g-font-body); -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.g-fleet.is-hidden { min-height: 240px; }
.g-fleet .fl-place, .g-fleet .fl-battle, .g-fleet .fl-wait { --cell: min(52px, calc((100cqw - var(--gut)) / 8)); --mini: clamp(17px, calc(100cqw / 19), 26px); }
.g-fleet h2, .g-fleet h3, .g-fleet p { margin: 0; }

/* ── chart ── */
.g-fleet .fl-chart { --cs: var(--cell); position: relative; display: grid; grid-template-columns: var(--gut) auto; grid-template-rows: calc(var(--gut) - 1px) auto; width: max-content; }
.g-fleet .fl-chart.is-mini { --cs: var(--mini); --gut: 12px; }
.g-fleet .fl-lab { display: grid; font: 900 9px/1 var(--g-font-display); color: var(--g-muted); }
.g-fleet .is-mini .fl-lab { font-size: 8px; }
.g-fleet .fl-lab span { display: grid; place-items: center; transition: color .12s; }
.g-fleet .fl-lab span.is-on { color: var(--g-ink); }
.g-fleet .fl-lab-c { grid-column: 2; grid-row: 1; grid-template-columns: repeat(8, var(--cs)); padding-bottom: 3px; }
.g-fleet .fl-lab-r { grid-column: 1; grid-row: 2; grid-template-rows: repeat(8, var(--cs)); padding-right: 4px; }
.g-fleet .fl-lab-r span { justify-content: end; }
.g-fleet .fl-grid { grid-column: 2; grid-row: 2; position: relative; display: grid; grid-template-columns: repeat(8, var(--cs)); grid-auto-rows: var(--cs); background: var(--g-card); }
.g-fleet .fl-grid::before { content: ''; position: absolute; inset: -2px; border: 2px solid var(--g-ink); box-shadow: var(--g-shadow); pointer-events: none; z-index: 4; }
.g-fleet .fl-cell { display: block; width: var(--cs); height: var(--cs); margin: 0; padding: 0; border: 0; border-radius: 0; background: none; color: inherit; font: inherit; position: relative; box-shadow: inset -1px -1px 0 var(--g-line); touch-action: manipulation; -webkit-appearance: none; appearance: none; }
.g-fleet .fl-cell:nth-child(8n+4) { box-shadow: inset -1px -1px 0 var(--g-line), inset -2px 0 0 var(--g-line); }
.g-fleet .fl-cell:nth-child(n+25):nth-child(-n+32) { box-shadow: inset -1px -2px 0 var(--g-line); }
.g-fleet .fl-cell:nth-child(28) { box-shadow: inset -2px -2px 0 var(--g-line); }
.g-fleet .fl-cell:focus { outline: none; }
.g-fleet .fl-cell:focus-visible { outline: 3px solid var(--g-hl); outline-offset: -3px; z-index: 1; }
.g-fleet .fl-layer { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.g-fleet .fl-ship, .g-fleet .fl-mark, .g-fleet .fl-hl, .g-fleet .fl-preview { position: absolute; left: calc(var(--c) * 12.5%); top: calc(var(--r) * 12.5%); width: calc(var(--w) * 12.5%); height: calc(var(--h) * 12.5%); }

/* ── ships ── */
.g-fleet .fl-ship, .g-fleet .fl-dock-ship, .g-fleet .fl-ghost, .g-fleet .fl-ro { --ship: var(--g-muted); }
.g-fleet .p-a { --ship: var(--p-a); } .g-fleet .p-b { --ship: var(--p-b); }
.g-fleet .fl-ship { display: block; margin: 0; padding: 0; border: 0; background: none; color: inherit; filter: drop-shadow(2px 2px 0 var(--fl-edge)); }
.g-fleet .is-mini .fl-ship { filter: drop-shadow(1px 1px 0 var(--fl-edge)); }
.g-fleet .fl-ship svg, .g-fleet .fl-mark svg, .g-fleet .fl-dock-ship svg, .g-fleet .fl-ghost svg, .g-fleet .fl-ro svg { display: block; width: 100%; height: 100%; overflow: visible; }
.g-fleet .fl-hull { fill: var(--ship); stroke: var(--g-ink); stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.g-fleet .fl-deck > * { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.g-fleet .fl-deck > .fl-gun { fill: none; stroke-width: 2.5; stroke-linecap: round; }
.g-fleet .is-mini .fl-hull { stroke-width: 1.5; }
.g-fleet .is-mini .fl-deck > * { stroke-width: 1; }
.g-fleet .fl-ship.is-wreck .fl-hull { fill: color-mix(in srgb, var(--ship) 52%, var(--fl-edge)); }
.g-fleet .fl-ship.is-wreck .fl-deck > * { fill: color-mix(in srgb, var(--g-card) 50%, var(--fl-edge)); }
.g-fleet .fl-ship.is-ghost { filter: none; }
.g-fleet .fl-ship.is-ghost .fl-hull { fill: color-mix(in srgb, var(--ship) 28%, transparent); stroke-dasharray: 5 3; }
.g-fleet .fl-ship.is-ghost .fl-deck { display: none; }

/* ── marks ── */
.g-fleet .fl-mark { display: grid; place-items: center; z-index: 3; }
.g-fleet .fl-mark svg { width: 80%; height: 80%; }
.g-fleet .fl-burst { fill: var(--g-bad); stroke: var(--g-ink); stroke-width: 1.5; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.g-fleet .fl-core { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 1; vector-effect: non-scaling-stroke; }
.g-fleet .fl-ring { fill: none; stroke: var(--g-muted); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.g-fleet .fl-dot { fill: var(--g-muted); }
.g-fleet .fl-ripple { fill: none; stroke: var(--g-ink); stroke-width: 2; vector-effect: non-scaling-stroke; opacity: 0; }
.g-fleet .fl-x-under { fill: none; stroke: var(--g-ink); stroke-width: 6; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.g-fleet .fl-x { fill: none; stroke: var(--g-card); stroke-width: 2.5; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.g-fleet .is-mini .fl-x-under { stroke-width: 4; } .g-fleet .is-mini .fl-x { stroke-width: 1.5; }
.g-fleet .fl-hl { background: color-mix(in srgb, var(--g-hl) 62%, transparent); box-shadow: inset 0 0 0 1.5px var(--g-ink); z-index: 2; }
.g-fleet .fl-hl.is-last { box-shadow: inset 0 0 0 2.5px var(--g-ink); }
.g-fleet .fl-target .fl-mark.is-last::after { content: ''; position: absolute; inset: 2px; border: 2px solid var(--g-ink); border-radius: 50%; }

/* ── target chart: aiming ── */
.g-fleet .fl-target .fl-cell:not(:disabled) { cursor: crosshair; }
.g-fleet .fl-target .fl-cell::before { content: ''; position: absolute; inset: 18%; border: 2.5px solid var(--g-ink); border-radius: 50%; opacity: 0; transform: scale(.5); transition: transform .12s, opacity .12s; }
.g-fleet .fl-target .fl-cell::after { content: ''; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: var(--g-ink); opacity: 0; transition: opacity .12s; }
.g-fleet .fl-target .fl-cell:not(:disabled):active, .g-fleet .fl-target .fl-cell.is-aim { background: color-mix(in srgb, var(--g-hl) 55%, transparent); }
.g-fleet .fl-target .fl-cell:not(:disabled):active::before, .g-fleet .fl-target .fl-cell.is-aim::before { opacity: 1; transform: none; }
.g-fleet .fl-target .fl-cell:not(:disabled):active::after, .g-fleet .fl-target .fl-cell.is-aim::after { opacity: 1; }
.g-fleet .fl-target .fl-cell.is-aim:disabled::before { border-style: dashed; }
@media (hover: hover) {
  .g-fleet .fl-target .fl-cell:not(:disabled):hover { background: color-mix(in srgb, var(--g-hl) 55%, transparent); }
  .g-fleet .fl-target .fl-cell:not(:disabled):hover::before { opacity: 1; transform: none; }
  .g-fleet .fl-target .fl-cell:not(:disabled):hover::after { opacity: 1; }
}

/* ── headers, pills, log ── */
.g-fleet .fl-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-left: var(--gut); margin-bottom: 3px; min-height: 22px; }
.g-fleet .fl-h { display: flex; align-items: center; gap: 7px; font: 900 .74rem/1.1 var(--g-font-display); text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
.g-fleet .fl-sw { width: 12px; height: 12px; flex: none; background: var(--ship); border: 2px solid var(--g-ink); border-radius: 3px; }
.g-fleet .fl-pill { flex: none; font: 800 .8rem/1 var(--g-font-body); padding: 7px 11px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); color: var(--g-ink); white-space: nowrap; }
.g-fleet .fl-target.is-live .fl-grid::before { box-shadow: 5px 5px 0 0 var(--g-hl), 5px 5px 0 2px var(--fl-edge); }
.g-fleet .fl-target { margin-bottom: 4px; }
.g-fleet .fl-target:not(.is-live) .fl-cell { cursor: default; }
.g-fleet .fl-pill.is-quiet { border-color: var(--g-line); color: var(--g-muted); }
.g-fleet .fl-log { padding: 6px 10px; border: 2px solid var(--g-ink); border-radius: var(--g-radius); background: var(--g-card); font-size: .82rem; line-height: 1.45; display: flex; flex-direction: column; gap: 2px; min-height: 38px; justify-content: center; }
.g-fleet .fl-log b { font-weight: 900; }
.g-fleet .fl-tok { display: inline-block; padding: 0 7px; margin: 1px 2px 1px 0; border: 1.5px solid var(--g-ink); border-radius: 999px; font: 800 .76rem/1.55 var(--g-font-body); background: var(--g-card); color: var(--g-ink); white-space: nowrap; }
.g-fleet .fl-tok.is-hit { background: var(--g-bad); color: var(--g-card); }
.g-fleet .fl-tok.is-sunk { background: var(--g-ink); color: var(--g-card); }
.g-fleet .fl-who-a { color: var(--p-a-text, var(--p-a)); } .g-fleet .fl-who-b { color: var(--p-b-text, var(--p-b)); }

/* ── roster ── */
.g-fleet .fl-side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.g-fleet .fl-side .fl-head { padding-left: 0; min-height: 0; margin: 0; }
.g-fleet .fl-roster { display: flex; flex-wrap: wrap; gap: 9px 12px; align-items: center; }
.g-fleet .fl-ro { position: relative; width: calc(var(--len) * 16px); height: 16px; filter: drop-shadow(1px 1px 0 var(--fl-edge)); }
.g-fleet .fl-ro .fl-hull { stroke-width: 1.5; }
.g-fleet .fl-ro .fl-deck > * { stroke-width: 1; }
.g-fleet .fl-ro.is-sunk svg { opacity: .35; }
.g-fleet .fl-ro.is-sunk::after { content: ''; position: absolute; left: -2px; right: -2px; top: 50%; height: 2.5px; margin-top: -1.25px; background: var(--g-ink); border-radius: 2px; transform: rotate(-12deg); transform-origin: left center; }
.g-fleet .fl-count { font: 700 .8rem/1.25 var(--g-font-body); color: var(--g-muted); }

/* ── stamps ── */
.g-fleet .fl-stamp { position: absolute; left: calc(50% + var(--gut) / 2); top: calc(50% + var(--gut) / 2); z-index: 6; pointer-events: none; padding: 7px 16px 9px; border: 3px solid var(--g-ink); border-radius: 6px; background: var(--g-hl); color: var(--g-on-ink); box-shadow: 4px 4px 0 var(--fl-edge); text-align: center; white-space: nowrap; font: 900 clamp(1.25rem, 6.4cqw, 1.9rem)/1.05 var(--g-font-display); text-transform: uppercase; letter-spacing: .03em; transform: translate(-50%, -50%) rotate(-8deg); animation: gfleet-stamp 1.9s cubic-bezier(.2, .9, .3, 1.2) both; }
.g-fleet .fl-stamp small { display: block; margin-top: 5px; font: 800 max(.72rem, .4em)/1 var(--g-font-body); letter-spacing: .06em; }
.g-fleet .fl-stamp.is-bad { background: var(--g-bad); color: var(--g-on-ink); }
.g-fleet .is-mini .fl-stamp { font-size: .9rem; padding: 4px 8px 5px; border-width: 2px; box-shadow: 2px 2px 0 var(--fl-edge); }

/* ── placement ── */
.g-fleet .fl-place { display: grid; gap: 12px; justify-items: center; }
.g-fleet .fl-main, .g-fleet .fl-aside { width: calc(var(--cell) * 8 + var(--gut)); max-width: 100%; }
.g-fleet .fl-aside { padding-left: var(--gut); display: flex; flex-direction: column; gap: 12px; }
.g-fleet .fl-hint { font-size: .84rem; color: var(--g-muted); padding-left: var(--gut); margin: -1px 0 10px; line-height: 1.35; }
.g-fleet .fl-hint b { color: var(--g-ink); }
.g-fleet .is-edit .fl-ship { pointer-events: auto; cursor: grab; touch-action: none; -webkit-appearance: none; appearance: none; }
.g-fleet .is-edit .fl-ship:focus-visible { outline: 3px solid var(--g-hl); outline-offset: 2px; }
.g-fleet .is-edit .fl-cell { cursor: pointer; }
.g-fleet .fl-ship.is-lifted { opacity: .25; filter: none; }
.g-fleet .fl-preview { z-index: 3; border: 2.5px dashed var(--g-ink); background: color-mix(in srgb, var(--g-good) 30%, transparent); }
.g-fleet .fl-preview.is-bad { border-color: var(--g-bad); background: color-mix(in srgb, var(--g-bad) 28%, transparent); }
.g-fleet .fl-dock { display: flex; flex-wrap: wrap; gap: 10px 10px; min-height: var(--cell); }
.g-fleet .fl-dock-ship, .g-fleet .fl-slot { position: relative; width: calc(var(--len) * var(--cell)); height: var(--cell); flex: none; }
.g-fleet .fl-dock-ship { display: block; margin: 0; padding: 0; border: 0; background: none; color: inherit; touch-action: none; cursor: grab; filter: drop-shadow(2px 2px 0 var(--fl-edge)); transition: transform .15s; -webkit-appearance: none; appearance: none; }
.g-fleet .fl-dock-ship.is-sel { transform: translateY(-4px); filter: drop-shadow(3px 5px 0 var(--fl-edge)); }
.g-fleet .fl-dock-ship.is-sel::after { content: ''; position: absolute; left: 12%; right: 12%; bottom: -9px; height: 4px; border-radius: 2px; background: var(--g-hl); box-shadow: 0 0 0 1.5px var(--g-ink); }
.g-fleet .fl-dock-ship:focus-visible { outline: 3px solid var(--g-hl); outline-offset: 3px; }
.g-fleet .fl-slot { border: 2px dashed var(--g-line); border-radius: 10px; }
.g-fleet .fl-dock-done { width: 100%; min-height: var(--cell); display: grid; place-items: center; text-align: center; font: 700 .9rem/1.3 var(--g-font-body); color: var(--g-muted); border: 2px dashed var(--g-line); border-radius: var(--g-radius); padding: 8px; }
.g-fleet .fl-note { font-size: .84rem; font-weight: 800; color: var(--g-muted); }
.g-fleet .fl-actions { display: flex; gap: 10px; }
.g-fleet .fl-actions .gm-btn { flex: 1; min-height: 48px; }
.g-fleet .fl-actions .gm-btn:disabled { opacity: .4; cursor: default; }
.g-fleet .fl-ghost { position: absolute; z-index: 30; pointer-events: none; filter: drop-shadow(4px 5px 0 var(--fl-edge)); transform: rotate(-2deg) scale(1.05); }
.g-fleet .fl-wait .fl-note-card { padding: 12px 14px; border: 2px solid var(--g-ink); border-radius: var(--g-radius); background: var(--g-card); box-shadow: var(--g-shadow); text-align: center; display: flex; flex-direction: column; gap: 6px; }
.g-fleet .fl-wait .fl-note-card b { font: 900 1rem/1.2 var(--g-font-display); }
.g-fleet .fl-wait .fl-note-card span { color: var(--g-muted); font-size: .88rem; }

/* ── battle layout: stacked on phones, side by side on wide screens ── */
.g-fleet .fl-battle { display: grid; grid-template-columns: max-content minmax(0, 1fr); grid-template-areas: "log log" "target target" "home side"; gap: 8px 14px; width: calc(var(--cell) * 8 + var(--gut)); max-width: 100%; margin: 0 auto; align-items: start; }
.g-fleet .fl-battle .fl-target { grid-area: target; position: relative; }
.g-fleet .fl-battle .fl-log { grid-area: log; }
.g-fleet .fl-battle .fl-home { grid-area: home; }
.g-fleet .fl-battle .fl-side { grid-area: side; }
.g-fleet .fl-home .fl-head { padding-left: 12px; min-height: 0; margin-bottom: 2px; }
.g-fleet .fl-wait { display: grid; gap: 14px; justify-items: center; }
.g-fleet .fl-wait > * { width: calc(var(--cell) * 8 + var(--gut)); max-width: 100%; }
@container (min-width: 600px) {
  .g-fleet .fl-battle { --cell: min(54px, calc((58cqw - var(--gut)) / 8)); --mini: min(30px, calc((42cqw - 44px) / 8)); width: auto; grid-template-areas: "target log" "target home" "target side"; grid-template-rows: auto auto 1fr; gap: 14px 22px; justify-content: center; }
  .g-fleet .fl-log { align-self: start; }
  .g-fleet .fl-target .fl-head { min-height: 30px; }
  .g-fleet .fl-place { --cell: min(54px, calc((60cqw - var(--gut)) / 8)); grid-template-columns: max-content minmax(0, 1fr); gap: 22px; align-items: center; justify-content: center; }
  .g-fleet .fl-place .fl-aside { width: auto; max-width: calc(var(--cell) * 5); padding-left: 0; }
}

/* ── motion ── */
@keyframes gfleet-pop { 0% { transform: scale(2.2); opacity: 0; } 55% { transform: scale(.85); opacity: 1; } 100% { transform: none; } }
@keyframes gfleet-bloom { 0% { transform: scale(0) rotate(-50deg); } 55% { transform: scale(1.4) rotate(10deg); } 80% { transform: scale(.92) rotate(-3deg); } 100% { transform: none; } }
@keyframes gfleet-ripple { 0% { transform: scale(.3); opacity: .9; } 100% { transform: scale(1.7); opacity: 0; } }
@keyframes gfleet-sink { 0% { transform: scale(1.3) rotate(-4deg); opacity: 0; } 25% { transform: scale(.94) rotate(1deg); opacity: 1; } 50% { transform: translateY(5%) rotate(-2.5deg); } 75% { transform: translateY(2%) rotate(1deg); } 100% { transform: none; } }
@keyframes gfleet-founder { 0% { transform: none; } 35% { transform: translateY(6%) rotate(3deg); } 70% { transform: translateY(3%) rotate(-1.5deg); } 100% { transform: none; } }
@keyframes gfleet-shake { 0%, 100% { transform: none; } 20% { transform: translate(-3px, 1px); } 40% { transform: translate(3px, -1px); } 60% { transform: translate(-2px, 0); } 80% { transform: translate(2px, 1px); } }
@keyframes gfleet-stamp { 0% { transform: translate(-50%, -50%) scale(2.3) rotate(-16deg); opacity: 0; } 18% { transform: translate(-50%, -50%) scale(.94) rotate(-8deg); opacity: 1; } 26% { transform: translate(-50%, -50%) scale(1) rotate(-8deg); } 82% { opacity: 1; } 100% { transform: translate(-50%, -50%) scale(1) rotate(-8deg); opacity: 0; } }
@keyframes gfleet-strike { 0% { transform: rotate(-12deg) scaleX(0); } 100% { transform: rotate(-12deg) scaleX(1); } }
@keyframes gfleet-drop { 0% { transform: translateY(-14%) scale(1.08); } 60% { transform: translateY(2%) scale(.98); } 100% { transform: none; } }
@keyframes gfleet-pulse { 0%, 100% { transform: none; } 50% { transform: scale(1.18); } }
@keyframes gfleet-reveal { 0% { opacity: 0; transform: scale(.9); } 100% { opacity: 1; transform: none; } }
.g-fleet .fl-mark.is-new { animation: gfleet-pop .38s cubic-bezier(.3, 1.4, .5, 1) both; animation-delay: var(--d, 0ms); }
.g-fleet .fl-mark.is-new.is-hit { animation: none; }
.g-fleet .fl-mark.is-new.is-hit svg { animation: gfleet-bloom .55s cubic-bezier(.3, 1.5, .5, 1) both; animation-delay: var(--d, 0ms); }
.g-fleet .fl-mark.is-new .fl-ripple { transform-box: fill-box; transform-origin: center; animation: gfleet-ripple .75s ease-out both; animation-delay: calc(var(--d, 0ms) + 120ms); }
.g-fleet .fl-mark.is-new.is-x { animation-duration: .3s; }
.g-fleet .fl-ship.is-sinking { animation: gfleet-sink 1.1s ease-out both; animation-delay: var(--d, 0ms); }
.g-fleet .fl-ship.is-foundering { animation: gfleet-founder .9s ease-in-out both; animation-delay: var(--d, 0ms); }
.g-fleet .fl-ship.is-ghost { animation: gfleet-reveal .5s ease-out both; animation-delay: calc(400ms + var(--k, 0) * 140ms); }
.g-fleet .fl-chart.is-shake .fl-grid { animation: gfleet-shake .38s ease-out; animation-delay: var(--d, 0ms); }
.g-fleet .fl-ro.is-new::after { animation: gfleet-strike .45s ease-out both; animation-delay: var(--d, 0ms); }
.g-fleet .fl-ship.is-drop { animation: gfleet-drop .34s cubic-bezier(.3, 1.5, .5, 1) both; animation-delay: calc(var(--k, 0) * 45ms); }
.g-fleet .fl-hl.is-last { animation: gfleet-pulse .9s ease-in-out 3; animation-delay: var(--d, 0ms); }
.g-fleet .is-shake-x { animation: gfleet-shake .38s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .g-fleet *, .g-fleet *::before, .g-fleet *::after { animation: none !important; transition: none !important; }
  .g-fleet .fl-ghost { transform: none; }
}
`;

// ── the game ─────────────────────────────────────────────────────────────
registerGame({
  id: 'fleet',
  title: 'Battleships',
  blurb: 'Hide your fleet. Hunt theirs.',
  kind: 'turns',
  team: false,
  secret: true,
  tags: ['brainy'],
  platforms: ['phone', 'computer'],
  minutes: 10,
  endDelay: 1900,
  howTo: [
    'Drag your 5 ships onto the chart, or Shuffle. Tap a ship (or press R) to turn it. Ships may touch, never overlap.',
    'Take turns firing into their waters. A hit fires again; a miss passes the turn.',
    'Sink all five of their ships to win.',
    'On a computer: hover or use the arrow keys to aim, click or Enter to fire.',
  ],
  css: CSS,
  ...rules,

  mount(el, api) {
    const root = document.createElement('div');
    root.className = 'g-fleet is-hidden';
    el.appendChild(root);
    const fine = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

    let ctx = null;
    let V = null; // whose eyes we draw for (never anyone else's fleet)
    let view = 'hidden';
    const drafts = { a: null, b: null }; // per-player placement drafts, local until Ready
    let sel = 0; // dock ship picked for tap-to-place
    let selDir = 'h';
    let active = -1; // last ship touched (R rotates it)
    let drag = null;
    let deferred = false;
    let suppressClick = false;
    let fx = {}; // one-shot effects for the next placement paint
    let seenViewer;
    let seenShots = 0;
    let seenPhase = null;
    let aim = { r: 3, c: 3 };
    let kbd = false;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    // Same phone: a miss passes the turn, and the engine drops the pass-the-phone curtain at once.
    // So a miss is shown here first (splash, sound, "pass the phone"), then played.
    let hold = null; // { r, c, t }
    const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
    const nm = (w) => api.name(w);

    const draft = () => (V ? (drafts[V] = drafts[V] || SIZES.map(() => null)) : SIZES.map(() => null));
    const shipOf = (d, i) => ({ ...d[i], len: SIZES[i] });
    function fits(d, i, o) {
      for (const [r, c] of cellsOf({ ...o, len: SIZES[i] })) {
        if (!onChart(r, c)) return false;
        for (let j = 0; j < d.length; j++) if (j !== i && d[j] && covers(shipOf(d, j), r, c)) return false;
      }
      return true;
    }
    const fitAt = (i, r, c, dir) => (dir === 'h' ? { r, c: clamp(c, 0, N - SIZES[i]), dir } : { r: clamp(r, 0, N - SIZES[i]), c, dir });
    const nextUnplaced = (d, from = 0) => { for (let k = 0; k < SIZES.length; k++) { const j = (from + k) % SIZES.length; if (!d[j]) return j; } return -1; };

    function bad(msg, elx) {
      api.sfx('bad');
      api.haptic(30);
      if (msg) api.toast(msg);
      if (elx) { elx.classList.remove('is-shake-x'); void elx.offsetWidth; elx.classList.add('is-shake-x'); }
    }

    // ── paint ──
    function render(fresh = [], battleStart = false) {
      if (drag) { deferred = true; return; }
      deferred = false;
      const c = ctx;
      if (!c || !V) {
        view = 'hidden';
        root.className = 'g-fleet is-hidden';
        root.removeAttribute('data-viewer');
        root.innerHTML = '';
        api.setStatus(null);
        return;
      }
      const s = c.state;
      root.dataset.viewer = V;
      root.dataset.phase = s.phase;
      if (s.phase === 'place' && !s.fleets[V]) paintPlace();
      else if (s.phase === 'place') paintWait();
      else paintBattle(fresh, battleStart);
    }

    function paintPlace() {
      view = 'place';
      const v = V;
      const s = ctx.state;
      const d = draft();
      if (sel < 0 || d[sel]) sel = nextUnplaced(d, Math.max(0, sel));
      const placed = d.filter(Boolean).length;
      let cells = '';
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells += `<button type="button" class="fl-cell" data-r="${r}" data-c="${c}" aria-label="${coord(r, c)}"></button>`;
      const ships = d.map((o, i) => (o
        ? `<button type="button" class="fl-ship p-${v}${fx.drop === i || fx.shuffle ? ' is-drop' : ''}" data-ship="${i}" data-len="${SIZES[i]}" style="${shipAt(shipOf(d, i))};--k:${i}" aria-label="${SIZES[i]}-long ship at ${coord(o.r, o.c)}, ${o.dir === 'h' ? 'across' : 'down'}. Tap to turn it.">${shipSVG(SIZES[i], o.dir)}</button>`
        : '')).join('');
      const dock = placed === SIZES.length
        ? `<div class="fl-dock-done">All five at sea. Drag to adjust, or hit Ready.</div>`
        : SIZES.map((len, i) => (d[i]
          ? `<span class="fl-slot" style="--len:${len}" aria-hidden="true"></span>`
          : `<button type="button" class="fl-dock-ship p-${v}${sel === i ? ' is-sel' : ''}" data-ship="${i}" data-len="${len}" style="--len:${len}" aria-label="${len}-long ship${sel === i ? ', picked' : ''}" aria-pressed="${sel === i}">${shipSVG(len, 'h')}</button>`)).join('');
      const foe = foeOf(v);
      const note = ctx.mode === 'online' && s.fleets[foe] ? `<p class="fl-note">${esc(nm(foe))} is ready and waiting.</p>` : '';
      const hint = fine
        ? 'Drag ships onto the chart, or pick one and click a square. Click a ship or press <b>R</b> to turn it.'
        : 'Drag ships onto the chart, or tap a square to drop the picked one. Tap a ship to turn it.';
      root.className = 'g-fleet';
      root.innerHTML = `<div class="fl-place">
        <div class="fl-main">
          <header class="fl-head"><h2 class="fl-h p-${v}"><span class="fl-sw"></span>${ctx.mode === 'local' ? `${esc(nm(v))}’s fleet` : 'Your fleet'}</h2><span class="fl-pill${placed === SIZES.length ? '' : ' is-quiet'}">${placed}/5 at sea</span></header>
          <p class="fl-hint">${hint}</p>
          ${chartHTML({ cls: 'fl-home-chart is-edit', cells, layer: `${ships}<div class="fl-preview" hidden></div>` })}
        </div>
        <div class="fl-aside">
          <div class="fl-dock" aria-label="Ships to place">${dock}</div>
          ${note}
          <div class="fl-actions">
            <button type="button" class="gm-btn gm-btn-ghost" data-fl="shuffle">Shuffle</button>
            <button type="button" class="gm-btn" data-fl="ready"${placed === SIZES.length && ctx.canMove ? '' : ' disabled'}>Ready</button>
          </div>
        </div>
      </div>`;
      if (fx.shake != null) { const t = root.querySelector(`.fl-ship[data-ship="${fx.shake}"]`); if (t) t.classList.add('is-shake-x'); }
      fx = {};
      api.setStatus(ctx.mode === 'local' ? `${nm(v)}, hide your fleet` : 'Hide your fleet');
    }

    function paintWait() {
      view = 'wait';
      const v = V;
      const s = ctx.state;
      const foe = foeOf(v);
      const ships = s.fleets[v].map((o) => `<div class="fl-ship p-${v}" data-len="${o.len}" style="${shipAt(o)}">${shipSVG(o.len, o.dir)}</div>`).join('');
      let cells = '';
      for (let i = 0; i < N * N; i++) cells += '<span class="fl-cell"></span>';
      root.className = 'g-fleet';
      root.innerHTML = `<div class="fl-wait">
        <header class="fl-head"><h2 class="fl-h p-${v}"><span class="fl-sw"></span>Your fleet</h2><span class="fl-pill">Ready</span></header>
        <div class="fl-home">${chartHTML({ cls: 'fl-home-chart', cells, layer: ships })}</div>
        <div class="fl-note-card"><b>Fleet in position</b><span>Waiting for ${esc(nm(foe))} to hide theirs. ${s.first === v ? 'You fire first.' : `${esc(nm(foe))} fires first.`}</span></div>
      </div>`;
      api.setStatus(`Waiting for ${nm(foe)} to hide their fleet…`);
    }

    function paintBattle(fresh, battleStart) {
      view = 'battle';
      const c = ctx;
      const s = c.state;
      const v = V;
      const foe = foeOf(v);
      const over = s.phase === 'over';
      const shots = s.shots;
      const myFleet = s.fleets[v];
      const theirFleet = s.fleets[foe]; // read ONLY for sunk ships (or once the game is over)
      const freshAt = new Map(fresh.map((i, k) => [i, k]));
      const delay = (i) => (freshAt.has(i) ? freshAt.get(i) * 260 : 0);
      const mine = [];
      const theirs = [];
      shots.forEach((x, i) => (x.by === v ? mine : theirs).push({ ...x, i }));
      const sunkTheirs = new Map(mine.filter((x) => x.sunk >= 0).map((x) => [x.sunk, x.i]));
      const sunkMine = new Map(theirs.filter((x) => x.sunk >= 0).map((x) => [x.sunk, x.i]));
      const onSunk = (fleet, sunkMap, r, c2) => { for (const [idx, at2] of sunkMap) if (covers(fleet[idx], r, c2)) return at2; return -1; };
      const pending = hold && !over ? hold : null; // a same-phone miss about to be played
      const myTurn = c.canMove && !pending;
      const lastMine = mine.length ? mine[mine.length - 1].i : -1;
      const foeRun = lastRunBy(shots, foe);
      const foeRunSet = new Set(foeRun);
      const lastFoe = foeRun.length ? foeRun[foeRun.length - 1] : -1;

      // their waters (what I know: my shots, plus ships I've sunk)
      const shotAt = new Map(mine.map((x) => [x.r * N + x.c, x]));
      let tCells = '';
      for (let r = 0; r < N; r++) {
        for (let col = 0; col < N; col++) {
          const x = shotAt.get(r * N + col) || (pending && pending.r === r && pending.c === col ? { hit: 0 } : null);
          const aimed = kbd && aim.r === r && aim.c === col;
          tCells += `<button type="button" class="fl-cell${x ? ' is-shot' : ''}${aimed ? ' is-aim' : ''}" data-r="${r}" data-c="${col}" aria-label="${coord(r, col)}${x ? (x.hit ? ', hit' : ', miss') : ''}"${x || !myTurn ? ' disabled' : ''}></button>`;
        }
      }
      let tLayer = '';
      for (const [idx, at2] of sunkTheirs) {
        const o = theirFleet[idx];
        const isNew = freshAt.has(at2);
        tLayer += `<div class="fl-ship p-${foe} is-wreck${isNew ? ' is-sinking' : ''}" data-len="${o.len}" style="${shipAt(o)};--d:${delay(at2) + 280}ms">${shipSVG(o.len, o.dir)}</div>`;
      }
      if (over) {
        let k = 0;
        theirFleet.forEach((o, idx) => { if (!sunkTheirs.has(idx)) tLayer += `<div class="fl-ship p-${foe} is-ghost" data-len="${o.len}" style="${shipAt(o)};--k:${k++}">${shipSVG(o.len, o.dir)}</div>`; });
      }
      for (const x of mine) {
        const sunkBy = x.hit ? onSunk(theirFleet, sunkTheirs, x.r, x.c) : -1;
        const kind = !x.hit ? 'is-miss' : sunkBy >= 0 ? 'is-x' : 'is-hit';
        const isNew = freshAt.has(x.i) || (sunkBy >= 0 && freshAt.has(sunkBy));
        const d = freshAt.has(x.i) ? delay(x.i) : sunkBy >= 0 ? delay(sunkBy) + 520 : 0;
        tLayer += `<span class="fl-mark ${kind}${isNew ? ' is-new' : ''}${x.i === lastMine && !over && !pending ? ' is-last' : ''}" style="${at(x.r, x.c)};--d:${d}ms">${!x.hit ? SPLASH : sunkBy >= 0 ? WRECK : BURST}</span>`;
      }
      if (pending) tLayer += `<span class="fl-mark is-miss is-new is-last" style="${at(pending.r, pending.c)};--d:0ms">${SPLASH}</span>`;

      // my fleet (their shots on it; their latest volley highlighted)
      let hLayer = myFleet.map((o, idx) => {
        const at2 = sunkMine.has(idx) ? sunkMine.get(idx) : -1;
        const cls = at2 >= 0 ? ` is-wreck${freshAt.has(at2) ? ' is-foundering' : ''}` : '';
        return `<div class="fl-ship p-${v}${cls}" data-len="${o.len}" style="${shipAt(o)};--d:${at2 >= 0 ? delay(at2) + 200 : 0}ms">${shipSVG(o.len, o.dir, true)}</div>`;
      }).join('');
      for (const x of theirs) if (foeRunSet.has(x.i)) hLayer += `<span class="fl-hl${x.i === lastFoe ? ' is-last' : ''}" style="${at(x.r, x.c)};--d:${delay(x.i) + 300}ms"></span>`;
      for (const x of theirs) {
        const sunkBy = x.hit ? onSunk(myFleet, sunkMine, x.r, x.c) : -1;
        const kind = !x.hit ? 'is-miss' : sunkBy >= 0 ? 'is-x' : 'is-hit';
        const isNew = freshAt.has(x.i) || (sunkBy >= 0 && freshAt.has(sunkBy));
        const d = freshAt.has(x.i) ? delay(x.i) : sunkBy >= 0 ? delay(sunkBy) + 400 : 0;
        hLayer += `<span class="fl-mark ${kind}${isNew ? ' is-new' : ''}" style="${at(x.r, x.c)};--d:${d}ms">${!x.hit ? SPLASH : sunkBy >= 0 ? WRECK : BURST}</span>`;
      }

      // their fleet roster (sizes only, crossed off as they sink)
      const sunkLens = [...sunkTheirs.keys()].map((idx) => theirFleet[idx].len);
      const freshSunkLens = [...sunkTheirs].filter(([, at2]) => freshAt.has(at2)).map(([idx]) => theirFleet[idx].len);
      const used = {};
      const roster = SIZES.map((len) => {
        const n = sunkLens.filter((l) => l === len).length;
        used[len] = (used[len] || 0) + 1;
        const sunk = used[len] <= n;
        const isNew = sunk && used[len] === n && freshSunkLens.includes(len);
        return `<span class="fl-ro p-${foe}${sunk ? ' is-sunk' : ''}${isNew ? ' is-new' : ''}" style="--len:${len};--d:${fresh.length * 260 + 500}ms" role="img" aria-label="${len}-long, ${sunk ? 'sunk' : 'afloat'}">${shipSVG(len, 'h', true)}</span>`;
      }).join('');
      const left = SIZES.length - sunkLens.length;

      // the log: what happened since you last looked
      const tok = (x) => {
        const what = x.sunk >= 0 ? `sank ${x.by === v ? 'their' : 'your'} ${s.fleets[foeOf(x.by)][x.sunk].len}-ship` : x.hit ? 'hit' : 'miss';
        return `<span class="fl-tok ${x.sunk >= 0 ? 'is-sunk' : x.hit ? 'is-hit' : 'is-miss'}">${coord(x.r, x.c)} ${what}</span>`;
      };
      const volleyLine = (run, by) => {
        const list = run.map((i) => shots[i]);
        const tail = by === v && !over && myTurn && list[list.length - 1].hit ? ' <b>Fire again.</b>' : '';
        return `<p><b class="fl-who-${by}">${by === v ? 'You' : esc(nm(by))}</b> fired ${list.map(tok).join(' ')}${tail}</p>`;
      };
      // one line: the latest volley (theirs when you come back to it; yours while you keep firing)
      const lines = [];
      if (pending) lines.push(`<p><b class="fl-who-${v}">${esc(nm(v))}</b> fired <span class="fl-tok is-miss">${coord(pending.r, pending.c)} miss</span> Pass the phone to <b class="fl-who-${foe}">${esc(nm(foe))}</b>.</p>`);
      else if (!shots.length) lines.push(`<p><b>Battle stations.</b> ${s.first === v ? `You fire first: pick a square in ${esc(nm(foe))}’s waters.` : `${esc(nm(foe))} fires first.`}</p>`);
      else {
        const run = lastRun(shots);
        lines.push(volleyLine(run, shots[run[0]].by));
      }

      // turn label
      const lastShot = shots[shots.length - 1];
      const again = myTurn && lastShot && lastShot.by === v && lastShot.hit;
      let pill = '';
      let status;
      if (over) {
        pill = s.winner === v ? 'All sunk' : 'Fleet lost';
        status = `${nm(s.winner)} sank the whole fleet`;
      } else if (pending) {
        status = `Miss. Over to ${nm(foe)}`;
      } else if (myTurn) {
        status = c.mode === 'local' ? (again ? `Hit! ${nm(v)} fires again` : `${nm(v)}’s shot`) : again ? 'Hit! Fire again' : 'Your shot';
      } else {
        status = `${nm(foe)} is taking aim…`;
      }
      api.setStatus(status);

      root.className = 'g-fleet';
      root.innerHTML = `<div class="fl-battle">
        <section class="fl-target${myTurn ? ' is-live' : ''}" aria-label="${esc(nm(foe))}’s waters">
          <header class="fl-head"><h2 class="fl-h p-${foe}"><span class="fl-sw"></span>${esc(nm(foe))}’s waters</h2>${pill ? `<span class="fl-pill">${esc(pill)}</span>` : ''}</header>
          ${chartHTML({ cls: 'fl-target-chart', cells: tCells, layer: tLayer })}
        </section>
        <div class="fl-log" aria-live="polite">${lines.join('')}</div>
        <section class="fl-home" aria-label="Your fleet">
          <header class="fl-head"><h2 class="fl-h p-${v}"><span class="fl-sw"></span>${c.mode === 'local' ? esc(nm(v)) : 'Your fleet'}</h2></header>
          ${chartHTML({ cls: 'fl-home-chart is-mini', cells: plainCells(), layer: hLayer })}
        </section>
        <section class="fl-side" aria-label="${esc(nm(foe))}’s fleet">
          <header class="fl-head"><h2 class="fl-h p-${foe}"><span class="fl-sw"></span>Their fleet</h2></header>
          <div class="fl-roster">${roster}</div>
          <p class="fl-count">${left === 0 ? 'All five sunk' : `${left} of 5 still afloat`}</p>
        </section>
      </div>`;

      // effects for anything new
      if (fresh.length) effects(fresh, over);
      else if (battleStart) stamp(root.querySelector('.fl-target .fl-chart'), 'Battle stations', s.first === v ? (c.mode === 'local' ? `${nm(v)} fires first` : 'You fire first') : `${nm(foe)} fires first`, 0);
    }

    function effects(fresh, over) {
      const s = ctx.state;
      const v = V;
      const list = fresh.map((i) => s.shots[i]);
      const lastK = list.length - 1;
      const mineNew = list.filter((x) => x.by === v);
      const theirsNew = list.filter((x) => x.by !== v);
      const tChart = root.querySelector('.fl-target .fl-chart');
      const hChart = root.querySelector('.fl-home .fl-chart');
      list.forEach((x, k) => {
        const chart = x.by === v ? tChart : hChart;
        if (x.hit && chart) later(() => { chart.style.setProperty('--d', '0ms'); chart.classList.remove('is-shake'); void chart.offsetWidth; chart.classList.add('is-shake'); }, k * 260);
      });
      const sunkMine = mineNew.filter((x) => x.sunk >= 0);
      const sunkTheirs = theirsNew.filter((x) => x.sunk >= 0);
      const wait = lastK * 260;
      if (sunkMine.length) {
        const x = sunkMine[sunkMine.length - 1];
        const len = s.fleets[foeOf(v)][x.sunk].len;
        stamp(tChart, 'Sunk!', over ? 'That’s the whole fleet' : `Their ${len}-ship`, wait + 280);
        api.sfx('hit'); api.haptic(40);
        later(() => api.sfx('good'), wait + 300);
      } else if (sunkTheirs.length) {
        const x = sunkTheirs[sunkTheirs.length - 1];
        const len = s.fleets[v][x.sunk].len;
        stamp(hChart, 'Sunk', `your ${len}`, wait + 200, true);
        api.sfx('hit'); api.haptic(40);
        later(() => api.sfx('bad'), wait + 240);
      } else {
        const last = list[lastK];
        if (last.hit) { api.sfx('hit'); api.haptic(25); } else api.sfx(last.by === v ? 'pop' : 'tick');
      }
    }

    function stamp(chart, text, sub, delay, badTone = false) {
      if (!chart) return;
      later(() => {
        if (!chart.isConnected) return;
        const t = document.createElement('div');
        t.className = `fl-stamp${badTone ? ' is-bad' : ''}`;
        t.setAttribute('role', 'status');
        t.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
        chart.appendChild(t);
        later(() => t.remove(), 2000);
      }, delay);
    }

    // ── aiming (hover + keyboard) ──
    function paintAim(show) {
      const chart = root.querySelector('.fl-target .fl-chart');
      if (!chart) return;
      chart.querySelectorAll('.fl-cell.is-aim').forEach((b) => b.classList.remove('is-aim'));
      chart.querySelectorAll('.fl-lab span.is-on').forEach((b) => b.classList.remove('is-on'));
      if (!show) return;
      const cell = chart.querySelector(`.fl-cell[data-r="${aim.r}"][data-c="${aim.c}"]`);
      if (cell && kbd) cell.classList.add('is-aim');
      const cols = chart.querySelectorAll('.fl-lab-c span');
      const rows = chart.querySelectorAll('.fl-lab-r span');
      if (cols[aim.c]) cols[aim.c].classList.add('is-on');
      if (rows[aim.r]) rows[aim.r].classList.add('is-on');
    }

    function fire(r, c) {
      if (!ctx || !ctx.canMove || view !== 'battle' || hold) return;
      if (ctx.mode === 'local') {
        let ns;
        try { ns = rules.apply(JSON.parse(JSON.stringify(ctx.state)), ctx.actor, { r, c }); } catch (err) { bad(err.message); return; }
        if (ns.phase === 'battle' && ns.turn !== ctx.actor) {
          hold = { r, c };
          api.sfx('pop');
          render();
          hold.t = later(playHeld, reducedMotion() ? 500 : 1150);
          return;
        }
      }
      const res = api.move({ r, c });
      if (!res.ok) bad(res.error);
    }
    function playHeld() {
      const hd = hold;
      if (!hd) return;
      clearTimeout(hd.t);
      hold = null;
      const res = api.move({ r: hd.r, c: hd.c });
      if (!res.ok) { bad(res.error); render(); }
    }

    // ── placement actions ──
    function place(i, o, how) {
      const d = draft();
      d[i] = o;
      active = i;
      if (sel === i || sel < 0) sel = nextUnplaced(d, i + 1);
      fx = { drop: i };
      api.sfx(how === 'turn' ? 'flip' : 'place');
      api.haptic(12);
      render();
    }
    function rotate(i, k = 0) {
      const d = draft();
      const o = d[i];
      if (!o) return;
      const len = SIZES[i];
      k = clamp(k, 0, len - 1);
      const nd = o.dir === 'h' ? 'v' : 'h';
      const pr = o.dir === 'h' ? o.r : o.r + k;
      const pc = o.dir === 'h' ? o.c + k : o.c;
      const order = Array.from({ length: len }, (_, j) => j).sort((x, y) => Math.abs(x - k) - Math.abs(y - k));
      for (const j of order) {
        const cand = nd === 'v' ? { r: pr - j, c: pc, dir: nd } : { r: pr, c: pc - j, dir: nd };
        if (fits(d, i, cand)) { place(i, cand, 'turn'); return; }
      }
      active = i;
      bad('No room to turn it there.', root.querySelector(`.fl-place .fl-ship[data-ship="${i}"]`));
    }
    function tapPlace(r, c) {
      const d = draft();
      if (sel < 0) sel = nextUnplaced(d);
      if (sel < 0) return;
      for (const dir of [selDir, selDir === 'h' ? 'v' : 'h']) {
        const o = fitAt(sel, r, c, dir);
        if (fits(d, sel, o)) { place(sel, o); return; }
      }
      bad('No room there. Try another square.');
    }
    function shuffle() {
      const f = randomFleet();
      if (!f) return;
      drafts[V] = f;
      sel = -1;
      active = -1;
      fx = { shuffle: true };
      api.sfx('flip');
      api.haptic(15);
      render();
    }
    function ready() {
      const d = draft();
      if (d.some((x) => !x)) { bad('Place all five ships first.'); return; }
      const res = api.move({ fleet: d.map((o, i) => ({ r: o.r, c: o.c, len: SIZES[i], dir: o.dir })) });
      if (res.ok) { api.sfx('good'); api.haptic(20); } else bad(res.error);
    }

    // preview box during drags / hover
    function showPreview(o, len, ok) {
      const p = root.querySelector('.fl-place .fl-preview');
      if (!p) return;
      if (!o) { p.hidden = true; return; }
      p.hidden = false;
      p.setAttribute('style', shipAt({ ...o, len }));
      p.classList.toggle('is-bad', !ok);
    }
    function gridInfo() {
      const g = root.querySelector('.fl-place .fl-grid');
      if (!g) return null;
      const rect = g.getBoundingClientRect();
      return { rect, cs: rect.width / N };
    }
    function cellUnder(x, y) {
      const gi = gridInfo();
      if (!gi) return null;
      const c = Math.floor((x - gi.rect.left) / gi.cs);
      const r = Math.floor((y - gi.rect.top) / gi.cs);
      return onChart(r, c) ? { r, c } : null;
    }

    // ── drag ──
    function startDrag(e, t) {
      const i = Number(t.dataset.ship);
      const d = draft();
      const from = t.classList.contains('fl-dock-ship') ? 'dock' : 'chart';
      const rect = t.getBoundingClientRect();
      drag = { i, from, el: t, id: e.pointerId, x0: e.clientX, y0: e.clientY, offX: e.clientX - rect.left, offY: e.clientY - rect.top, dir: from === 'chart' ? d[i].dir : 'h', moved: false, ghost: null, target: null, over: false, scale: 1 };
      try { t.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    function ghostSize() {
      const gi = gridInfo();
      const cs = gi ? gi.cs : 40;
      const len = SIZES[drag.i];
      return { cs, w: drag.dir === 'h' ? len * cs : cs, h: drag.dir === 'v' ? len * cs : cs };
    }
    function paintGhost() {
      const { w, h } = ghostSize();
      drag.ghost.style.width = `${w}px`;
      drag.ghost.style.height = `${h}px`;
      drag.ghost.innerHTML = shipSVG(SIZES[drag.i], drag.dir);
    }
    function moveDrag(x, y) {
      const rr = root.getBoundingClientRect();
      const g = drag.ghost;
      g.style.left = `${x - drag.offX - rr.left}px`;
      g.style.top = `${y - drag.offY - rr.top}px`;
      const gi = gridInfo();
      if (!gi) return;
      const { cs } = gi;
      const len = SIZES[drag.i];
      const wc = drag.dir === 'h' ? len : 1;
      const hc = drag.dir === 'v' ? len : 1;
      const R = gi.rect;
      drag.over = x > R.left - cs * 0.5 && x < R.right + cs * 0.5 && y > R.top - cs * 0.5 && y < R.bottom + cs * 0.5;
      if (!drag.over) { drag.target = null; showPreview(null); return; }
      const c = clamp(Math.round((x - drag.offX - R.left) / cs), 0, N - wc);
      const r = clamp(Math.round((y - drag.offY - R.top) / cs), 0, N - hc);
      const o = { r, c, dir: drag.dir };
      const ok = fits(draft(), drag.i, o);
      drag.target = ok ? o : null;
      showPreview(o, len, ok);
    }
    function endDrag(commit) {
      const dg = drag;
      drag = null;
      if (!dg) return;
      try { dg.el.releasePointerCapture(dg.id); } catch { /* ignore */ }
      if (dg.ghost) dg.ghost.remove();
      if (!dg.moved) { if (deferred) render(); return; }
      suppressClick = true;
      const d = draft();
      if (commit && dg.target) { place(dg.i, dg.target); return; }
      if (commit && !dg.over && dg.from === 'chart') {
        d[dg.i] = null;
        sel = dg.i;
        active = -1;
        api.sfx('flip');
        render();
        return;
      }
      if (commit && dg.over) { fx = { shake: dg.from === 'chart' ? dg.i : null }; bad('Ships can’t overlap.'); }
      render();
    }

    // ── events ──
    root.addEventListener('pointerdown', (e) => {
      suppressClick = false;
      if (view !== 'place' || !ctx || !ctx.canMove || drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const t = e.target.closest('.fl-dock-ship[data-ship], .is-edit .fl-ship[data-ship]');
      if (t) startDrag(e, t);
    });
    root.addEventListener('pointermove', (e) => {
      if (drag && e.pointerId === drag.id) {
        if (!drag.moved) {
          if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return;
          drag.moved = true;
          // the ghost is drawn at chart scale, so keep the grab point proportional
          const rect = drag.el.getBoundingClientRect();
          const gs = ghostSize();
          drag.offX *= gs.w / Math.max(1, rect.width);
          drag.offY *= gs.h / Math.max(1, rect.height);
          drag.ghost = document.createElement('div');
          drag.ghost.className = `fl-ghost p-${V}`;
          paintGhost();
          root.appendChild(drag.ghost);
          drag.el.classList.add('is-lifted');
          api.sfx('tap');
        }
        e.preventDefault();
        moveDrag(e.clientX, e.clientY);
        return;
      }
      if (e.pointerType !== 'mouse') return;
      if (view === 'place' && ctx && ctx.canMove) {
        const cell = e.target.closest('.is-edit .fl-cell') ? cellUnder(e.clientX, e.clientY) : null;
        if (cell && sel >= 0) {
          const o = fitAt(sel, cell.r, cell.c, selDir);
          showPreview(o, SIZES[sel], fits(draft(), sel, o));
        } else showPreview(null);
      } else if (view === 'battle') {
        const b = e.target.closest('.fl-target .fl-cell');
        if (b && !b.disabled) { aim = { r: Number(b.dataset.r), c: Number(b.dataset.c) }; paintAim(true); } else if (!kbd) paintAim(false);
      }
    });
    root.addEventListener('pointerleave', () => { if (!drag && view === 'place') showPreview(null); if (view === 'battle' && !kbd) paintAim(false); });
    root.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) endDrag(true); });
    root.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) endDrag(false); });
    root.addEventListener('lostpointercapture', (e) => { if (drag && e.pointerId === drag.id && drag.moved) endDrag(true); });

    root.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      if (!ctx || !ctx.canMove) return;
      const act = e.target.closest('[data-fl]');
      if (act) {
        if (act.dataset.fl === 'shuffle' && view === 'place') shuffle();
        else if (act.dataset.fl === 'ready' && view === 'place') ready();
        return;
      }
      if (view === 'place') {
        const dockShip = e.target.closest('.fl-dock-ship[data-ship]');
        if (dockShip) { sel = Number(dockShip.dataset.ship); api.sfx('tap'); render(); return; }
        const ship = e.target.closest('.is-edit .fl-ship[data-ship]');
        if (ship) {
          const i = Number(ship.dataset.ship);
          const o = draft()[i];
          const rect = ship.getBoundingClientRect();
          let k = 0;
          if (e.detail && o) {
            k = o.dir === 'h' ? Math.floor(((e.clientX - rect.left) / rect.width) * SIZES[i]) : Math.floor(((e.clientY - rect.top) / rect.height) * SIZES[i]);
          }
          rotate(i, k);
          return;
        }
        const cell = e.target.closest('.is-edit .fl-cell');
        if (cell) tapPlace(Number(cell.dataset.r), Number(cell.dataset.c));
        return;
      }
      if (view === 'battle') {
        const cell = e.target.closest('.fl-target .fl-cell');
        if (cell && !cell.disabled) { aim = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) }; fire(aim.r, aim.c); }
      }
    });

    const onKey = (e) => {
      if (!root.isConnected || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      const gm = root.closest('.gm');
      if (gm && gm.querySelector('.gm-sheet:not([hidden]), .gm-end:not([hidden]), .gm-curtain:not([hidden])')) return;
      if (!ctx || !ctx.canMove) return;
      if (view === 'place' && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        if (drag && drag.moved) {
          drag.dir = drag.dir === 'h' ? 'v' : 'h';
          const tmp = drag.offX; drag.offX = drag.offY; drag.offY = tmp;
          paintGhost();
          api.sfx('flip');
          return;
        }
        const d = draft();
        const preview = root.querySelector('.fl-place .fl-preview');
        if (sel >= 0 && preview && !preview.hidden) { selDir = selDir === 'h' ? 'v' : 'h'; api.sfx('flip'); showPreview(null); return; }
        if (active >= 0 && d[active]) { rotate(active, 0); return; }
        if (sel >= 0) { selDir = selDir === 'h' ? 'v' : 'h'; api.sfx('flip'); api.toast(selDir === 'h' ? 'Placing across' : 'Placing down'); }
        return;
      }
      if (view !== 'battle') return;
      const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (step) {
        e.preventDefault();
        if (kbd) aim = { r: clamp(aim.r + step[0], 0, N - 1), c: clamp(aim.c + step[1], 0, N - 1) };
        kbd = true;
        paintAim(true);
        api.sfx('tick');
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!kbd) { kbd = true; paintAim(true); return; }
        fire(aim.r, aim.c);
      }
    };
    document.addEventListener('keydown', onKey);

    return {
      update(c) {
        ctx = c;
        const s = c.state;
        const v = c.viewer || (c.over ? s.winner : null);
        const shots = s.shots || [];
        let fresh = [];
        let battleStart = false;
        if (v) {
          // new shots since the last paint, but at most the latest volley (after a reconnect a pile
          // of shots can land at once, and replaying them all one by one would take ages)
          if (seenViewer === v && shots.length > seenShots) { const run0 = lastRun(shots)[0]; fresh = Array.from({ length: shots.length - seenShots }, (_, k) => seenShots + k).filter((i) => i >= run0); }
          else if (seenViewer !== v && shots.length && shots[shots.length - 1].by !== v) fresh = lastRun(shots); // catch up on their volley
          battleStart = seenPhase === 'place' && s.phase === 'battle' && !shots.length;
          seenViewer = v;
          seenShots = shots.length;
          seenPhase = s.phase;
        } else seenViewer = null;
        if (V !== v) { sel = 0; selDir = 'h'; active = -1; }
        V = v;
        render(fresh, battleStart);
      },
      destroy() {
        playHeld(); // closing mid-splash still plays the shot that was taken
        document.removeEventListener('keydown', onKey);
        for (const t of timers) clearTimeout(t);
        timers.clear();
        drag = null;
      },
    };
  },
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
