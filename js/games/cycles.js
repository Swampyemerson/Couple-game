// Light Cycles: two bikes, two trails, one grid. Every wall and every trail is solid; the last one
// riding takes the round, head-on into the same cell is a draw round, first to 3 rounds wins.
//
// Live netcode. The host ('a') owns the simulation and steps it at a fixed tick (about 13 a second,
// speeding up a little through each round). The guest sends every direction change as a 'turn'
// event with a sequence number, and also lists its not-yet-received turns in its own presence, so
// a dropped event is recovered from the next presence frame. The host applies at most one queued
// turn per player per tick, appends it to the round's turn log, and publishes
// { round, phase, tick, turn log, score, acks } in presence. Both sides rebuild the trails from the
// fixed start positions plus the log with the same pure step(), so a dropped presence frame never
// leaves a gap: the next one carries the whole log. The guest draws its own unconfirmed turn as a
// small "intent" arrow at once, so steering feels instant.
import { registerGame } from './core.js';

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const DIR = ['up', 'right', 'down', 'left'];
// s: computer (square, riders face off left/right). p: phone (portrait, riders face off bottom/top).
// Both riders sit on the centre line, an even distance apart, so riding straight on meets head-on.
const LAYOUTS = {
  s: { W: 49, H: 49, a: [6, 24, 1], b: [42, 24, 3] },
  p: { W: 31, H: 45, a: [15, 39, 0], b: [15, 5, 2] },
};
const WIN_AT = 3;
const MAX_ROUNDS = 9;
const COUNT_MS = 650;
const END_MS = 1900;
const tickMs = (t) => Math.max(70, 78 - 0.04 * t);
const KEYS = {
  KeyW: ['a', 0], KeyD: ['a', 1], KeyS: ['a', 2], KeyA: ['a', 3],
  ArrowUp: ['b', 0], ArrowRight: ['b', 1], ArrowDown: ['b', 2], ArrowLeft: ['b', 3],
};
const KEY_ALIAS = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── pure simulation (shared by host, guest and the tests) ──────────────
function newSim(L) {
  const g = LAYOUTS[L];
  const sim = { L, W: g.W, H: g.H, t: 0, occ: new Uint8Array(g.W * g.H), done: false, out: null };
  for (const p of ['a', 'b']) {
    const [x, y, d] = g[p];
    sim[p] = { x, y, d, alive: true, path: [x, y], crash: null };
    sim.occ[y * g.W + x] = 1;
  }
  return sim;
}
const okTurn = (cur, d) => d !== cur && d !== ((cur + 2) & 3);
/** Advance one tick. turns = { a?: dir, b?: dir } (already validated). */
function step(sim, turns) {
  if (sim.done) return;
  sim.t++;
  const nx = {};
  for (const p of ['a', 'b']) {
    const c = sim[p];
    if (turns && turns[p] != null) c.d = turns[p];
    const x = c.x + DX[c.d];
    const y = c.y + DY[c.d];
    nx[p] = { x, y, hit: x < 0 || y < 0 || x >= sim.W || y >= sim.H || sim.occ[y * sim.W + x] !== 0 };
  }
  if (nx.a.x === nx.b.x && nx.a.y === nx.b.y) { nx.a.hit = true; nx.b.hit = true; }
  for (const p of ['a', 'b']) {
    const c = sim[p];
    const n = nx[p];
    if (n.hit) { c.alive = false; c.crash = [n.x, n.y]; } else {
      c.x = n.x; c.y = n.y; c.path.push(n.x, n.y); sim.occ[n.y * sim.W + n.x] = 1;
    }
  }
  if (!sim.a.alive || !sim.b.alive) { sim.done = true; sim.out = sim.a.alive ? 'a' : sim.b.alive ? 'b' : 'd'; }
}
const enc = (e) => e.t.toString(36) + (e.p === 'a' ? e.d : e.d + 4);
function decode(s) {
  if (!s) return [];
  return s.split(',').filter(Boolean).map((x) => { const k = +x.slice(-1); return { t: parseInt(x.slice(0, -1), 36), p: k < 4 ? 'a' : 'b', d: k & 3 }; });
}
/** Rebuild a round from the start positions plus its turn log, up to tick T. */
function rebuild(L, entries, T) {
  const sim = newSim(L);
  let i = 0;
  while (sim.t < T && !sim.done) {
    const t = sim.t + 1;
    const turns = {};
    while (i < entries.length && entries[i].t <= t) { if (entries[i].t === t) turns[entries[i].p] = entries[i].d; i++; }
    step(sim, turns);
  }
  return sim;
}
function summary(sim) {
  const one = (c) => { let h = 7; for (const v of c.path) h = (Math.imul(h, 31) + v) | 0; return { x: c.x, y: c.y, d: c.d, alive: c.alive, len: c.path.length / 2, hash: h, crash: c.crash }; };
  return { L: sim.L, t: sim.t, done: sim.done, out: sim.out, a: one(sim.a), b: one(sim.b) };
}

const ARROW = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5 L20.5 17.5 H3.5 Z" transform="rotate(${d * 90} 12 12)"/></svg>`;

registerGame({
  id: 'cycles',
  title: 'Light Cycles',
  blurb: 'Leave a wall of light behind you. Don’t hit anything.',
  kind: 'live',
  team: false,
  tags: ['silly', 'quick'],
  platforms: ['phone', 'computer'],
  best: 'computer',
  minutes: 3,
  howTo: [
    'Your bike never stops. Steer it; every wall and trail is solid.',
    'Last one riding takes the round. Head-on is a draw.',
    'First to 3 rounds wins.',
    'Computer: W A S D or the arrow keys. Phone: swipe or use the pad.',
  ],
  css: `
.g-cycles { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 4px 0 2px; color: var(--g-ink); font-family: var(--g-font-body); -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
@media (min-width: 760px) { .g-cycles { width: calc(100vw - 48px); max-width: 1180px; align-self: center; } }
.g-cycles .cy-ready { margin: auto; font-weight: 800; color: var(--g-muted); }
.g-cycles .cy-row { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; gap: 22px; }
.g-cycles .cy-board { position: relative; flex: 1 1 auto; align-self: stretch; min-width: 0; min-height: 150px; touch-action: none; }
.g-cycles .cy-board.is-fit { flex: none; }
.g-cycles .cy-board canvas { position: absolute; left: 50%; top: 50%; display: block; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 8px; box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); transform: translate(calc(-50% - 3px), calc(-50% - 3px)); touch-action: none; }
.g-cycles .cy-msg { position: absolute; left: 50%; top: 50%; z-index: 2; transform: translate(-50%, -50%); pointer-events: none; text-align: center; }
.g-cycles .cy-msg.is-up { top: 24%; }
.g-cycles .cy-msg > span { display: inline-block; background: var(--g-card); color: var(--g-ink); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-ink)); padding: 10px 16px; font-weight: 800; font-size: 1.02rem; line-height: 1.25; white-space: nowrap; animation: cy-pop 0.32s cubic-bezier(0.2, 1.5, 0.4, 1) both; }
.g-cycles .cy-msg b { font-family: var(--g-font-display); font-weight: 400; }
.g-cycles .cy-msg .w-a b { color: var(--p-a-text, var(--p-a)); } .g-cycles .cy-msg .w-b b { color: var(--p-b-text, var(--p-b)); }
.g-cycles .cy-msg .is-num { display: grid; place-items: center; width: 92px; height: 92px; padding: 0; border-radius: 50%; background: var(--g-hl); color: var(--g-on-ink); font: 400 2.9rem/1 var(--g-font-display); box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); }
.g-cycles .cy-msg .is-go { width: auto; height: auto; padding: 14px 22px; border-radius: 16px; font-size: 2.4rem; transform: rotate(-4deg); }
.g-cycles .cy-msg .w-d { background: var(--g-hl); color: var(--g-on-ink); }
@keyframes cy-pop { from { transform: scale(0.55); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.g-cycles .cy-msg .is-go { animation-name: cy-go; }
@keyframes cy-go { from { transform: rotate(-4deg) scale(0.55); opacity: 0; } to { transform: rotate(-4deg) scale(1); opacity: 1; } }

.g-cycles .cy-info { display: flex; align-items: center; justify-content: center; gap: 14px; min-height: 26px; }
.g-cycles .cy-round { font: 800 0.72rem/1 var(--g-font-body); letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); min-width: 92px; text-align: center; }
.g-cycles .cy-pips { display: flex; gap: 7px; }
.g-cycles .cy-pips i { width: 14px; height: 14px; border: 2px solid var(--g-ink); border-radius: 3px; transform: rotate(45deg); background: var(--g-card); transition: background-color 0.2s; }
.g-cycles .cy-pips.p-a i.on { background: var(--p-a); } .g-cycles .cy-pips.p-b i.on { background: var(--p-b); }

/* touch pads */
.g-cycles .cy-pad { display: flex; align-items: center; justify-content: center; gap: 12px; flex: none; }
.g-cycles .cy-pad.is-rot { transform: rotate(180deg); }
.g-cycles .cy-pad-name { font: 400 0.82rem/1 var(--g-font-display); writing-mode: vertical-rl; transform: rotate(180deg); }
.g-cycles .cy-pad.p-a .cy-pad-name { color: var(--p-a-text, var(--p-a)); } .g-cycles .cy-pad.p-b .cy-pad-name { color: var(--p-b-text, var(--p-b)); }
.g-cycles .cy-pad-keys { display: grid; grid-template-columns: repeat(3, 64px); grid-template-rows: repeat(2, 52px); gap: 7px; }
.g-cycles .cy-pad.is-row .cy-pad-keys { grid-template-columns: repeat(4, 62px); grid-template-rows: 48px; }
.g-cycles .cy-pad.is-side .cy-pad-keys { grid-template-columns: repeat(3, 58px); grid-template-rows: repeat(3, 54px); }
.g-cycles .cy-key { display: grid; place-items: center; padding: 0; border: 2.5px solid var(--g-ink); border-radius: 11px; background: var(--p-a); color: var(--g-on-ink); box-shadow: 3px 3px 0 var(--g-edge, var(--g-ink)); touch-action: manipulation; cursor: pointer; transition: transform 0.06s, box-shadow 0.06s; }
.g-cycles .p-b .cy-key { background: var(--p-b); }
.g-cycles .cy-key svg { width: 24px; height: 24px; fill: currentColor; }
.g-cycles .cy-key:active, .g-cycles .cy-key.is-down { transform: translate(3px, 3px); box-shadow: 0 0 0 var(--g-edge, var(--g-ink)); }
.g-cycles .cy-key:focus-visible { outline: 3px solid var(--g-ink); outline-offset: 2px; }
.g-cycles .cy-d0 { grid-column: 2; grid-row: 1; } .g-cycles .cy-d3 { grid-column: 1; grid-row: 2; }
.g-cycles .cy-d2 { grid-column: 2; grid-row: 2; } .g-cycles .cy-d1 { grid-column: 3; grid-row: 2; }
.g-cycles .is-row .cy-key { grid-row: 1; grid-column: auto; }
.g-cycles .is-side .cy-d0 { grid-row: 1; } .g-cycles .is-side .cy-d3, .g-cycles .is-side .cy-d1 { grid-row: 2; } .g-cycles .is-side .cy-d2 { grid-row: 3; }

/* keyboard legends */
.g-cycles .cy-legend { flex: none; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 14px 16px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-ink)); }
.g-cycles .cy-legend-name { font: 400 1.05rem/1.1 var(--g-font-display); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-cycles .cy-legend.p-a .cy-legend-name { color: var(--p-a-text, var(--p-a)); } .g-cycles .cy-legend.p-b .cy-legend-name { color: var(--p-b-text, var(--p-b)); }
.g-cycles .cy-legend-tag { font: 800 0.66rem/1.2 var(--g-font-body); letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); text-align: center; }
.g-cycles .cy-caps { display: grid; grid-template-columns: repeat(3, 40px); grid-template-rows: repeat(2, 40px); gap: 5px; }
.g-cycles .cy-caps kbd { display: grid; place-items: center; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-bg); color: var(--g-ink); box-shadow: 0 3px 0 var(--g-edge, var(--g-ink)); font: 800 1rem/1 var(--g-font-body); transition: transform 0.06s, box-shadow 0.06s, background-color 0.15s; }
.g-cycles .cy-caps kbd svg { width: 15px; height: 15px; fill: currentColor; }
.g-cycles .cy-caps kbd:nth-child(1) { grid-column: 2; grid-row: 1; } .g-cycles .cy-caps kbd:nth-child(2) { grid-column: 1; grid-row: 2; }
.g-cycles .cy-caps kbd:nth-child(3) { grid-column: 2; grid-row: 2; } .g-cycles .cy-caps kbd:nth-child(4) { grid-column: 3; grid-row: 2; }
.g-cycles .cy-caps kbd.is-down { transform: translateY(3px); box-shadow: 0 0 0 var(--g-edge, var(--g-ink)); }
.g-cycles .cy-legend.p-a kbd.is-down { background: var(--p-a); color: var(--g-on-ink); } .g-cycles .cy-legend.p-b kbd.is-down { background: var(--p-b); color: var(--g-on-ink); }
.g-cycles .cy-legend.is-them { align-self: center; min-width: 132px; }
.g-cycles .cy-bike { width: 22px; height: 34px; border: 2.5px solid var(--g-ink); border-radius: 7px; background: linear-gradient(var(--g-hl) 0 58%, var(--g-ink) 58% 64%, transparent 64%); position: relative; }
.g-cycles .cy-legend.p-a .cy-bike { background-color: var(--p-a); } .g-cycles .cy-legend.p-b .cy-bike { background-color: var(--p-b); }
.g-cycles .cy-legends { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; }
.g-cycles .cy-legends .cy-legend { flex-direction: row; padding: 10px 14px; gap: 14px; }
.g-cycles .cy-legends .cy-caps { grid-template-columns: repeat(3, 34px); grid-template-rows: repeat(2, 34px); }
.g-cycles .cy-or { font-weight: 800; color: var(--g-muted); }
@media (max-height: 760px) { .g-cycles .cy-pad-keys { grid-template-rows: repeat(2, 46px); } .g-cycles .cy-pad.is-row .cy-pad-keys { grid-template-rows: 44px; } }
/* a phone on its side: the pads move beside the board instead of above and below it */
@media (orientation: landscape) and (max-height: 520px) {
  .g-cycles[data-ui="live-touch"], .g-cycles[data-ui="local-touch-p"] { display: grid; grid-template-rows: minmax(0, 1fr) auto; column-gap: 16px; row-gap: 6px; padding: 2px 0; }
  .g-cycles[data-ui="live-touch"] { grid-template-columns: minmax(0, 1fr) auto; }
  .g-cycles[data-ui="live-touch"] > .cy-row { grid-area: 1 / 1; }
  .g-cycles[data-ui="live-touch"] > .cy-info { grid-area: 2 / 1; }
  .g-cycles[data-ui="live-touch"] > .cy-pad { grid-area: 1 / 2 / 3 / 3; align-self: center; }
  .g-cycles[data-ui="local-touch-p"] { grid-template-columns: auto minmax(0, 1fr) auto; }
  .g-cycles[data-ui="local-touch-p"] > .cy-pad.p-b { grid-area: 1 / 1 / 3 / 2; align-self: center; }
  .g-cycles[data-ui="local-touch-p"] > .cy-row { grid-area: 1 / 2; }
  .g-cycles[data-ui="local-touch-p"] > .cy-info { grid-area: 2 / 2; }
  .g-cycles[data-ui="local-touch-p"] > .cy-pad.p-a { grid-area: 1 / 3 / 3 / 4; align-self: center; }
  .g-cycles[data-ui="live-touch"] .cy-pad .cy-pad-keys, .g-cycles[data-ui="local-touch-p"] .cy-pad .cy-pad-keys { grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(2, 54px); gap: 6px; }
  .g-cycles[data-ui="live-touch"] .cy-pad .cy-d0, .g-cycles[data-ui="local-touch-p"] .cy-pad .cy-d0 { grid-column: 2; grid-row: 1; }
  .g-cycles[data-ui="live-touch"] .cy-pad .cy-d3, .g-cycles[data-ui="local-touch-p"] .cy-pad .cy-d3 { grid-column: 1; grid-row: 2; }
  .g-cycles[data-ui="live-touch"] .cy-pad .cy-d2, .g-cycles[data-ui="local-touch-p"] .cy-pad .cy-d2 { grid-column: 2; grid-row: 2; }
  .g-cycles[data-ui="live-touch"] .cy-pad .cy-d1, .g-cycles[data-ui="local-touch-p"] .cy-pad .cy-d1 { grid-column: 3; grid-row: 2; }
}
@media (prefers-reduced-motion: reduce) { .g-cycles *, .g-cycles *::before { animation: none !important; transition: none !important; } }
`,
  mount(el, api) {
    const local = api.mode === 'local';
    const host = local || api.isHost;
    const me = local ? null : api.me;
    const flip = me === 'b'; // the guest sees the board turned round, so their bike starts at the bottom
    const mq = (q) => { try { return matchMedia(q).matches; } catch { return false; } };
    const touch = mq('(pointer: coarse)');
    const reduce = mq('(prefers-reduced-motion: reduce)');
    const pref = window.innerWidth >= 700 && window.innerWidth >= window.innerHeight * 1.05 ? 's' : 'p';
    const offs = [];
    const timers = new Set();
    let alive = true;
    let raf = 0;

    // ── match state: the host owns it, the guest mirrors the host's presence ──
    const mid = host ? Math.random().toString(36).slice(2, 9) : null;
    let layout = local ? pref : null;
    let phase = 'wait'; // wait | count | run | end | over
    let round = 0;
    let cd = 0;
    let rw = null;
    let paused = false;
    let overRes = null; // the match result, also in presence so a guest never misses its end card
    let finT = 0;
    let score = { a: 0, b: 0 };
    let sim = null;
    let entries = [];
    let encs = [];
    let cdStart = 0;
    let acc = 0;
    let endAt = 0;
    let goAt = 0;
    let crashAt = 0;
    let lastNow = 0;
    let dirty = true;
    const waitSince = performance.now();
    const queues = { a: [], b: [] };
    // host: guest turns received in order (rx) and processed (dn)
    let rxB = 0;
    let dnB = 0;
    let gapSince = 0;
    let curG = null; // the guest's session: a re-joined guest starts its sequence numbers again
    const bufB = new Map();
    // guest
    let hostMid = null;
    let staleMid = null;
    const gid = host ? null : Math.random().toString(36).slice(2, 9);
    let seq = 0;
    let pending = [];
    let gRx = 0;
    let gEntries = [];
    let gRound = 0;
    let lastPh = null;
    let lastInfo = '';
    if (!host) { const s0 = api.partnerState(); if (s0 && s0.ph === 'over') staleMid = s0.mid; }

    el.innerHTML = '<div class="g-cycles"><p class="cy-ready">Getting the grid ready…</p></div>';
    const root = el.firstElementChild;
    let canvas = null;
    let ctx = null;
    let board = null;
    let msgEl = null;
    let cssW = 0;
    let cssH = 0;
    let cell = 8;
    let dpr = 1;
    let C = {};
    let msgKey = '';
    let ro = null;

    // ── colours (resolved from the theme tokens) ──
    const probe = document.createElement('i');
    probe.style.display = 'none';
    el.appendChild(probe);
    function readColors() {
      const t = api.tokens();
      const col = (v, fb) => { probe.style.color = ''; probe.style.color = v || fb; return getComputedStyle(probe).color || v || fb; };
      C = {
        a: col(t.a, 'var(--p-a)'), b: col(t.b, 'var(--p-b)'), ink: col(t.ink, 'var(--g-ink)'), card: col(t.card, 'var(--g-card)'),
        line: col(t.line, 'var(--g-line)'), hl: col(t.hl, 'var(--g-hl)'), bad: col(t.bad, 'var(--g-bad)'), muted: col(t.muted, 'var(--g-muted)'),
        edge: col('var(--g-edge, var(--g-ink))'), dark: !!t.dark,
      };
      dirty = true;
    }
    readColors();
    const darkMq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
    const onScheme = () => readColors();
    if (darkMq && darkMq.addEventListener) { darkMq.addEventListener('change', onScheme); offs.push(() => darkMq.removeEventListener('change', onScheme)); }
    const mo = new MutationObserver(onScheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    offs.push(() => mo.disconnect());

    // ── DOM ──
    function padHTML(p, { rot = false, row = false, side = false } = {}) {
      const key = (d) => `<button type="button" class="cy-key cy-d${d}" data-p="${p}" data-d="${d}" data-rot="${rot ? 1 : 0}" aria-label="${esc(api.name(p))}: ${DIR[d]}">${ARROW(d)}</button>`;
      return `<div class="cy-pad p-${p}${rot ? ' is-rot' : ''}${row ? ' is-row' : ''}${side ? ' is-side' : ''}" data-pad="${p}">
        <span class="cy-pad-name">${esc(api.name(p))}</span>
        <div class="cy-pad-keys">${row ? [3, 0, 2, 1].map(key).join('') : [0, 3, 1, 2].map(key).join('')}</div>
      </div>`;
    }
    // keycaps: data-k = key set (w: W A S D, r: arrows) + direction, so a press can light its cap
    const capsWASD = () => `<div class="cy-caps">${['W', 'A', 'S', 'D'].map((k) => `<kbd data-k="w${'WDSA'.indexOf(k)}">${k}</kbd>`).join('')}</div>`;
    const capsArrows = () => `<div class="cy-caps">${[0, 3, 2, 1].map((d) => `<kbd data-k="r${d}" aria-label="${DIR[d]} arrow">${ARROW(d)}</kbd>`).join('')}</div>`;
    function legendHTML(p, tag) {
      return `<div class="cy-legend p-${p}"><span class="cy-legend-name">${esc(api.name(p))}</span>${p === 'a' ? capsWASD() : capsArrows()}${tag ? `<span class="cy-legend-tag">${tag}</span>` : ''}</div>`;
    }
    function build() {
      const g = LAYOUTS[layout];
      const boardHTML = '<div class="cy-board"><canvas aria-label="Light Cycles grid" role="img"></canvas><div class="cy-msg" aria-live="polite"></div></div>';
      const info = '<div class="cy-info"><span class="cy-pips p-a"></span><span class="cy-round"></span><span class="cy-pips p-b"></span></div>';
      let html;
      root.dataset.ui = local ? `local-${touch ? 'touch' : 'keys'}-${layout}` : touch ? 'live-touch' : 'live-keys';
      if (local && touch && layout === 'p') {
        html = `${padHTML('b', { rot: true, row: true })}<div class="cy-row">${boardHTML}</div>${info}${padHTML('a', { row: true })}`;
      } else if (local && touch) {
        html = `<div class="cy-row">${padHTML('a', { side: true })}${boardHTML}${padHTML('b', { side: true })}</div>${info}`;
      } else if (local && layout === 's') {
        const side = (p) => (g[p][0] < g.W / 2 ? 'starts left' : 'starts right');
        html = `<div class="cy-row">${legendHTML('a', side('a'))}${boardHTML}${legendHTML('b', side('b'))}</div>${info}`;
      } else if (local) {
        html = `<div class="cy-row">${boardHTML}</div>${info}<div class="cy-legends">${legendHTML('a', 'bottom')}${legendHTML('b', 'top')}</div>`;
      } else if (touch) {
        html = `<div class="cy-row">${boardHTML}</div>${info}${padHTML(me, { row: layout === 'p' && window.innerHeight < 720 })}`;
      } else {
        // live on a computer: from your own side you always start on the left (or at the bottom)
        const them = api.other(me);
        const [mine, theirs] = layout === 's' ? ['you start left', 'starts right'] : ['you start at the bottom', 'starts at the top'];
        html = `<div class="cy-row"><div class="cy-legend p-${me}"><span class="cy-legend-name">${esc(api.name(me))}</span>${capsWASD()}<span class="cy-or">or</span>${capsArrows()}<span class="cy-legend-tag">${mine}</span></div>${boardHTML}<div class="cy-legend is-them p-${them}"><span class="cy-legend-name">${esc(api.name(them))}</span><i class="cy-bike" aria-hidden="true"></i><span class="cy-legend-tag">${theirs}</span></div></div>${info}`;
      }
      root.innerHTML = html;
      root.dataset.layout = layout;
      canvas = root.querySelector('canvas');
      ctx = canvas.getContext('2d');
      board = root.querySelector('.cy-board');
      msgEl = root.querySelector('.cy-msg');
      msgKey = '';
      if (window.ResizeObserver) { ro = new window.ResizeObserver(fit); ro.observe(board.parentElement); }
      fit();
      wireInputs();
      renderInfo();
    }
    function fit() {
      if (!board || !layout) return;
      const g = LAYOUTS[layout];
      const row = board.parentElement;
      const sides = [...row.children].filter((x) => x !== board);
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const bw = row.clientWidth - sides.reduce((n, x) => n + x.offsetWidth + gap, 0) - 14;
      const bh = row.clientHeight - 14;
      const c = Math.max(3, Math.floor(Math.min(bw / g.W, bh / g.H) * 4) / 4);
      cell = c;
      cssW = Math.round(c * g.W);
      cssH = Math.round(c * g.H);
      dpr = Math.min(3, window.devicePixelRatio || 1);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      board.classList.add('is-fit');
      board.style.width = cssW + 14 + 'px';
      dirty = true;
    }
    function renderInfo() {
      const r = root.querySelector('.cy-round');
      if (!r) return;
      r.textContent = `Best of ${WIN_AT * 2 - 1}`;
      for (const p of ['a', 'b']) {
        const pips = root.querySelector(`.cy-pips.p-${p}`);
        pips.innerHTML = Array.from({ length: WIN_AT }, (_, i) => `<i class="${i < score[p] ? 'on' : ''}"></i>`).join('');
        pips.setAttribute('aria-label', `${api.name(p)}: ${score[p]} round${score[p] === 1 ? '' : 's'}`);
      }
      api.setScore(score);
      api.setStatus(phase === 'wait' ? (local ? 'Get ready' : null) : `Round ${round} · first to ${WIN_AT}`);
    }

    // ── input ──
    const active = () => (phase === 'count' || phase === 'run') && !paused;
    function input(p, d) {
      if (!active() || !sim) return;
      if (host) {
        const q = queues[p];
        if (q.length >= 3 || !sim[p].alive) return;
        q.push({ seq: 0, d });
      } else guestTurn(d);
    }
    function guestTurn(d) {
      if (!hostMid || !sim[me].alive) return;
      const cur = pending.length ? pending[pending.length - 1].d : sim[me].d;
      if (!okTurn(cur, d)) return;
      const e = { seq: ++seq, r: round, d };
      pending.push(e);
      if (pending.length > 12) pending.shift();
      api.send('turn', { m: hostMid, g: gid, s: e.seq, r: e.r, d });
      publishGuest();
      dirty = true;
    }
    // screen direction -> world direction for a player (rot: that player's pad/half is upside down)
    const world = (d, rot) => (d + (rot ? 2 : 0) + (flip ? 2 : 0)) & 3;
    function flash(sel) {
      const k = root.querySelector(sel);
      if (!k) return;
      k.classList.add('is-down');
      const t = setTimeout(() => { timers.delete(t); k.classList.remove('is-down'); }, 120);
      timers.add(t);
    }
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const code = KEYS[e.code] ? e.code : KEY_ALIAS[String(e.key).toLowerCase()] || (KEYS[e.key] ? e.key : null);
      if (!code || !layout) return;
      if (phase !== 'over') e.preventDefault();
      if (e.repeat) return;
      const [p, d] = KEYS[code];
      flash(`kbd[data-k="${p === 'a' ? 'w' : 'r'}${d}"]`);
      if (local) input(p, d); else input(me, world(d, false));
    }
    window.addEventListener('keydown', onKey);
    offs.push(() => window.removeEventListener('keydown', onKey));

    let swipe = null;
    function wireInputs() {
      const press = (b) => {
        const p = b.dataset.p;
        const d = world(+b.dataset.d, b.dataset.rot === '1');
        input(local ? p : me, d);
        api.haptic(8);
      };
      root.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('.cy-key');
        if (b) { e.preventDefault(); press(b); }
      });
      root.addEventListener('click', (e) => { const b = e.target.closest('.cy-key'); if (b && e.detail === 0) press(b); });
      board.addEventListener('pointerdown', (e) => {
        swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try { board.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      });
      board.addEventListener('pointermove', (e) => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (Math.hypot(dx, dy) < 18) return;
        const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
        swipe.x = e.clientX; swipe.y = e.clientY;
        if (!local) { input(me, world(d, false)); return; }
        // one device: the half you swipe on is whose bike turns
        const r = canvas.getBoundingClientRect();
        if (layout === 'p') { const top = e.clientY < r.top + r.height / 2; input(top ? 'b' : 'a', world(d, top)); } else input(e.clientX < r.left + r.width / 2 ? 'a' : 'b', d);
      });
      const end = (e) => { if (swipe && e.pointerId === swipe.id) swipe = null; };
      board.addEventListener('pointerup', end);
      board.addEventListener('pointercancel', end);
    }

    // ── host ──
    function publish() {
      if (local) return;
      let lo = 0;
      let lg = encs.join(',');
      if (lg.length > 2600) { lo = Math.max(0, encs.length - 360); lg = encs.slice(lo).join(','); }
      api.setPresence({ v: 1, mid, L: layout, r: round, ph: phase, cd, t: sim ? sim.t : 0, lg, lo, sc: [score.a, score.b], rw, g: curG, rx: rxB, dn: dnB, pz: paused ? 1 : 0, res: overRes });
    }
    function startRound(now) {
      round++;
      sim = newSim(layout);
      entries = []; encs = [];
      queues.a = []; queues.b = [];
      dnB = rxB;
      rw = null; crashAt = 0;
      phase = 'count'; cdStart = now; cd = 3;
      api.sfx('tick');
      publish(); renderInfo();
      dirty = true;
    }
    function hostTick(now) {
      const turns = {};
      for (const p of ['a', 'b']) {
        const q = queues[p];
        while (q.length) {
          const e = q.shift();
          if (e.seq) dnB = Math.max(dnB, e.seq);
          if (e.stale || !okTurn(sim[p].d, e.d)) continue;
          turns[p] = e.d;
          break;
        }
      }
      const t = sim.t + 1;
      for (const p of ['a', 'b']) if (turns[p] != null) { const e = { t, p, d: turns[p] }; entries.push(e); encs.push(enc(e)); }
      step(sim, turns);
      if (sim.done) roundOver(now);
      publish();
      dirty = true;
    }
    function roundOver(now) {
      phase = 'end'; endAt = now; crashAt = now; rw = sim.out;
      if (rw === 'a' || rw === 'b') score[rw]++;
      api.sfx('hit'); api.haptic(40);
      renderInfo();
    }
    function nextRound(now) {
      const done = score.a >= WIN_AT || score.b >= WIN_AT || round >= MAX_ROUNDS;
      if (!done) { startRound(now); return; }
      phase = 'over';
      const w = score.a > score.b ? 'a' : score.b > score.a ? 'b' : null;
      const hi = Math.max(score.a, score.b);
      const lo = Math.min(score.a, score.b);
      overRes = w
        ? { winner: w, text: `${api.name(w)} wins ${hi}–${lo}`, sub: lo === 0 ? 'A clean sweep. Not a scratch on that bike.' : 'Last one riding, three times over.' }
        : { winner: null, text: `Dead heat ${hi}–${lo}`, sub: 'Nine rounds and nobody blinked.' };
      publish();
      api.finish(overRes);
    }
    /** Host, fresh mount: the guest remembers the match we were in the middle of. */
    function adoptMatch(ps) {
      if (!ps || ps.v !== 1 || typeof ps.hm !== 'string' || ps.hm === mid || ps.hph === 'over' || !Array.isArray(ps.hsc)) return;
      const a0 = Math.max(0, ps.hsc[0] | 0); const b0 = Math.max(0, ps.hsc[1] | 0);
      if (!(a0 + b0) || a0 >= WIN_AT || b0 >= WIN_AT) return;
      score = { a: a0, b: b0 };
      // a round that was still being ridden is ridden again; a decided one counts
      round = Math.max(0, Math.min(MAX_ROUNDS - 1, (ps.hr | 0) - (ps.hph === 'end' ? 0 : 1)));
    }
    function recvB(m, g, s, r, d) {
      if (m !== mid || !g) return;
      if (g !== curG) { curG = g; rxB = 0; dnB = 0; bufB.clear(); gapSince = 0; queues.b = []; }
      if (!Number.isInteger(s) || s <= rxB || bufB.has(s) || !(d >= 0 && d <= 3)) return;
      bufB.set(s, { r, d });
      if (!gapSince) gapSince = performance.now();
      drainB();
    }
    function drainB() {
      let moved = false;
      while (bufB.has(rxB + 1)) {
        const e = bufB.get(rxB + 1);
        bufB.delete(rxB + 1);
        rxB++;
        moved = true;
        queues.b.push({ seq: rxB, d: e.d, stale: e.r !== round || !(phase === 'count' || phase === 'run') });
        if (queues.b.length > 6) dnB = Math.max(dnB, queues.b.shift().seq);
      }
      if (!bufB.size) gapSince = 0;
      if (moved) publish();
    }
    function hostUpdate(now, dt) {
      if (phase === 'wait') {
        if (!local) {
          const ps = api.partnerState();
          const gp = ps && (ps.pref === 'p' || ps.pref === 's') ? ps.pref : null;
          if (!gp && now - waitSince < 1500) return;
          layout = pref === 'p' || gp === 'p' ? 'p' : 's';
        }
        if (!canvas) build();
        if (!local) adoptMatch(api.partnerState());
        startRound(now);
        return;
      }
      if (bufB.size && gapSince && now - gapSince > 1200) { rxB = Math.min(...bufB.keys()) - 1; gapSince = 0; drainB(); }
      if (paused || phase === 'over') return;
      if (phase === 'count') {
        const k = 3 - Math.floor((now - cdStart) / COUNT_MS);
        if (k <= 0) { phase = 'run'; acc = 0; goAt = now; cd = 0; api.sfx('pop'); publish(); } else if (k !== cd) { cd = k; api.sfx('tick'); publish(); }
      } else if (phase === 'run') {
        acc += dt;
        let n = 0;
        while (phase === 'run' && acc >= tickMs(sim.t) && n < 4) { acc -= tickMs(sim.t); hostTick(now); n++; }
        if (n >= 4) acc = 0;
      } else if (phase === 'end' && now - endAt >= END_MS) nextRound(now);
    }

    // ── guest ──
    // keep: the host's match as last seen, mirrored in our presence so a host that reloads or
    // reopens the game mid-match carries on from the same score instead of restarting.
    let keep = null; // { mid, sc: [a, b], r, ph }
    function publishGuest() {
      api.setPresence({
        v: 1, pref, mid: hostMid, g: gid, q: pending.filter((p) => p.seq > gRx).slice(-12).map((p) => [p.seq, p.r, p.d]),
        hid: document.hidden ? 1 : 0, ...(keep ? { hm: keep.mid, hsc: keep.sc, hr: keep.r, hph: keep.ph } : {}),
      });
    }
    function onHost(s) {
      if (!alive || !s || s.v !== 1 || !s.mid || !s.L || s.mid === staleMid) return;
      if (s.mid !== hostMid) { hostMid = s.mid; seq = 0; pending = []; gRx = 0; gEntries = []; gRound = 0; lastPh = null; }
      if (!layout) { layout = s.L; build(); }
      if (s.r !== gRound) { gRound = s.r; gEntries = []; crashAt = 0; }
      const part = decode(s.lg);
      if (!s.lo) gEntries = part; else part.forEach((e, i) => { gEntries[s.lo + i] = e; });
      const now = performance.now();
      if (s.ph === 'count' && s.cd !== cd && !s.pz) api.sfx('tick');
      if (s.ph === 'run' && lastPh !== 'run') { goAt = now; api.sfx('pop'); }
      phase = s.ph; round = s.r; cd = s.cd; rw = s.rw; paused = !!s.pz;
      lastPh = s.ph;
      const sc = Array.isArray(s.sc) ? s.sc : [0, 0];
      const infoKey = `${round}|${phase}|${sc[0]}|${sc[1]}`;
      score = { a: sc[0] | 0, b: sc[1] | 0 };
      sim = rebuild(layout, gEntries.filter(Boolean), s.t | 0);
      if (sim.done && !crashAt) { crashAt = now; api.sfx('hit'); api.haptic(40); }
      const mine = s.g === gid; // acks are for this guest session only
      pending = pending.filter((p) => p.r === round && !(mine && p.seq <= (s.dn | 0)));
      if (mine && (s.rx | 0) !== gRx) { gRx = s.rx | 0; publishGuest(); }
      if (infoKey !== lastInfo) {
        lastInfo = infoKey; renderInfo();
        // a fresh host mount (new id, earlier round) hasn't picked our score up yet: keep reporting it
        if (!keep || s.mid === keep.mid || round >= keep.r || s.ph === 'over') { keep = { mid: s.mid, sc: [score.a, score.b], r: round, ph: s.res ? 'over' : phase }; publishGuest(); }
      }
      // the engine's end-card event can drop: the host's presence carries the result as well
      if (s.ph === 'over' && s.res && !finT) { finT = setTimeout(() => { timers.delete(finT); api.finish(s.res); }, 1500); timers.add(finT); }
      dirty = true;
    }

    // ── drawing ──
    function rr(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
    function trace(c) {
      const pth = c.path;
      ctx.beginPath();
      ctx.moveTo((pth[0] + 0.5) * cell, (pth[1] + 0.5) * cell);
      if (pth.length === 2) ctx.lineTo((pth[0] + 0.5) * cell + 0.01, (pth[1] + 0.5) * cell);
      for (let i = 2; i < pth.length; i += 2) ctx.lineTo((pth[i] + 0.5) * cell, (pth[i + 1] + 0.5) * cell);
    }
    function star(cx, cy, R, r, n, rot) {
      ctx.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const a = rot + (i * Math.PI) / n;
        const rad = i % 2 ? r : R;
        ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      }
      ctx.closePath();
    }
    function draw(now) {
      if (!ctx || !layout) return;
      const g = LAYOUTS[layout];
      const c = cell;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.card;
      ctx.fillRect(0, 0, cssW, cssH);
      if (flip) { ctx.translate(cssW, cssH); ctx.rotate(Math.PI); }
      // graph-paper grid, a heavier line every 8 cells from the centre
      ctx.lineWidth = 1;
      ctx.strokeStyle = C.line;
      ctx.globalAlpha = C.dark ? 0.55 : 0.75;
      ctx.beginPath();
      for (let x = 1; x < g.W; x++) { const X = Math.round(x * c) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, cssH); }
      for (let y = 1; y < g.H; y++) { const Y = Math.round(y * c) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(cssW, Y); }
      ctx.stroke();
      // registration marks every 8 cells out from the centre, like a printed board
      ctx.globalAlpha = C.dark ? 0.7 : 0.45;
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = Math.max(1, c * 0.12);
      ctx.beginPath();
      const cx0 = (g.W - 1) / 2;
      const cy0 = (g.H - 1) / 2;
      const m = c * 0.42;
      for (let x = cx0 % 8; x < g.W; x += 8) {
        for (let y = cy0 % 8; y < g.H; y += 8) {
          const X = (x + 0.5) * c;
          const Y = (y + 0.5) * c;
          ctx.moveTo(X - m, Y); ctx.lineTo(X + m, Y); ctx.moveTo(X, Y - m); ctx.lineTo(X, Y + m);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (!sim) return;
      const tw = Math.max(2.5, c * 0.6);
      const ow = Math.max(1.2, c * 0.15);
      const sh = Math.max(1, c * 0.2) * (flip ? -1 : 1);
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'square';
      // hard offset shadow, then an ink outline, then each rider's ink
      ctx.save();
      ctx.translate(sh, sh);
      ctx.strokeStyle = C.edge;
      ctx.globalAlpha = C.dark ? 0.9 : 0.28;
      ctx.lineWidth = tw + ow * 2;
      for (const p of ['a', 'b']) { trace(sim[p]); ctx.stroke(); }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = tw + ow * 2;
      for (const p of ['a', 'b']) { trace(sim[p]); ctx.stroke(); }
      ctx.lineWidth = tw;
      for (const p of ['a', 'b']) { ctx.strokeStyle = C[p]; trace(sim[p]); ctx.stroke(); }
      // heads: a bright, outlined bike with a band of its rider's ink
      for (const p of ['a', 'b']) {
        const s = sim[p];
        ctx.save();
        ctx.translate((s.x + 0.5) * c, (s.y + 0.5) * c);
        ctx.rotate((s.d * Math.PI) / 2);
        const w = c * 1.05;
        const l = c * 1.5;
        ctx.lineWidth = ow * 1.1;
        ctx.strokeStyle = C.ink;
        ctx.fillStyle = s.alive ? C.hl : C.card;
        rr(-w / 2, -l / 2 - c * 0.18, w, l, Math.min(w, l) * 0.32);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = C[p];
        rr(-w / 2 + ow * 0.6, l * 0.1 - c * 0.18, w - ow * 1.2, l * 0.26, 1);
        ctx.fill();
        ctx.restore();
      }
      // guest: show my unconfirmed turn right away
      if (!host && pending.length && active() && sim[me].alive) {
        const d = pending[pending.length - 1].d;
        const s = sim[me];
        const x = (s.x + DX[d] * 1.25 + 0.5) * c;
        const y = (s.y + DY[d] * 1.25 + 0.5) * c;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((d * Math.PI) / 2);
        const k = c * 0.95;
        ctx.beginPath(); ctx.moveTo(0, -k * 0.75); ctx.lineTo(k * 0.7, k * 0.45); ctx.lineTo(-k * 0.7, k * 0.45); ctx.closePath();
        ctx.fillStyle = C[me]; ctx.fill();
        ctx.lineWidth = ow; ctx.strokeStyle = C.ink; ctx.stroke();
        ctx.restore();
      }
      // crash bursts
      if (sim.done && crashAt) {
        const k0 = reduce ? 1 : Math.min(1, (now - crashAt) / 380);
        const k = reduce ? 1 : 1 + 2.2 * Math.pow(k0 - 1, 3) + 1.2 * Math.pow(k0 - 1, 2);
        const seen = new Set();
        for (const p of ['a', 'b']) {
          const s = sim[p];
          if (s.alive || !s.crash) continue;
          const key = s.crash.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          const bx = (Math.max(0, Math.min(g.W - 1, s.crash[0])) + 0.5) * c;
          const by = (Math.max(0, Math.min(g.H - 1, s.crash[1])) + 0.5) * c;
          const R = Math.max(10, c * 2.3) * Math.max(0.2, k);
          ctx.lineWidth = ow * 1.2;
          ctx.strokeStyle = C.ink;
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4 + 0.3;
            ctx.beginPath();
            ctx.moveTo(bx + Math.cos(a) * R * 1.15, by + Math.sin(a) * R * 1.15);
            ctx.lineTo(bx + Math.cos(a) * R * 1.55, by + Math.sin(a) * R * 1.55);
            ctx.stroke();
          }
          star(bx, by, R, R * 0.48, 9, 0.2);
          ctx.fillStyle = C.hl; ctx.fill(); ctx.stroke();
          star(bx, by, R * 0.55, R * 0.27, 7, 0.6);
          ctx.fillStyle = C.bad; ctx.fill(); ctx.lineWidth = ow * 0.8; ctx.stroke();
        }
      }
    }
    function syncMsg(now) {
      if (!msgEl) return;
      let html = '';
      let key = '';
      if (paused) { key = 'pz'; html = '<span>Paused</span>'; } else if (phase === 'count') { key = 'c' + cd + round; html = `<span class="is-num">${cd || 3}</span>`; } else if (phase === 'run' && now - goAt < 600) { key = 'go' + round; html = '<span class="is-num is-go">GO</span>'; } else if ((phase === 'end' || phase === 'over') && sim) {
        key = 'e' + round + rw;
        if (rw === 'a' || rw === 'b') html = `<span class="w-${rw}"><b>${esc(api.name(rw))}</b> takes round ${round}</span>`;
        else {
          const ca = sim.a.crash;
          const cb = sim.b.crash;
          const head = ca && cb && ca[0] === cb[0] && ca[1] === cb[1];
          html = `<span class="w-d">${head ? 'Head-on! Nobody scores.' : 'Double crash. Nobody scores.'}</span>`;
        }
      }
      if (key === msgKey) return;
      msgKey = key;
      msgEl.innerHTML = html;
      msgEl.classList.toggle('is-up', key[0] === 'e');
    }
    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(250, now - (lastNow || now));
      lastNow = now;
      if (host) hostUpdate(now, dt);
      syncMsg(now);
      if (dirty || (crashAt && now - crashAt < 450)) { draw(now); dirty = false; }
    }

    // ── pausing (host): the partner gone, or either tab in the background. Back: a fresh countdown ──
    let partnerAway = false;
    function syncPause() {
      if (!host || phase === 'over' || phase === 'wait') return;
      const want = document.hidden || (!local && (!api.partnerHere || partnerAway));
      if (want && !paused) { paused = true; publish(); dirty = true; } else if (!want && paused) {
        paused = false;
        const now = performance.now();
        if (phase === 'run' || phase === 'count') { phase = 'count'; cdStart = now; cd = 3; api.sfx('tick'); } else if (phase === 'end') endAt = now;
        publish(); dirty = true;
      }
    }
    const onVis = () => { if (host) syncPause(); else publishGuest(); if (!document.hidden) { lastNow = 0; dirty = true; } };
    document.addEventListener('visibilitychange', onVis);
    offs.push(() => document.removeEventListener('visibilitychange', onVis));

    // ── wiring ──
    if (!local) {
      if (host) {
        offs.push(api.on('turn', (d) => { if (d) recvB(d.m, d.g, d.s, d.r, d.d); }));
        offs.push(api.onPartnerState((s) => { if (s && s.v === 1 && !!s.hid !== partnerAway) { partnerAway = !!s.hid; syncPause(); } }));
        offs.push(api.onPartnerState((s) => { if (s && s.mid === mid && s.g && Array.isArray(s.q)) { if (s.g !== curG) recvB(mid, s.g, 0, 0, -1); for (const x of s.q) if (Array.isArray(x)) recvB(mid, s.g, x[0], x[1], x[2]); } }));
        offs.push(api.onPartnerHere(() => syncPause()));
      } else {
        offs.push(api.onPartnerState(onHost));
        publishGuest();
        const s0 = api.partnerState();
        if (s0) onHost(s0);
      }
    } else build();

    // test hook (automation only)
    const hook = {
      info: () => ({
        mode: api.mode, host, me, flip, touch, layout, phase, round, cd, rw, paused, score: { ...score },
        sim: sim && summary(sim),
        rebuilt: host && sim ? summary(rebuild(layout, entries, sim.t)) : null,
        log: host ? encs.join(',') : gEntries.filter(Boolean).map(enc).join(','),
        pending: pending.map((p) => p.d),
        cell, cssW, cssH,
      }),
    };
    if (navigator.webdriver) window.__cycles = hook;

    raf = requestAnimationFrame(frame);
    return {
      destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        timers.forEach((t) => clearTimeout(t));
        if (ro) ro.disconnect();
        offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
        if (window.__cycles === hook) delete window.__cycles;
      },
    };
  },
});
