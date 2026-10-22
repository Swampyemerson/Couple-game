// Light Cycles: two bikes, two trails, one grid. Every wall and every trail is solid; the last one
// riding takes the round, head-on into the same cell is a draw round, first to 3 rounds wins.
// Pick an arena first (Classic, Pillars, Cross, Rings, Scatter, Rotate, Surprise me), optionally with
// boost tokens. Design notes: docs/games/cycles.md. The pure simulation lives in cycles/sim.js.
//
// Live netcode. The host ('a') owns the simulation and steps it at a fixed tick (about 13 a second;
// non-classic arenas speed up from 78 to 50 ms over ~20 s). The guest sends every direction change as
// a 'turn' event with a sequence number, and also lists its not-yet-received turns in its own presence,
// so a dropped event is recovered from the next presence frame. The host applies at most one queued
// turn per player per tick, appends it to the round's turn log, and publishes
// { round config, phase, tick, turn log, score, acks } in presence. Both sides rebuild the trails from
// the round config (arena, seed, start variant) plus the log with the same pure step(), so a dropped
// presence frame never leaves a gap: the next one carries the whole log. The guest predicts its own
// head (it turns at once, drawn as a predicted segment) and reconciles to the log; the host log is
// always the truth. Heads are drawn between ticks (interpolated / extrapolated) for smooth motion.
//
// Rendering (flat unit). The sim steps at its fixed tick and the picture is interpolated between ticks, so it is the
// same at 60 and 120 Hz. Trails live in persistent offscreen layers: a tick only strokes its new segments (and patches a
// small dirty rectangle of the composite); each frame is two drawImage calls plus the segment still growing from the last
// whole cell to the head, the heads and the effects. The guest runs a smoothed estimate of the host's clock and blends every
// correction (a late presence frame, a turn that lands a cell off the prediction) away over ~100 ms instead of snapping.
import { registerGame } from './core.js';
import { CSS } from './cycles/css.js';
import {
  DX, DY, DIR, LAYOUTS, ARENAS, BOOST_TICKS, tickMs, newSim, okTurn, step, enc, decode, rebuild, advance, summary,
  arenaBlocks, isSymmetric, pathAt,
} from './cycles/sim.js';

const WIN_AT = 3;
const MAX_ROUNDS = 9;
const COUNT_MS = 650;
const HOLD_MS = 320; // the crash itself, at full size
const REPLAY_MS = 1200; // the slow replay, zoomed on the crash
const BANNER_MS = 1500; // the round banner
const END_TOTAL = HOLD_MS + REPLAY_MS + BANNER_MS;
const REPLAY_TICKS = 16;
const ZOOM = 2.4;
const MAX_DT = 50; // ms: the drawing's clamp: a longer frame is a hitch, not motion to animate through
const OWN_AHEAD = 0.55; // guest: its own head is drawn this many ticks past the last confirmed one
const OPP_GAP = 1.45; // guest: the opponent is drawn this many ticks behind its own clock (entity interpolation)
const EXT_CAP = 1.6; // ticks a head may run on past the confirmed cell while the next presence frame is late
const TAU_BLEND = 42; // ms: a correction fades with this time constant (about 100 ms to vanish)
const BLEND_RATE = 0.014; // cells per ms: the fastest a correction may fade (a 3-cell one takes about 200 ms)
const PL = ['a', 'b'];
const SHADOW_SIGN = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
const KEYS = {
  KeyW: ['a', 0], KeyD: ['a', 1], KeyS: ['a', 2], KeyA: ['a', 3],
  ArrowUp: ['b', 0], ArrowRight: ['b', 1], ArrowDown: ['b', 2], ArrowLeft: ['b', 3],
};
const KEY_ALIAS = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD' };
const ARENA_NAME = { classic: 'Classic', pillars: 'Pillars', cross: 'Cross', rings: 'Rings', scatter: 'Scatter', rotate: 'Rotate', surprise: 'Surprise me' };
const ARENA_BLURB = {
  classic: 'Open grid. Pure riding.',
  pillars: 'Four blocks to weave around.',
  cross: 'A walled plus with a few gaps.',
  rings: 'Walls inside walls.',
  scatter: 'Random blocks, the same for both.',
  rotate: 'A different arena every round.',
  surprise: 'We pick one for the whole match.',
};
const CHOICES = ['classic', 'pillars', 'cross', 'rings', 'scatter', 'rotate', 'surprise'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Paper tooth: one small deterministic noise mask, shared by every board; tinted with the theme's ink when a board is painted.
let grainMask = null;
function getGrainMask() {
  if (grainMask) return grainMask;
  const n = 96;
  const cv = document.createElement('canvas');
  cv.width = n; cv.height = n;
  const g = cv.getContext('2d');
  const im = g.createImageData(n, n);
  let r = 0x2545f491;
  for (let i = 0; i < n * n; i++) {
    r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
    const v = r / 4294967296;
    im.data[i * 4 + 3] = Math.floor(Math.pow(v, 2.4) * 255);
  }
  g.putImageData(im, 0, 0);
  grainMask = cv;
  return cv;
}
const ARROW = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5 L20.5 17.5 H3.5 Z" transform="rotate(${d * 90} 12 12)"/></svg>`;
const BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 5 13.5h5.5L9.5 22 19 9.5h-5.8z"/></svg>';
const SPIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 0 7.6 5.5l-2 .8A5.8 5.8 0 1 1 12 6.2V9l5-4-5-4z"/></svg>';

registerGame({
  id: 'cycles',
  title: 'Light Cycles',
  blurb: 'Leave a wall of light behind you. Pick an arena. Don’t hit anything.',
  kind: 'live',
  team: false,
  tags: ['silly', 'quick'],
  platforms: ['phone', 'computer'],
  best: 'computer',
  minutes: 3,
  howTo: [
    'Your bike never stops. Steer it; every wall and trail is solid.',
    'Last one riding takes the round. Head-on is a draw. First to 3 rounds wins.',
    'Pick an arena, and turn Boosts on for speed and jump tokens.',
    'Computer: W A S D or the arrow keys. Phone: swipe or use the pad.',
  ],
  css: CSS,
  mount(el, api) {
    const local = api.mode === 'local';
    const host = local || api.isHost;
    const me = local ? null : api.me;
    const flip = me === 'b'; // the guest sees the board turned round, so their bike starts at the bottom (or left)
    const mq = (q) => { try { return matchMedia(q).matches; } catch { return false; } };
    const touch = mq('(pointer: coarse)');
    let reduce = mq('(prefers-reduced-motion: reduce)');
    // the grid that suits this screen: s square (computer), p portrait phone, l phone on its side
    const prefNow = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w >= h * 1.05 && h <= 520 && w >= 480) return 'l'; // a phone on its side (also the small ones: 568x320, 667x375)
      return w >= 700 && w >= h * 1.05 ? 's' : 'p';
    };
    let pref = prefNow();
    // two screens, one grid: a phone on its side wins over a portrait one (the portrait phone then draws the wide grid turned a
    // quarter, see `qr`), so the smaller screen never gets a tiny board; a computer with a portrait phone plays portrait
    const pickLayout = (x, y) => (x === y ? x : x === 'l' || y === 'l' ? 'l' : 'p');
    const offs = [];
    try {
      const rm = matchMedia('(prefers-reduced-motion: reduce)');
      const onRm = () => { reduce = rm.matches; };
      if (rm.addEventListener) { rm.addEventListener('change', onRm); offs.push(() => rm.removeEventListener('change', onRm)); }
    } catch { /* no matchMedia */ }
    const timers = new Set();
    let alive = true;
    let raf = 0;
    const perf = () => performance.now();

    // ── match state: the host owns it, the guest mirrors the host's presence ──
    const mid = host ? Math.random().toString(36).slice(2, 9) : null;
    const saved = api.data() || {};
    let md = { ar: CHOICES.includes(saved.cycles_last) ? saved.cycles_last : 'classic', bo: saved.cycles_boosts === true };
    let matchAr = 'classic'; // the resolved choice for this match (a concrete arena, or 'rotate')
    let rotOrder = ARENAS.slice();
    let layout = null; // the layout the board is currently built for
    let cfg = null; // this round's config (layout, arena, seed, boosts, start variant, speed curve)
    let phase = 'pick'; // pick | count | run | end | over
    let round = 0;
    let cd = 0;
    let rw = null;
    let paused = false;
    let pz = 0; // why: 1 the host stepped away, 2 the guest did
    let overRes = null; // the match result, also in presence so a guest never misses its end card
    let finT = 0;
    let score = { a: 0, b: 0 };
    let sim = null;
    let entries = [];
    let encs = [];
    let cdStart = 0;
    let acc = 0;
    let endAt = 0;
    let endDue = 0;
    let goAt = 0;
    let crashAt = 0;
    let skipped = false;
    let skipAt = 0;
    let lastNow = 0;
    let rc = []; // record stamps earned by the round just ridden
    let lastDraw = false;
    let startReq = 0;
    let pickShown = false;
    const mountedAt = perf();
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
    let tdisp = 0; // guest: the display clock, in ticks (smoothed estimate of the host's clock, a little ahead of the confirmed tick)
    let clkOff = null; // guest: mean (arrival time - host time of that tick), ms: where the host's clock sits on ours
    let clkN = 0;
    let clkSeen = -1;
    let cum = [0]; // host time (ms since the first tick) at which tick k happened
    let seenTurns = 0;
    let gSim = null; // guest: the sim carried from one presence frame to the next
    let gSimCfg = null;
    let gSimRound = -1;
    let gSimI = 0;
    let gSimLast = null;
    const sameCfg = (x, y) => !!x && !!y && x.L === y.L && x.ar === y.ar && x.sd === y.sd && x.bo === y.bo && x.sv === y.sv && x.rm === y.rm;
    const sameEntry = (x, y) => !!x && !!y && x.t === y.t && x.p === y.p && x.d === y.d;
    // presentation
    let evSeen = 0;
    const fx = []; // sparks and rings
    let lastShake = 0;
    let capText = '';
    // render layers: bg (paper, grid, blocks), sh (trail shadow mask), cb (bg + shadow, the back of the board), tr (outline + ink)
    let bgCan = null; let shCan = null; let cbCan = null; let trCan = null;
    let bgG = null; let shG = null; let cbG = null; let trG = null;
    let bgVer = 1;
    let layerVer = 0;
    let lyAr = ''; let lySd = -1; let lyL = ''; let lyRound = -1;
    let lyS = 1; // device pixels per CSS pixel in the layers
    // partial repaint: a frame restores only the rectangles where something moved (last frame's and this frame's) from the layers
    const RECT_MAX = 48;
    const RC = new Float64Array(RECT_MAX * 4); // this frame's moving things, as grid-pixel rectangles x0 y0 x1 y1
    const RP = new Float64Array(RECT_MAX * 4); // last frame's
    let rcN = 0; let rpN = 0; let rcOver = false; let rpOver = false;
    let needFull = true; // the whole canvas must be painted (resized, new round, theme, replay, back from the background)
    let cRhas = false; let cR0 = 0; let cR1 = 0; let cR2 = 0; let cR3 = 0; // the part of the layers a tick just changed (grid px)
    const ci = { a: 0, b: 0 }; // path points already stroked into the layers
    let dirt = false; let dX0 = 0; let dY0 = 0; let dX1 = 0; let dY1 = 0;
    const inkPat = { a: null, b: null };
    let dprScale = 1;
    let slowEma = 16.7;
    let slowFor = 0;
    let posPending = false;
    let boardH = 0;
    const mkView = () => ({ i: 0, x: 0, y: 0, d: 0 });
    const rv = { a: mkView(), b: mkView() }; // raw rider views (where the sim says, interpolated)
    const vv = { a: mkView(), b: mkView() }; // drawn views: raw plus the fading correction
    const bl = { a: { x: 0, y: 0, lx: 0, ly: 0, has: false, r: -1 }, b: { x: 0, y: 0, lx: 0, ly: 0, has: false, r: -1 } };
    let vvReady = false;
    const LS = new Float64Array(20); // this frame's growing segments, per rider: start x y, corner x y, head x y, end heading x y, start heading x y
    if (!host) { const s0 = api.partnerState(); if (s0 && s0.ph === 'over') staleMid = s0.mid; }

    el.innerHTML = '<div class="g-cycles"><p class="cy-ready">Getting the grid ready…</p></div>';
    const root = el.firstElementChild;
    let canvas = null;
    let ctx = null;
    let board = null;
    let msgEl = null;
    let rpEl = null;
    let cssW = 0;
    let cssH = 0;
    let cell = 8;
    let gW = 0; // the grid's own size in px (cssW/cssH are the screen's: swapped when the board is turned a quarter)
    let gH = 0;
    let qr = 0; // how far this screen draws the agreed grid turned: 0 upright, 1 a quarter clockwise, 3 a quarter back
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
      bgVer++;
      if (pickShown) drawMinis();
    }
    readColors();
    const darkMq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
    const onScheme = () => readColors();
    if (darkMq && darkMq.addEventListener) { darkMq.addEventListener('change', onScheme); offs.push(() => darkMq.removeEventListener('change', onScheme)); }
    const mo = new MutationObserver(onScheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    offs.push(() => mo.disconnect());

    // ── sound: small WebAudio synths on top of the shared kit ──
    const lastSnd = {};
    function blip(name, freq, dur, type, vol, to, gap = 40) {
      if (api.muted()) return;
      const t0 = perf();
      if (t0 - (lastSnd[name] || -1e9) < gap) return;
      lastSnd[name] = t0;
      try {
        const ac = api.audio();
        if (!ac) return;
        const t = ac.currentTime + 0.002;
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
      } catch { /* no audio */ }
    }
    const cue = {
      turn: () => blip('turn', 980, 0.03, 'square', 0.05, 640, 25),
      turnThem: () => blip('turnT', 520, 0.03, 'square', 0.025, 380, 25),
      shave: () => blip('shave', 1500, 0.07, 'triangle', 0.05, 2300, 90),
      boost: () => blip('boost', 330, 0.22, 'sawtooth', 0.05, 1100, 120),
      jump: () => blip('jump', 420, 0.16, 'sine', 0.09, 900, 120),
      crash: () => blip('crash', 150, 0.34, 'sawtooth', 0.14, 38, 200),
    };

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
    // Mixed screens: the grid is agreed once, but each screen may draw it turned a quarter so it fills that screen (a phone on
    // its side showing the portrait grid, an upright phone showing the wide one). One device, one screen: never turned.
    function qrFor() {
      if (local || !layout || layout === 's' || pref === 's') return 0;
      if (layout === 'l' && pref === 'p') return 3; // the wide grid turned anticlockwise: you still start at the bottom
      if (layout === 'p' && pref === 'l') return 1; // the tall grid turned clockwise: you start on the left
      return 0;
    }
    function teardownBoard() {
      if (ro) { ro.disconnect(); ro = null; }
      canvas = ctx = board = msgEl = rpEl = null;
      needFull = true;
      bgCan = shCan = cbCan = trCan = null; bgG = shG = cbG = trG = null; layerVer = 0;
      vvReady = false;
    }
    function build() {
      teardownBoard();
      pickShown = false;
      qr = qrFor();
      const vl = qr === 3 ? 'p' : qr === 1 ? 'l' : layout; // the layout of this screen: where the pads sit, how big the banners are
      const wide = vl !== 'p';
      const boardHTML = '<div class="cy-board"><canvas aria-label="Light Cycles grid" role="img"></canvas><div class="cy-rp"><span class="cy-rp-tag">REPLAY</span><span class="cy-rp-skip">tap to skip</span><span class="cy-rp-cap"></span></div><div class="cy-msg" aria-live="polite"></div></div>';
      const info = '<div class="cy-info"><span class="cy-pips p-a"></span><span class="cy-round"></span><span class="cy-pips p-b"></span></div>';
      let html;
      root.dataset.ui = local ? `local-${touch ? 'touch' : 'keys'}-${vl}` : touch ? 'live-touch' : 'live-keys';
      if (local && touch && !wide) {
        html = `${padHTML('b', { rot: true, row: true })}<div class="cy-row">${boardHTML}</div>${info}${padHTML('a', { row: true })}`;
      } else if (local && touch) {
        html = `<div class="cy-row">${padHTML('a', { side: true })}${boardHTML}${padHTML('b', { side: true })}</div>${info}`;
      } else if (local && wide) {
        html = `<div class="cy-row">${legendHTML('a', 'starts left')}${boardHTML}${legendHTML('b', 'starts right')}</div>${info}`;
      } else if (local) {
        html = `<div class="cy-row">${boardHTML}</div>${info}<div class="cy-legends">${legendHTML('a', 'bottom')}${legendHTML('b', 'top')}</div>`;
      } else if (touch) {
        html = `<div class="cy-row">${boardHTML}</div>${info}${padHTML(me, { row: !wide && window.innerHeight < 720 })}`;
      } else {
        // live on a computer: from your own side you always start on the left (or at the bottom)
        const them = api.other(me);
        const [mine, theirs] = wide ? ['you start left', 'starts right'] : ['you start at the bottom', 'starts at the top'];
        html = `<div class="cy-row"><div class="cy-legend p-${me}"><span class="cy-legend-name">${esc(api.name(me))}</span>${capsWASD()}<span class="cy-or">or</span>${capsArrows()}<span class="cy-legend-tag">${mine}</span></div>${boardHTML}<div class="cy-legend is-them p-${them}"><span class="cy-legend-name">${esc(api.name(them))}</span><i class="cy-bike" aria-hidden="true"></i><span class="cy-legend-tag">${theirs}</span></div></div>${info}`;
      }
      root.innerHTML = html;
      root.dataset.layout = vl;
      canvas = root.querySelector('canvas');
      ctx = canvas.getContext('2d');
      board = root.querySelector('.cy-board');
      msgEl = root.querySelector('.cy-msg');
      rpEl = root.querySelector('.cy-rp');
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
      const bh = row.clientHeight - 12;
      boardH = board.clientHeight; // read before anything below is written
      const sw = qr & 1 ? g.H : g.W; // the board as this screen sees it, in cells
      const sh = qr & 1 ? g.W : g.H;
      const c = Math.max(3, Math.floor(Math.min(bw / sw, bh / sh) * 4) / 4);
      cell = c;
      gW = Math.round(c * g.W);
      gH = Math.round(c * g.H);
      cssW = qr & 1 ? gH : gW;
      cssH = qr & 1 ? gW : gH;
      dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1) * dprScale); // never above 2; the governor in frame() lowers it on a slow device
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      needFull = true;
      board.classList.add('is-fit');
      board.style.width = cssW + 14 + 'px';
      // the countdown and GO stamps scale with a small board
      root.style.setProperty('--cy-s', clamp(Math.round(Math.min(cssW, cssH) * 0.3), 44, 92) + 'px');
      bgVer++;
    }
    const modeLabel = () => `${ARENA_NAME[cfg && cfg.ar ? cfg.ar : matchAr] || ''}${md.bo ? ' + boosts' : ''}`;
    function renderInfo() {
      const r = root.querySelector('.cy-round');
      if (r) {
        const rot = matchAr === 'rotate' ? 'Rotate · ' : '';
        r.textContent = round ? `Round ${round} · ${rot}${modeLabel()}` : `Best of ${WIN_AT * 2 - 1}`;
      }
      for (const p of ['a', 'b']) {
        const pips = root.querySelector(`.cy-pips.p-${p}`);
        if (!pips) continue;
        const had = pips.children.length ? pips.querySelectorAll('i.on').length : score[p];
        pips.innerHTML = Array.from({ length: WIN_AT }, (_, i) => `<i class="${i < score[p] ? 'on' : ''}${i === score[p] - 1 && score[p] > had ? ' pulse' : ''}"></i>`).join('');
        pips.setAttribute('aria-label', `${api.name(p)}: ${score[p]} round${score[p] === 1 ? '' : 's'}`);
      }
      api.setScore(score);
      api.setStatus(phase === 'pick' ? (host ? 'Pick an arena' : null) : `Round ${round} · ${modeLabel()} · first to ${WIN_AT}`);
    }

    // ── the picker ──
    const recsLine = () => {
      const d = api.data() || {};
      const bits = [];
      if ((d.cy_streak_len | 0) >= 2 && (d.cy_streak_who === 'a' || d.cy_streak_who === 'b')) bits.push(`${api.name(d.cy_streak_who)} is on a ${d.cy_streak_len | 0}-match streak`);
      if (d.cy_long_n > 0) bits.push(`longest ride ${d.cy_long_n} ticks`);
      if (d.cy_shaves_n > 0) bits.push(`most close shaves ${d.cy_shaves_n}`);
      return bits.length ? bits.join(' · ') : 'First to 3 rounds takes the match.';
    };
    function showPicker() {
      teardownBoard();
      layout = null;
      pickShown = true;
      root.dataset.ui = 'pick';
      root.dataset.layout = '';
      const wideMini = pref !== 'p';
      const chip = (id) => {
        const art = ARENAS.includes(id)
          ? `<canvas class="cy-mini${wideMini ? ' is-wide' : ''}" data-mini="${id}"></canvas>`
          : `<span class="cy-glyph" aria-hidden="true">${id === 'rotate' ? SPIN : '?'}</span>`;
        return `<button type="button" class="cy-chip" role="radio" aria-checked="${md.ar === id}" data-arena="${id}">${art}<span>${ARENA_NAME[id]}</span></button>`;
      };
      root.innerHTML = `<section class="cy-pick${host ? '' : ' is-ro'}" aria-label="Pick an arena">
        <h2 class="cy-pick-t">${host ? 'Pick an arena' : `${esc(api.name('a'))} is picking…`}</h2>
        <p class="cy-pick-sub"></p>
        <div class="cy-chips" role="radiogroup" aria-label="Arena">${CHOICES.map(chip).join('')}
          <button type="button" class="cy-chip cy-boost" role="switch" aria-checked="${md.bo}" data-boost="1"><span class="cy-glyph" aria-hidden="true">${BOLT}</span><span>Boosts</span><span class="cy-on"></span></button>
        </div>
        ${host ? '<button type="button" class="gm-btn gm-btn-big cy-go">GO</button>' : ''}
        <p class="cy-recs">${esc(recsLine())}</p>
      </section>`;
      if (host) {
        root.querySelectorAll('.cy-chip[data-arena]').forEach((b) => b.addEventListener('click', () => pickArena(b.dataset.arena)));
        root.querySelector('.cy-boost').addEventListener('click', () => pickBoost(!md.bo));
        root.querySelector('.cy-go').addEventListener('click', () => go());
      }
      paintPicker();
      drawMinis();
      renderInfo();
    }
    function paintPicker() {
      root.querySelectorAll('.cy-chip[data-arena]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.arena === md.ar)));
      const bo = root.querySelector('.cy-boost');
      if (bo) { bo.setAttribute('aria-checked', String(md.bo)); bo.querySelector('.cy-on').textContent = md.bo ? 'ON' : 'OFF'; }
      const sub = root.querySelector('.cy-pick-sub');
      if (sub) sub.textContent = `${ARENA_BLURB[md.ar] || ''}${md.bo ? ' Boost and jump tokens on the grid.' : ''}`;
    }
    function drawMinis() {
      root.querySelectorAll('canvas[data-mini]').forEach((cv) => {
        const L = pref;
        const { W, H, occ } = arenaBlocks(L, cv.dataset.mini, 7);
        const k = 2;
        cv.width = W * k; cv.height = H * k;
        const g = cv.getContext('2d');
        g.fillStyle = C.card; g.fillRect(0, 0, cv.width, cv.height);
        g.fillStyle = C.ink;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (occ[y * W + x] === 3) g.fillRect(x * k, y * k, k, k);
        for (const p of ['a', 'b']) {
          const [x, y] = LAYOUTS[L][p];
          g.fillStyle = C[p];
          g.fillRect((x - 1) * k, (y - 1) * k, k * 3, k * 3);
        }
      });
    }
    function pickArena(id) {
      if (!host || phase !== 'pick' || !CHOICES.includes(id)) return;
      md.ar = id;
      api.sfx('tap');
      paintPicker();
      publish();
    }
    function pickBoost(on) {
      if (!host || phase !== 'pick') return;
      md.bo = !!on;
      api.sfx('tap');
      paintPicker();
      publish();
    }
    function go(opts) {
      if (!host || phase !== 'pick' || startReq) return;
      if (opts) {
        if (opts.ar && CHOICES.includes(opts.ar)) md.ar = opts.ar;
        if (opts.boosts != null) md.bo = !!opts.boosts;
      }
      startReq = perf();
      api.sfx('pop');
    }

    // ── input ──
    const active = () => (phase === 'count' || phase === 'run') && !paused;
    function input(p, d) {
      if (!active() || !sim) return;
      if (host) {
        const q = queues[p];
        if (q.length >= 3 || !sim[p].alive) return;
        q.push({ seq: 0, d });
        cue.turn();
        turnFx(p);
      } else guestTurn(d);
    }
    /** A small ink ring at the head the instant a turn is taken: the input is felt before the next tick shows it. */
    function turnFx(p) {
      if (reduce || !vvReady) return;
      const v = vv[p];
      fx.push({ k: 'tap', x: v.x, y: v.y, t0: perf(), p });
    }
    function guestTurn(d) {
      if (!hostMid || !sim[me].alive) return;
      const cur = pending.length ? pending[pending.length - 1].d : sim[me].d;
      if (!okTurn(cur, d)) return;
      const e = { seq: ++seq, r: round, d };
      pending.push(e);
      if (pending.length > 12) pending.shift();
      cue.turn();
      turnFx(me);
      api.send('turn', { m: hostMid, g: gid, s: e.seq, r: e.r, d });
      publishGuest();
    }
    // screen direction -> world direction for a player (rot: that player's pad is upside down)
    const world = (d, rot) => (d + 4 - qr + (rot ? 2 : 0) + (flip ? 2 : 0)) & 3;
    function flashEl(k, ms = 120) {
      if (!k) return;
      k.classList.add('is-down');
      const t = setTimeout(() => { timers.delete(t); k.classList.remove('is-down'); }, ms);
      timers.add(t);
    }
    const flash = (sel) => flashEl(root.querySelector(sel));
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (phase === 'pick') {
        if (host && e.key === 'Enter' && !e.repeat && !(e.target && e.target.closest && e.target.closest('button'))) { e.preventDefault(); go(); }
        return;
      }
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
    let rootWired = false;
    function wireInputs() {
      const press = (b) => {
        const p = b.dataset.p;
        const d = world(+b.dataset.d, b.dataset.rot === '1');
        input(local ? p : me, d);
        api.haptic(8);
      };
      if (!rootWired) { // the root outlives every rebuild of the board: wire it once
        rootWired = true;
        root.addEventListener('pointerdown', (e) => {
          const b = e.target.closest('.cy-key');
          if (b) { e.preventDefault(); flashEl(b, 130); press(b); } // pressed in this very frame, then the turn
        });
        root.addEventListener('click', (e) => { const b = e.target.closest('.cy-key'); if (b && e.detail === 0) press(b); });
      }
      board.addEventListener('pointerdown', (e) => {
        if (endStage(perf()) === 'hit' || endStage(perf()) === 'replay') { skipReplay(); return; }
        const r = canvas.getBoundingClientRect();
        swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, top: e.clientY < r.top + r.height / 2, left: e.clientX < r.left + r.width / 2 };
        try { board.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      });
      board.addEventListener('pointermove', (e) => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (Math.hypot(dx, dy) < 14) return;
        // the swipe follows the finger on screen
        const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
        swipe.x = e.clientX; swipe.y = e.clientY;
        if (!local) { input(me, world(d, false)); return; }
        // one device: the half you swipe on is whose bike turns (top half in portrait, left half on its side)
        if (layout === 'p') input(swipe.top ? 'b' : 'a', d); else input(swipe.left ? 'a' : 'b', d);
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
      api.setPresence({
        v: 2, mid, ph: phase, r: round, cd, t: sim ? sim.t : 0, lg, lo, sc: [score.a, score.b], rw, cfg, md: { ar: phase === 'pick' ? md.ar : matchAr, bo: md.bo ? 1 : 0 },
        g: curG, rx: rxB, dn: dnB, pz: paused ? pz || 1 : 0, res: overRes, rc,
      });
    }
    function randSeed() { return Math.floor(Math.random() * 2147483647); }
    function beginMatch(now) {
      let ar = md.ar;
      try { api.setData({ cycles_last: md.ar, cycles_boosts: !!md.bo }); } catch { /* ignore */ }
      if (ar === 'surprise') ar = ARENAS[Math.floor(Math.random() * ARENAS.length)];
      matchAr = ar;
      base = { ...(api.data() || {}) };
      rotOrder = ARENAS.slice().sort(() => Math.random() - 0.5);
      startRound(now);
    }
    function startRound(now) {
      round++;
      const ar = matchAr === 'rotate' ? rotOrder[(round - 1) % rotOrder.length] : matchAr;
      let L = pref;
      if (!local) { const ps = api.partnerState(); const gp = ps && (ps.pref === 'p' || ps.pref === 's' || ps.pref === 'l') ? ps.pref : null; L = pickLayout(pref, gp || pref); }
      // Classic keeps today's fixed starts; after a draw (and in every other arena) the start is a seeded, symmetric stagger
      const sv = ar === 'classic' && !lastDraw ? 0 : 1 + Math.floor(Math.random() * 1000000);
      cfg = { L, ar, sd: randSeed(), bo: md.bo ? 1 : 0, sv, rm: ar === 'classic' ? 'c' : 'r' };
      lastDraw = false;
      sim = newSim(cfg);
      entries = []; encs = [];
      queues.a = []; queues.b = [];
      dnB = rxB;
      rw = null; crashAt = 0; skipped = false; rc = [];
      evSeen = 0; fx.length = 0; capText = '';
      acc = 0;
      phase = 'count'; cdStart = now; cd = 3;
      if (layout !== L || !canvas) { layout = L; build(); }
      api.sfx('tick');
      publish(); renderInfo();
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
      for (const p of ['a', 'b']) {
        if (turns[p] == null) continue;
        const e = { t, p, d: turns[p] };
        entries.push(e); encs.push(enc(e));
        if (!local && p !== me) cue.turnThem();
      }
      step(sim, turns);
      processEvents();
      if (sim.done) roundOver(now);
      publish();
    }
    // A record is only "new" if it beat one that stood before this match began: what the match itself set a round ago doesn't count.
    let base = null;
    function bump(patch, key, val, who, tag, label) {
      const d = api.data() || {};
      if (!base) base = { ...d };
      const prev = +d[key] || 0;
      if (val > prev) {
        patch[key] = val;
        if (who != null) patch[key.replace(/_n$/, '_who')] = who;
        if ((+base[key] || 0) > 0) { rc.push(tag); matchRecs.push(label); }
      }
    }
    const matchRecs = [];
    function roundOver(now) {
      phase = 'end'; endAt = now; crashAt = now; endDue = now + END_TOTAL; rw = sim.out;
      if (rw === 'a' || rw === 'b') score[rw]++; else lastDraw = true;
      const patch = {};
      const shaves = sim.a.sh + sim.b.sh;
      const sw = sim.a.sh === sim.b.sh ? (rw === 'a' || rw === 'b' ? rw : 'd') : sim.a.sh > sim.b.sh ? 'a' : 'b';
      bump(patch, 'cy_long_n', sim.t, rw === 'a' || rw === 'b' ? rw : 'd', 'long', `longest ride ${sim.t} ticks`);
      bump(patch, 'cy_shaves_n', shaves, sw, 'shaves', `${shaves} close shaves in a round`);
      if (Object.keys(patch).length) { try { api.setData(patch); } catch { /* ignore */ } }
      cue.crash(); api.haptic(40);
      renderInfo();
      shake();
    }
    function nextRound(now) {
      const done = score.a >= WIN_AT || score.b >= WIN_AT || round >= MAX_ROUNDS;
      if (!done) { startRound(now); return; }
      phase = 'over';
      const w = score.a > score.b ? 'a' : score.b > score.a ? 'b' : null;
      const hi = Math.max(score.a, score.b);
      const lo = Math.min(score.a, score.b);
      const d = api.data() || {};
      const patch = {};
      const bits = [];
      if (w) {
        const o = w === 'a' ? 'b' : 'a';
        const prevLen = d.cy_streak_who === o ? d.cy_streak_len | 0 : 0;
        const n = d.cy_streak_who === w ? (d.cy_streak_len | 0) + 1 : 1;
        patch.cy_streak_who = w; patch.cy_streak_len = n;
        if (n > (d.cy_beststreak_n | 0)) { patch.cy_beststreak_n = n; patch.cy_beststreak_who = w; }
        patch[`cy_wins_${w}_n`] = (d[`cy_wins_${w}_n`] | 0) + 1;
        if (lo === 0 && hi >= WIN_AT) { patch[`cy_flawless_${w}_n`] = (d[`cy_flawless_${w}_n`] | 0) + 1; bits.push(`flawless ${hi}–0`); }
        if (hi < WIN_AT) bits.unshift(`won on points after ${round} rounds`);
        if (n >= 2) bits.unshift(`${api.name(w)} on a ${n}-match streak`);
        else if (prevLen >= 2) bits.unshift(`${api.name(w)} ends ${api.name(o)}'s ${prevLen}-match streak`);
        bits.push(...matchRecs.slice(-1).map((x) => `new record: ${x}`));
        const wa = patch.cy_wins_a_n != null ? patch.cy_wins_a_n : d.cy_wins_a_n | 0;
        const wb = patch.cy_wins_b_n != null ? patch.cy_wins_b_n : d.cy_wins_b_n | 0;
        bits.push(wa === wb ? `matches level at ${wa}–${wb}` : `${api.name(wa > wb ? 'a' : 'b')} leads ${Math.max(wa, wb)}–${Math.min(wa, wb)}`);
      } else { patch.cy_streak_who = ''; patch.cy_streak_len = 0; }
      try { api.setData(patch); } catch { /* ignore */ }
      overRes = w
        ? { winner: w, text: `${api.name(w)} wins ${hi}–${lo}`, sub: bits.slice(0, 3).join(' · ') }
        : { winner: null, text: `Dead heat ${hi}–${lo}`, sub: `${round} rounds and nobody blinked.` };
      publish();
      api.finish(overRes);
    }
    /** Host, fresh mount: the guest remembers the match we were in the middle of. */
    function adoptMatch(ps) {
      if (!ps || ps.v !== 2 || typeof ps.hm !== 'string' || ps.hm === mid || ps.hph === 'over' || !Array.isArray(ps.hsc)) return false;
      const a0 = Math.max(0, ps.hsc[0] | 0); const b0 = Math.max(0, ps.hsc[1] | 0);
      if (!(a0 + b0) || a0 >= WIN_AT || b0 >= WIN_AT) return false;
      score = { a: a0, b: b0 };
      // a round that was still being ridden is ridden again; a decided one counts
      round = Math.max(0, Math.min(MAX_ROUNDS - 1, (ps.hr | 0) - (ps.hph === 'end' ? 0 : 1)));
      if (ps.hmd && (ARENAS.includes(ps.hmd.ar) || ps.hmd.ar === 'rotate')) { md = { ar: ps.hmd.ar, bo: !!ps.hmd.bo }; }
      return true;
    }
    function recvB(m, g, s, r, d) {
      if (m !== mid || !g) return;
      if (g !== curG) { curG = g; rxB = 0; dnB = 0; bufB.clear(); gapSince = 0; queues.b = []; }
      if (!Number.isInteger(s) || s <= rxB || bufB.has(s) || !(d >= 0 && d <= 3)) return;
      bufB.set(s, { r, d });
      if (!gapSince) gapSince = perf();
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
      if (phase === 'pick') {
        if (!pickShown) {
          if (!local && now - mountedAt < 700 && !api.partnerState()) return;
          if (!local && adoptMatch(api.partnerState())) { matchAr = md.ar; rotOrder = ARENAS.slice(); startRound(now); return; }
          showPicker();
          publish();
        }
        if (!local && now - mountedAt < 1500 && adoptMatch(api.partnerState())) { matchAr = md.ar; rotOrder = ARENAS.slice(); startRound(now); return; }
        if (startReq) {
          const ps = local ? null : api.partnerState();
          const gp = ps && (ps.pref === 'p' || ps.pref === 's' || ps.pref === 'l') ? ps.pref : null;
          if (local || gp || now - startReq > 1500) beginMatch(now);
        }
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
        while (phase === 'run' && acc >= tickMs(cfg, sim.t) && n < 4) { acc -= tickMs(cfg, sim.t); hostTick(now); n++; }
        if (n >= 4) acc = 0;
      } else if (phase === 'end' && now >= endDue) nextRound(now);
    }

    // ── guest ──
    // keep: the host's match as last seen, mirrored in our presence so a host that reloads or
    // reopens the game mid-match carries on from the same score instead of restarting.
    let keep = null; // { mid, sc: [a, b], r, ph, md }
    function publishGuest() {
      api.setPresence({
        v: 2, pref, mid: hostMid, g: gid, q: pending.filter((p) => p.seq > gRx).slice(-12).map((p) => [p.seq, p.r, p.d]),
        hid: document.hidden ? 1 : 0, ...(keep ? { hm: keep.mid, hsc: keep.sc, hr: keep.r, hph: keep.ph, hmd: keep.md } : {}),
      });
    }
    function onHost(s) {
      if (!alive || !s || s.v !== 2 || !s.mid || s.mid === staleMid) return;
      if (s.mid !== hostMid) { hostMid = s.mid; seq = 0; pending = []; gRx = 0; gEntries = []; gRound = 0; lastPh = null; gSim = null; }
      if (s.md && CHOICES.concat(['rotate']).includes(s.md.ar)) md = { ar: s.md.ar, bo: !!s.md.bo };
      if (s.ph === 'pick') {
        phase = 'pick'; round = 0; paused = false;
        if (!pickShown) showPicker(); else paintPicker();
        lastPh = 'pick';
        return;
      }
      if (!s.cfg) return;
      const now = perf();
      if (s.r !== gRound) { gRound = s.r; gEntries = []; crashAt = 0; skipped = false; evSeen = 0; fx.length = 0; capText = ''; seenTurns = 0; tdisp = 0; clkReset(); gSim = null; pending = pending.filter((p) => p.r === s.r); }
      cfg = s.cfg;
      matchAr = md.ar;
      if (!canvas || layout !== cfg.L) { layout = cfg.L; build(); }
      const part = decode(s.lg);
      if (!s.lo) gEntries = part; else part.forEach((e, i) => { gEntries[s.lo + i] = e; });
      if (s.ph === 'count' && s.cd !== cd && !s.pz) api.sfx('tick');
      if (s.ph === 'run' && lastPh !== 'run') { goAt = now; clkReset(); api.sfx('pop'); }
      phase = s.ph; round = s.r; cd = s.cd; rw = s.rw; paused = !!s.pz; pz = s.pz | 0; rc = Array.isArray(s.rc) ? s.rc : [];
      lastPh = s.ph;
      const sc = Array.isArray(s.sc) ? s.sc : [0, 0];
      const infoKey = `${round}|${phase}|${sc[0]}|${sc[1]}`;
      score = { a: sc[0] | 0, b: sc[1] | 0 };
      // carry the sim on from where the last presence frame left it (the host's log only ever grows); a new round, a changed
      // config or a log that no longer starts the same way is rebuilt from scratch
      const ents = gEntries.filter(Boolean);
      const T = s.t | 0;
      if (gSim && gSimRound === s.r && sameCfg(gSimCfg, cfg) && T >= gSim.t && gSimI <= ents.length && (gSimI === 0 || sameEntry(ents[gSimI - 1], gSimLast))) {
        gSimI = advance(gSim, ents, T, gSimI);
      } else {
        gSim = newSim(cfg); gSimCfg = cfg; gSimRound = s.r;
        gSimI = advance(gSim, ents, T, 0);
      }
      gSimLast = gSimI ? ents[gSimI - 1] : null;
      sim = gSim;
      if (s.ph === 'run' && !s.pz && sim.t > 0 && sim.t !== clkSeen) clkSample(now);
      clkSeen = sim.t;
      processEvents();
      const theirs = gEntries.filter((e) => e && e.p !== me).length;
      if (theirs > seenTurns) { if (seenTurns || theirs === 1) cue.turnThem(); seenTurns = theirs; }
      if (sim.done && !crashAt) { crashAt = now; cue.crash(); api.haptic(40); shake(); }
      const mine = s.g === gid; // acks are for this guest session only
      pending = pending.filter((p) => p.r === round && !(mine && p.seq <= (s.dn | 0)));
      if (mine && (s.rx | 0) !== gRx) { gRx = s.rx | 0; publishGuest(); }
      if (infoKey !== lastInfo) {
        renderInfo();
        lastInfo = infoKey;
        // a fresh host mount (new id, earlier round) hasn't picked our score up yet: keep reporting it
        if (!keep || s.mid === keep.mid || round >= keep.r || s.ph === 'over') { keep = { mid: s.mid, sc: [score.a, score.b], r: round, ph: s.res ? 'over' : phase, md: { ar: md.ar, bo: md.bo ? 1 : 0 } }; publishGuest(); }
      }
      // the engine's end-card event can drop: the host's presence carries the result as well
      if (s.ph === 'over' && s.res && !finT) { finT = setTimeout(() => { timers.delete(finT); api.finish(s.res); }, 1500); timers.add(finT); }
    }

    // ── effects fed by the simulation (the same on every device) ──
    function processEvents() {
      if (!sim) return;
      const now = perf();
      for (; evSeen < sim.ev.length; evSeen++) {
        const e = sim.ev[evSeen];
        if (sim.t - e.t > 4) continue; // joined late: don't replay old sparks
        const mineOrLocal = local || e.p === me;
        if (e.k === 'shave') { fx.push({ k: 'spark', x: e.x, y: e.y, t0: now, p: e.p }); if (mineOrLocal) cue.shave(); } else if (e.k === 'pick') {
          fx.push({ k: 'ring', x: e.x, y: e.y, t0: now, p: e.p, tk: e.tk });
          if (mineOrLocal) (e.tk === 1 ? cue.boost : cue.jump)();
        } else if (e.k === 'hop') { fx.push({ k: 'ring', x: e.x, y: e.y, t0: now, p: e.p, tk: 3 }); if (mineOrLocal) cue.jump(); }
      }
    }
    const SHAKE = [
      { transform: 'translate(0,0)' }, { transform: 'translate(-3px,1.5px)', offset: 0.18 }, { transform: 'translate(3px,-2px)', offset: 0.38 },
      { transform: 'translate(-2px,-1.5px)', offset: 0.58 }, { transform: 'translate(1.5px,1px)', offset: 0.8 }, { transform: 'translate(0,0)' },
    ];
    function shake() {
      if (reduce || !board) return;
      const now = perf();
      if (now - lastShake < 400) return;
      lastShake = now;
      if (board.animate) { try { board.animate(SHAKE, { duration: 260, easing: 'linear' }); } catch { /* no animation */ } } // transform only: no layout, no reflow trick
    }

    // ── end of a round: the crash, a zoomed replay, then the banner ──
    function endStage(now) {
      if (!sim || !sim.done || !crashAt) return 'none';
      const e = now - crashAt;
      if (!skipped && e < HOLD_MS) return 'hit';
      if (!skipped && e < HOLD_MS + REPLAY_MS) return 'replay';
      return 'banner';
    }
    function skipReplay() {
      if (skipped) return;
      skipped = true; skipAt = perf();
      if (local && phase === 'end') endDue = Math.min(endDue, skipAt + BANNER_MS);
    }
    const CF = [0, 0];
    const CFXY = [0, 0];
    function crashFocus() { // returns a shared pair: read it before the next call
      const loser = rw === 'a' ? 'b' : rw === 'b' ? 'a' : 'a';
      const cr = sim[loser].crash || sim.a.crash || sim.b.crash || CF;
      CFXY[0] = clamp(cr[0], 0, sim.W - 1); CFXY[1] = clamp(cr[1], 0, sim.H - 1);
      return CFXY;
    }
    function captionOf() {
      const nm = (p) => esc(api.name(p));
      if (rw === 'a' || rw === 'b') {
        const lo = rw === 'a' ? 'b' : 'a';
        const ck = sim[lo].ck;
        if (ck === 'squeeze') return `${nm(lo)} squeezed by 1 cell`;
        if (ck === 'trail') return `${nm(lo)} ran into a wall of light`;
        if (ck === 'self') return `${nm(lo)} tangled in their own trail`;
        if (ck === 'block') return `${nm(lo)} hit a block`;
        return `${nm(lo)} ran out of road`;
      }
      return sim.a.ck === 'head' && sim.b.ck === 'head' && sim.a.crash && sim.b.crash && sim.a.crash[0] === sim.b.crash[0] && sim.a.crash[1] === sim.b.crash[1] ? 'Head-on, same cell' : 'Both riders crashed';
    }

    // ── the guest's clock ──
    // Presence frames arrive late and unevenly. The guest keeps the mean offset between the host's tick times and its own
    // arrival times, reads "where the host is now" off that, and moves its display clock toward it by speeding up or slowing
    // down a little (never a step), so heads keep a steady pace however the frames arrive.
    function clkReset() { clkOff = null; clkN = 0; clkSeen = -1; cum = [0]; }
    function cumTo(k) { while (cum.length <= k) { const j = cum.length - 1; cum.push(cum[j] + tickMs(cfg, j)); } }
    function clkSample(now) {
      cumTo(sim.t);
      const smp = now - cum[sim.t];
      clkN++;
      clkOff = clkOff == null ? smp : clkOff + (smp - clkOff) * Math.max(0.07, 1 / clkN);
    }
    function hostTicksAt(ms) {
      if (ms <= 0) return 0;
      cumTo(sim.t);
      let k = sim.t;
      if (ms >= cum[k]) return k + (ms - cum[k]) / tickMs(cfg, k);
      while (k > 0 && cum[k] > ms) k--;
      return k + (ms - cum[k]) / tickMs(cfg, k);
    }
    function stepClock(now, dt) {
      if (!sim || !cfg) return;
      if (phase === 'run' && !paused && !sim.done && clkOff != null) {
        const tgt = hostTicksAt(now - clkOff) + OWN_AHEAD;
        const e = tgt - tdisp;
        if (Math.abs(e) > 4 || tdisp < sim.t) tdisp = Math.max(tgt, sim.t);
        else tdisp += (dt / tickMs(cfg, sim.t)) * clamp(1 + 0.5 * e, 0.3, 2);
      } else tdisp = sim.t;
    }

    // ── per-frame rider views ──
    function aheadFree(x, y, d, n) {
      let ok = 0;
      for (let k = 1; k <= n; k++) {
        const X = x + DX[d] * k;
        const Y = y + DY[d] * k;
        if (X < 0 || Y < 0 || X >= sim.W || Y >= sim.H || sim.occ[Y * sim.W + X] !== 0) break;
        ok = k;
      }
      return ok;
    }
    /** The head drawn `ext` cells past the last confirmed cell, heading d (the predicted segment). Fills o. */
    function extended(o, p, d, ext) {
      const c = sim[p];
      pathAt(sim, p, sim.t, o);
      const n = Math.min(ext, aheadFree(o.x, o.y, d, c.boost > 0 ? 2 : 1));
      o.x += DX[d] * n; o.y += DY[d] * n; o.d = d;
      return o;
    }
    /** Guest: its own head, turned at once on a pending turn, stepping on with the display clock. */
    function ownRaw(o, running) {
      const c = sim[me];
      const d = pending.length && okTurn(c.d, pending[pending.length - 1].d) ? pending[pending.length - 1].d : c.d;
      const ext = running ? clamp(tdisp - sim.t, 0, EXT_CAP) * (c.boost > 0 ? 2 : 1) : 0;
      return extended(o, me, d, ext);
    }
    /** Where the sim says rider p is right now. Fills rv[p]. */
    function rawView(p) {
      const o = rv[p];
      const c = sim[p];
      if (!c.alive || sim.done) return pathAt(sim, p, sim.t, o);
      const running = phase === 'run' && !paused;
      if (host) {
        const q = queues[p];
        let d = c.d;
        for (let i = 0; i < q.length; i++) if (!q[i].stale && okTurn(c.d, q[i].d)) { d = q[i].d; break; }
        const ext = running ? clamp(acc / tickMs(cfg, sim.t), 0, 1) * (c.boost > 0 ? 2 : 1) : 0;
        return extended(o, p, d, ext);
      }
      if (p === me) return ownRaw(o, running);
      if (!running) return pathAt(sim, p, sim.t, o);
      // the opponent: entity interpolation, a little behind the clock, between cells the log already confirms; if a frame is
      // late the head runs on briefly (capped), and the correction when it lands is blended away
      const T = tdisp - OPP_GAP;
      if (T < sim.t) return pathAt(sim, p, Math.max(0, T), o);
      return extended(o, p, c.d, Math.min(T - sim.t, 1) * (c.boost > 0 ? 2 : 1));
    }
    /** Every drawn head = the sim's head + a correction that fades out (a late frame, a turn the prediction missed by a cell):
     *  the jump beyond what steady riding covers in this frame is moved into the offset, which then decays in ~100 ms. */
    function updateViews(dt) {
      if (!sim || !cfg) { vvReady = false; return; }
      for (let n = 0; n < 2; n++) {
        const p = PL[n];
        const r = rawView(p);
        const b = bl[p];
        const o = vv[p];
        if (phase === 'pick') { b.x = 0; b.y = 0; b.has = false; }
        if (b.has && b.r === round) {
          const jx = r.x - b.lx;
          const jy = r.y - b.ly;
          const m = Math.hypot(jx, jy);
          const move = (dt / tickMs(cfg, sim.t)) * (sim[p].boost > 0 ? 2 : 1); // what steady riding covers in this frame
          if (m > move + 0.3 && m < 3.2) { const k = 1 - move / m; b.x -= jx * k; b.y -= jy * k; } else if (m >= 3.2) { b.x = 0; b.y = 0; }
        } else { b.x = 0; b.y = 0; }
        b.lx = r.x; b.ly = r.y; b.has = true; b.r = round;
        if (b.x || b.y) {
          // fade out exponentially, but never faster than BLEND_RATE cells a millisecond, so a long frame doesn't turn the fade into a pop
          const mag = Math.hypot(b.x, b.y);
          const f = reduce ? 0 : 1 - Math.min(mag * (1 - Math.exp(-dt / TAU_BLEND)), BLEND_RATE * dt) / mag;
          b.x *= f; b.y *= f;
          if (Math.abs(b.x) < 0.01 && Math.abs(b.y) < 0.01) { b.x = 0; b.y = 0; }
        }
        o.i = r.i; o.d = r.d; o.x = r.x + b.x; o.y = r.y + b.y;
      }
      vvReady = true;
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
    function trace(c, v) {
      const P = c.path;
      const k = cell;
      ctx.beginPath();
      ctx.moveTo((P[0] + 0.5) * k, (P[1] + 0.5) * k);
      for (let i = 1; i <= v.i; i++) ctx.lineTo((P[2 * i] + 0.5) * k, (P[2 * i + 1] + 0.5) * k);
      ctx.lineTo((v.x + 0.5) * k + (v.i === 0 && v.x === P[0] && v.y === P[1] ? 0.01 : 0), (v.y + 0.5) * k);
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
    // the hard shadow falls down-right on screen, whichever way the board is turned
    const shadowSign = () => SHADOW_SIGN[(qr + (flip ? 2 : 0)) & 3];
    function drawBgVector(g2, c, W, H, S) {
      // graph-paper grid, a heavier line every 8 cells from the centre
      g2.lineWidth = 1;
      g2.strokeStyle = C.line;
      g2.globalAlpha = C.dark ? 0.55 : 0.75;
      g2.beginPath();
      for (let x = 1; x < W; x++) { const X = Math.round(x * c) + 0.5; g2.moveTo(X, 0); g2.lineTo(X, H * c); }
      for (let y = 1; y < H; y++) { const Y = Math.round(y * c) + 0.5; g2.moveTo(0, Y); g2.lineTo(W * c, Y); }
      g2.stroke();
      // registration marks every 8 cells out from the centre, like a printed board
      g2.globalAlpha = C.dark ? 0.7 : 0.45;
      g2.strokeStyle = C.muted;
      g2.lineWidth = Math.max(1, c * 0.12);
      g2.beginPath();
      const cx0 = (W - 1) / 2;
      const cy0 = (H - 1) / 2;
      const m = c * 0.42;
      for (let x = cx0 % 8; x < W; x += 8) {
        for (let y = cy0 % 8; y < H; y += 8) {
          const X = (x + 0.5) * c;
          const Y = (y + 0.5) * c;
          g2.moveTo(X - m, Y); g2.lineTo(X + m, Y); g2.moveTo(X, Y - m); g2.lineTo(X, Y + m);
        }
      }
      g2.stroke();
      g2.globalAlpha = 1;
      // arena blocks: printed ink squares with a paper rule inside, and the same hard shadow as the trails
      const occ = S.occ;
      const sg = shadowSign();
      const ssx = sg[0];
      const ssy = sg[1];
      const sh = Math.max(1, c * 0.2);
      let any = false;
      for (let i = 0; i < occ.length; i++) if (occ[i] === 3) { any = true; break; }
      if (!any) return;
      g2.fillStyle = C.edge;
      g2.globalAlpha = C.dark ? 0.9 : 0.28;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (occ[y * W + x] === 3) g2.fillRect(x * c + sh * ssx, y * c + sh * ssy, c, c);
      g2.globalAlpha = 1;
      g2.fillStyle = C.ink;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (occ[y * W + x] === 3) g2.fillRect(x * c, y * c, c + 0.5, c + 0.5);
      if (c >= 5) {
        g2.strokeStyle = C.card;
        g2.globalAlpha = 0.3;
        g2.lineWidth = Math.max(1, c * 0.1);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (occ[y * W + x] === 3) g2.strokeRect(x * c + c * 0.22, y * c + c * 0.22, c * 0.56, c * 0.56);
        g2.globalAlpha = 1;
      }
    }

    // ── the persistent layers ──
    // bg: paper tooth, grid, registration marks, blocks. sh: the trails' shadow, opaque (so overlaps never double up).
    // cb: bg + sh, the back of the board; only a small dirty rectangle of it is repainted when a tick adds trail.
    // tr: the trails' outline and ink on a transparent layer, stroked segment by segment as the riders move on.
    function ensureCanvases() {
      // the layers are the grid at the screen canvas's own pixel density, so a layer pixel is exactly one canvas pixel (a quarter turn swaps the axes)
      const W = Math.max(1, qr & 1 ? canvas.height : canvas.width);
      const H = Math.max(1, qr & 1 ? canvas.width : canvas.height);
      if (!bgCan) {
        bgCan = document.createElement('canvas'); shCan = document.createElement('canvas'); cbCan = document.createElement('canvas'); trCan = document.createElement('canvas');
        bgG = bgCan.getContext('2d'); shG = shCan.getContext('2d'); cbG = cbCan.getContext('2d'); trG = trCan.getContext('2d');
      }
      for (const cv of [bgCan, shCan, cbCan, trCan]) if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      lyS = W / gW;
    }
    /** Copy one grid-pixel rectangle of a layer onto the screen canvas, on whole canvas pixels so repeated blits leave no seams. */
    function blit(layer, x0, y0, x1, y1) {
      const sx = Math.max(0, Math.floor(x0 * lyS));
      const sy = Math.max(0, Math.floor(y0 * lyS));
      const ex = Math.min(layer.width, Math.ceil(x1 * lyS));
      const ey = Math.min(layer.height, Math.ceil(y1 * lyS));
      if (ex <= sx || ey <= sy) return;
      ctx.drawImage(layer, sx, sy, ex - sx, ey - sy, sx / lyS, sy / lyS, (ex - sx) / lyS, (ey - sy) / lyS);
    }
    function restoreFrom(layer) {
      for (let i = 0; i < rpN; i++) {
        const o = 4 * i;
        // a rectangle that did not move (a token) is restored once, as this frame's
        if (i < rcN && RP[o] === RC[o] && RP[o + 1] === RC[o + 1] && RP[o + 2] === RC[o + 2] && RP[o + 3] === RC[o + 3]) continue;
        blit(layer, RP[o], RP[o + 1], RP[o + 2], RP[o + 3]);
      }
      for (let i = 0; i < rcN; i++) blit(layer, RC[4 * i], RC[4 * i + 1], RC[4 * i + 2], RC[4 * i + 3]);
      if (cRhas) blit(layer, cR0, cR1, cR2, cR3);
    }
    function addRect(x0, y0, x1, y1) {
      if (rcN >= RECT_MAX) { rcOver = true; return; }
      const o = rcN * 4;
      RC[o] = x0; RC[o + 1] = y0; RC[o + 2] = x1; RC[o + 3] = y1;
      rcN++;
    }
    /** Everything the frame draws on top of the layers, as rectangles: per rider the growing segment and the bike, the tokens, the effects. */
    function collectMoving() {
      const c = cell;
      rcN = 0; rcOver = false;
      const padB = c * 2.8 + 3; // halo, speed lines, jump ring
      for (let n = 0; n < 2; n++) {
        const o = n * 10;
        const hx = LS[o + 4];
        const hy = LS[o + 5];
        addRect(Math.min(LS[o], hx) - padB, Math.min(LS[o + 1], hy) - padB, Math.max(LS[o], hx) + padB, Math.max(LS[o + 1], hy) + padB);
      }
      const padT = c * 1.3 + 3;
      for (let i = 0; i < sim.tl.length; i++) { const t = sim.tl[i]; const x = (t.x + 0.5) * c; const y = (t.y + 0.5) * c; addRect(x - padT, y - padT, x + padT, y + padT); }
      const padF = c * 4 + 3;
      for (let i = 0; i < fx.length; i++) { const f = fx[i]; const x = (f.x + 0.5) * c; const y = (f.y + 0.5) * c; addRect(x - padF, y - padF, x + padF, y + padF); }
    }
    function paintBg() {
      const g = LAYOUTS[layout];
      bgG.setTransform(lyS, 0, 0, lyS, 0, 0);
      bgG.globalAlpha = 1;
      bgG.fillStyle = C.card;
      bgG.fillRect(0, 0, gW, gH);
      drawBgVector(bgG, cell, g.W, g.H, sim);
      // paper tooth, at device resolution, over everything on the board
      grainOver(bgG, bgCan.width, bgCan.height);
    }
    let tintCan = null; let tintVer = -1;
    /** The shared noise mask tinted with the theme's ink (rebuilt when the theme changes), laid over a whole canvas at device resolution. */
    function grainOver(g, W, H) {
      try {
        if (!tintCan || tintVer !== bgVer) {
          const m = getGrainMask();
          tintCan = document.createElement('canvas');
          tintCan.width = m.width; tintCan.height = m.height;
          const tg = tintCan.getContext('2d');
          tg.fillStyle = C.ink; tg.fillRect(0, 0, m.width, m.height);
          tg.globalCompositeOperation = 'destination-in';
          tg.drawImage(m, 0, 0);
          tintVer = bgVer;
        }
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = C.dark ? 0.2 : 0.3;
        g.fillStyle = g.createPattern(tintCan, 'repeat');
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
      } catch { /* no pattern: a flat board */ }
    }
    /** Halftone ink: each rider's colour with a staggered dot screen, so a trail reads as printed rather than filled. */
    function makeInk() {
      inkPat.a = inkPat.b = null;
      try {
        const T = Math.max(4, Math.round(3.6 * lyS));
        for (const p of PL) {
          const tile = document.createElement('canvas');
          tile.width = T; tile.height = T;
          const g = tile.getContext('2d');
          g.fillStyle = C[p]; g.fillRect(0, 0, T, T);
          g.fillStyle = C.ink; g.globalAlpha = 0.24;
          g.beginPath(); g.arc(T / 2, T / 2, T * 0.2, 0, 7); g.fill();
          g.globalAlpha = 0.16;
          g.beginPath(); g.arc(0, 0, T * 0.13, 0, 7); g.arc(T, 0, T * 0.13, 0, 7); g.arc(0, T, T * 0.13, 0, 7); g.arc(T, T, T * 0.13, 0, 7); g.fill();
          const pat = trG.createPattern(tile, 'repeat');
          if (pat.setTransform && typeof DOMMatrix === 'function') { pat.setTransform(new DOMMatrix([1 / lyS, 0, 0, 1 / lyS, 0, 0])); inkPat[p] = pat; }
        }
      } catch { inkPat.a = inkPat.b = null; }
    }
    function resetTrails() {
      shG.setTransform(1, 0, 0, 1, 0, 0); shG.clearRect(0, 0, shCan.width, shCan.height);
      trG.setTransform(1, 0, 0, 1, 0, 0); trG.clearRect(0, 0, trCan.width, trCan.height);
      cbG.setTransform(1, 0, 0, 1, 0, 0); cbG.globalAlpha = 1; cbG.drawImage(bgCan, 0, 0);
      ci.a = 0; ci.b = 0; dirt = false;
    }
    function syncLayers() {
      let fresh = layerVer !== bgVer || !bgCan || lyAr !== cfg.ar || lySd !== cfg.sd || lyL !== cfg.L;
      if (fresh) {
        ensureCanvases();
        paintBg();
        makeInk();
        layerVer = bgVer; lyAr = cfg.ar; lySd = cfg.sd; lyL = cfg.L; lyRound = -1;
      }
      if (lyRound !== round || ci.a > sim.a.path.length / 2 - 1 || ci.b > sim.b.path.length / 2 - 1) { resetTrails(); lyRound = round; fresh = true; }
      return fresh;
    }
    /** Stroke rider p's path from the last stroked point up to point `upto` into the layers. */
    function commit(p, upto) {
      const P = sim[p].path;
      const last = P.length / 2 - 1;
      if (upto > last) upto = last;
      const i0 = ci[p];
      if (upto <= i0) return;
      const k = cell;
      const tw = Math.max(2.5, k * 0.6);
      const ow = Math.max(1.2, k * 0.15);
      const hw = tw / 2;
      const E = hw + ow;
      const sg = shadowSign();
      const sh = Math.max(1, k * 0.2);
      const mr = reduce ? 0 : Math.min(0.7, k * 0.07);
      // heading of the first and last segment in this batch, to square off the ends
      const fx0 = Math.sign(P[2 * i0 + 2] - P[2 * i0]);
      const fy0 = Math.sign(P[2 * i0 + 3] - P[2 * i0 + 1]);
      const lx0 = Math.sign(P[2 * upto] - P[2 * upto - 2]);
      const ly0 = Math.sign(P[2 * upto + 1] - P[2 * upto - 1]);
      let minX = 1e9; let minY = 1e9; let maxX = -1e9; let maxY = -1e9;
      for (let i = i0; i <= upto; i++) {
        const X = (P[2 * i] + 0.5) * k; const Y = (P[2 * i + 1] + 0.5) * k;
        if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
      }
      // shadow (opaque; the board composite applies its alpha)
      shG.setTransform(lyS, 0, 0, lyS, 0, 0);
      shG.lineJoin = 'miter'; shG.lineCap = 'square'; shG.lineWidth = tw + ow * 2; shG.strokeStyle = C.edge;
      shG.beginPath();
      shG.moveTo((P[2 * i0] + 0.5) * k + sh * sg[0], (P[2 * i0 + 1] + 0.5) * k + sh * sg[1]);
      for (let i = i0 + 1; i <= upto; i++) shG.lineTo((P[2 * i] + 0.5) * k + sh * sg[0], (P[2 * i + 1] + 0.5) * k + sh * sg[1]);
      shG.stroke();
      // outline: butt at the start of a batch (the stroke before it already squared its end), square at the very start of a trail
      trG.setTransform(lyS, 0, 0, lyS, 0, 0);
      trG.lineJoin = 'miter'; trG.lineCap = 'butt'; trG.lineWidth = tw + ow * 2; trG.strokeStyle = C.ink;
      trG.beginPath();
      const s0 = i0 === 0 ? E : 0;
      trG.moveTo((P[2 * i0] + 0.5) * k - fx0 * s0, (P[2 * i0 + 1] + 0.5) * k - fy0 * s0);
      for (let i = i0 + 1; i < upto; i++) trG.lineTo((P[2 * i] + 0.5) * k, (P[2 * i + 1] + 0.5) * k);
      trG.lineTo((P[2 * upto] + 0.5) * k + lx0 * E, (P[2 * upto + 1] + 0.5) * k + ly0 * E);
      trG.stroke();
      // ink, a hair off register with its outline
      trG.lineCap = 'square'; trG.lineWidth = tw; trG.strokeStyle = inkPat[p] || C[p];
      trG.beginPath();
      trG.moveTo((P[2 * i0] + 0.5) * k - mr, (P[2 * i0 + 1] + 0.5) * k - mr);
      for (let i = i0 + 1; i <= upto; i++) trG.lineTo((P[2 * i] + 0.5) * k - mr, (P[2 * i + 1] + 0.5) * k - mr);
      trG.stroke();
      ci[p] = upto;
      const pad = E + sh + 2;
      if (!dirt) { dirt = true; dX0 = minX - pad; dY0 = minY - pad; dX1 = maxX + pad; dY1 = maxY + pad; } else {
        if (minX - pad < dX0) dX0 = minX - pad; if (minY - pad < dY0) dY0 = minY - pad; if (maxX + pad > dX1) dX1 = maxX + pad; if (maxY + pad > dY1) dY1 = maxY + pad;
      }
    }
    function flushDirty() {
      if (!dirt) return;
      dirt = false;
      const W = cbCan.width;
      const H = cbCan.height;
      cRhas = true; cR0 = dX0; cR1 = dY0; cR2 = dX1; cR3 = dY1;
      const x0 = Math.max(0, Math.floor(dX0 * lyS));
      const y0 = Math.max(0, Math.floor(dY0 * lyS));
      const x1 = Math.min(W, Math.ceil(dX1 * lyS));
      const y1 = Math.min(H, Math.ceil(dY1 * lyS));
      if (x1 <= x0 || y1 <= y0) return;
      cbG.setTransform(1, 0, 0, 1, 0, 0);
      cbG.globalAlpha = 1;
      cbG.drawImage(bgCan, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      cbG.globalAlpha = C.dark ? 0.9 : 0.28;
      cbG.drawImage(shCan, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      cbG.globalAlpha = 1;
    }
    /** The part of each trail between its last stroked point and the head, in pixels (LS). A trail is only ever horizontal and
     *  vertical, so when a correction has moved the head off the line the segment is drawn as an L (along the old heading, then
     *  along the head's own), never as a slanted stroke. */
    function liveSegs() {
      const k = cell;
      for (let n = 0; n < 2; n++) {
        const p = PL[n];
        const P = sim[p].path;
        const v = vv[p];
        const o = n * 10;
        const x0 = (P[2 * ci[p]] + 0.5) * k;
        const y0 = (P[2 * ci[p] + 1] + 0.5) * k;
        const x1 = (v.x + 0.5) * k;
        const y1 = (v.y + 0.5) * k;
        const vert = v.d === 0 || v.d === 2;
        const cx = vert ? x1 : x0; // the last leg runs along the head's heading
        const cy = vert ? y0 : y1;
        LS[o] = x0; LS[o + 1] = y0; LS[o + 2] = cx; LS[o + 3] = cy; LS[o + 4] = x1; LS[o + 5] = y1;
        LS[o + 6] = DX[v.d]; LS[o + 7] = DY[v.d];
        const lx = cx - x0;
        const ly = cy - y0;
        if (Math.abs(lx) + Math.abs(ly) > 1e-3) { LS[o + 8] = Math.sign(lx); LS[o + 9] = Math.sign(ly); } else { LS[o + 8] = LS[o + 6]; LS[o + 9] = LS[o + 7]; }
      }
    }
    function strokeLive(n, ext, ox, oy) {
      const o = n * 10;
      const st = ci[PL[n]] === 0 ? ext : 0;
      ctx.beginPath();
      ctx.moveTo(LS[o] - LS[o + 8] * st + ox, LS[o + 1] - LS[o + 9] * st + oy);
      ctx.lineTo(LS[o + 2] + ox, LS[o + 3] + oy);
      ctx.lineTo(LS[o + 4] + LS[o + 6] * ext + ox, LS[o + 5] + LS[o + 7] * ext + oy);
      ctx.stroke();
    }

    function drawToken(t, now, idx) {
      const c = cell;
      const x = (t.x + 0.5) * c;
      const y = (t.y + 0.5) * c;
      const pulse = reduce ? 1 : 1 + 0.09 * Math.sin(now / 170 + idx);
      const R = Math.max(3.6, c * 0.82) * pulse;
      ctx.lineWidth = Math.max(1.2, c * 0.14);
      ctx.strokeStyle = C.ink;
      ctx.fillStyle = C.edge; ctx.globalAlpha = C.dark ? 0.9 : 0.28;
      const tsg = shadowSign();
      ctx.beginPath(); ctx.arc(x + c * 0.15 * tsg[0], y + c * 0.15 * tsg[1], R, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.hl;
      ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = C.ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1.2, c * 0.2);
      const u = R * 0.42;
      ctx.beginPath();
      if (t.k === 1) {
        // boost: two chevrons pointing along the ride
        ctx.moveTo(-u * 1.05, -u); ctx.lineTo(-u * 0.1, 0); ctx.lineTo(-u * 1.05, u);
        ctx.moveTo(u * 0.1, -u); ctx.lineTo(u * 1.05, 0); ctx.lineTo(u * 0.1, u);
      } else {
        // jump: a hop arc over a short bar
        ctx.moveTo(-u * 1.1, u * 0.55); ctx.quadraticCurveTo(0, -u * 1.7, u * 1.1, u * 0.55);
        ctx.moveTo(u * 0.5, -u * 0.1); ctx.lineTo(u * 1.1, u * 0.55); ctx.lineTo(u * 1.3, -u * 0.25);
      }
      ctx.stroke();
      ctx.restore();
    }
    function drawBike(p, v, now, live) {
      const c = cell;
      const ow = Math.max(1.2, c * 0.15);
      ctx.save();
      ctx.translate((v.x + 0.5) * c, (v.y + 0.5) * c);
      if (live) {
        // a printed halo: a flat disc of the rider's ink with a second, slightly off-register ring (no blur, no shadowBlur)
        const R = c * (1.25 + (reduce ? 0 : 0.12 * Math.sin(now / 90 + (p === 'a' ? 0 : 2))));
        ctx.fillStyle = C[p]; ctx.strokeStyle = C[p];
        ctx.globalAlpha = 0.22;
        ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
        ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1, c * 0.12);
        ctx.beginPath(); ctx.arc(c * 0.1, c * 0.08, R * 0.8, 0, 7); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.rotate((v.d * Math.PI) / 2);
      const w = c * 1.05;
      const l = c * 1.5;
      if (live && sim[p].boost > 0) {
        // speed lines behind a boosted rider
        ctx.strokeStyle = C.hl; ctx.lineWidth = Math.max(1.2, c * 0.18); ctx.lineCap = 'round';
        ctx.beginPath();
        for (let q = -1; q <= 1; q++) { const sx = q * 0.4; ctx.moveTo(sx * c, c * 0.9); ctx.lineTo(sx * c, c * (1.7 + 0.5 * Math.abs(sx * 2))); }
        ctx.stroke();
      }
      ctx.lineWidth = ow * 1.1;
      ctx.strokeStyle = C.ink;
      ctx.fillStyle = live ? C.hl : C.card;
      rr(-w / 2, -l / 2 - c * 0.18, w, l, Math.min(w, l) * 0.32);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = C[p];
      rr(-w / 2 + ow * 0.6, l * 0.1 - c * 0.18, w - ow * 1.2, l * 0.26, 1);
      ctx.fill();
      if (live && sim[p].jump > 0) {
        // a held jump: a paper ring around the bike
        DASH[0] = c * 0.5; DASH[1] = c * 0.4;
        ctx.strokeStyle = C.ink; ctx.lineWidth = ow; ctx.setLineDash(DASH);
        ctx.beginPath(); ctx.arc(0, 0, c * 1.35, 0, 7); ctx.stroke(); ctx.setLineDash(NODASH);
      }
      ctx.restore();
    }
    const DASH = [0, 0];
    const NODASH = [];
    function drawBurst(cr, k, age) {
      const g = LAYOUTS[sim.L];
      const c = cell;
      const ow = Math.max(1.2, c * 0.15);
      const bx = (clamp(cr[0], 0, g.W - 1) + 0.5) * c;
      const by = (clamp(cr[1], 0, g.H - 1) + 0.5) * c;
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
      if (!reduce && age >= 0 && age < 600) {
        // flat ink chips thrown out of the crash
        const u = age / 600;
        const e = 1 - (1 - u) * (1 - u);
        const sz = c * 0.5 * (1 - u) + 0.8;
        for (let i = 0; i < 10; i++) {
          const a = i * 0.628 + 0.4;
          const r = R * (1.1 + 1.9 * e) + (i % 2) * c * 0.6;
          ctx.fillStyle = i % 3 === 0 ? C.a : i % 3 === 1 ? C.b : C.ink;
          ctx.fillRect(bx + Math.cos(a) * r - sz / 2, by + Math.sin(a) * r - sz / 2, sz, sz);
        }
      }
    }
    const burstK = (age) => { if (reduce) return 1; const k0 = clamp(age / 380, 0, 1); return 1 + 2.2 * Math.pow(k0 - 1, 3) + 1.2 * Math.pow(k0 - 1, 2); };
    function drawFx(now) {
      const c = cell;
      const ow = Math.max(1.2, c * 0.15);
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        const age = Math.max(0, now - f.t0); // a rAF timestamp can precede an event handler's own clock reading
        const life = f.k === 'spark' ? 420 : f.k === 'tap' ? 230 : 520;
        if (age > life) { fx.splice(i, 1); continue; }
        const u = age / life;
        const x = (f.x + 0.5) * c;
        const y = (f.y + 0.5) * c;
        ctx.globalAlpha = 1 - u * u;
        if (f.k === 'spark') {
          const R = c * (0.9 + 1.5 * u);
          ctx.strokeStyle = C.ink; ctx.lineWidth = ow;
          ctx.fillStyle = C.hl;
          star(x, y, R, R * 0.42, 5, u * 1.2);
          ctx.fill(); ctx.stroke();
        } else if (f.k === 'tap') {
          ctx.globalAlpha = (1 - u * u) * 0.55; // a pressed-in echo of the rider's ink, never as solid as the trail itself
          ctx.strokeStyle = C[f.p]; ctx.lineWidth = ow * 1.4;
          ctx.beginPath(); ctx.arc(x, y, c * (0.8 + 1.6 * (1 - (1 - u) * (1 - u))), 0, 7); ctx.stroke();
        } else {
          ctx.strokeStyle = f.tk === 1 ? C.hl : C.ink; ctx.lineWidth = ow * 1.6;
          ctx.beginPath(); ctx.arc(x, y, c * (1 + 2.6 * u), 0, 7); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    const tv = { a: mkView(), b: mkView() };
    const FXY = [0, 0];
    function draw(now) {
      if (!ctx || !layout || !cfg) return;
      const g = LAYOUTS[layout];
      const c = cell;
      ctx.setTransform(canvas.width / cssW, 0, 0, canvas.height / cssH, 0, 0); // the canvas's own pixel density, so layer pixels map 1:1
      ctx.globalAlpha = 1;
      if (!sim || !vvReady) { ctx.fillStyle = C.card; ctx.fillRect(0, 0, cssW, cssH); needFull = true; return; }
      // the end-of-round story: crash at full size, a zoomed replay, then the board again
      const stage = endStage(now);
      let zoom = 1;
      let T = null; // fractional tick to show (replay), else the live view
      const crashXY = crashFocus();
      let fxy = crashXY;
      let burstAge = stage === 'none' ? -1 : now - crashAt;
      if (stage === 'replay') {
        const u = clamp((now - crashAt - HOLD_MS) / REPLAY_MS, 0, 1);
        zoom = reduce ? ZOOM : 1 + (ZOOM - 1) * (1 - Math.pow(1 - clamp(u / 0.16, 0, 1), 3));
        const t0 = Math.max(0, sim.t - REPLAY_TICKS);
        T = t0 + (sim.t - t0) * clamp((u - 0.08) / 0.7, 0, 1);
        burstAge = u > 0.78 ? (u - 0.78) * REPLAY_MS : -1;
        // the camera rides along with the rider who crashed, settling on the crash cell
        const fv = pathAt(sim, rw === 'a' ? 'b' : 'a', T, tv.a);
        const k = clamp((u - 0.6) / 0.2, 0, 1);
        FXY[0] = fv.x + (crashXY[0] - fv.x) * k; FXY[1] = fv.y + (crashXY[1] - fv.y) * k;
        fxy = FXY;
      } else if (stage === 'banner' && !reduce) {
        const since = now - (skipped ? skipAt : crashAt + HOLD_MS + REPLAY_MS);
        if (since < 260 && !skipped) zoom = ZOOM - (ZOOM - 1) * (1 - Math.pow(1 - since / 260, 3));
        burstAge = 1e5;
      } else if (stage === 'banner') burstAge = 1e5;
      const zx = (fxy[0] + 0.5) * c;
      const zy = (fxy[1] + 0.5) * c;
      const fast = zoom === 1 && T == null;
      if (!fast) { ctx.fillStyle = C.card; ctx.fillRect(0, 0, cssW, cssH); }
      if (zoom !== 1) {
        let sx = zx;
        let sy = zy;
        if (qr === 1) { sx = gH - zy; sy = zx; } else if (qr === 3) { sx = zy; sy = gW - zx; }
        if (flip) { sx = cssW - sx; sy = cssH - sy; }
        const hw = cssW / (2 * zoom);
        const hh = cssH / (2 * zoom);
        ctx.translate(cssW / 2, cssH / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-clamp(sx, hw, cssW - hw), -clamp(sy, hh, cssH - hh));
      }
      if (flip) { ctx.translate(cssW, cssH); ctx.rotate(Math.PI); }
      if (qr === 1) { ctx.translate(gH, 0); ctx.rotate(Math.PI / 2); } else if (qr === 3) { ctx.translate(0, gW); ctx.rotate(-Math.PI / 2); }
      const tShow = T == null ? sim.t : T;
      let partial = false;
      if (fast) {
        const fresh = syncLayers();
        cRhas = false;
        for (let n = 0; n < 2; n++) commit(PL[n], vv[PL[n]].i);
        flushDirty();
        liveSegs();
        collectMoving();
        // a still frame needs only the places where something moved (last frame's and this frame's), restored from the layers
        partial = !needFull && !fresh && !rcOver && !rpOver && stage === 'none';
        if (partial) restoreFrom(cbCan); else ctx.drawImage(cbCan, 0, 0, gW, gH);
      } else { drawBgVector(ctx, c, g.W, g.H, sim); ctx.save(); grainOver(ctx, canvas.width, canvas.height); ctx.restore(); needFull = true; } // the zoomed replay keeps the paper tooth too
      // tokens still lying on the grid
      if (sim.tl.length) {
        for (let i = 0; i < sim.tl.length; i++) {
          const t = sim.tl[i];
          const pk = sim.pk.get(t.y * sim.W + t.x);
          if (pk === undefined || pk > tShow) drawToken(t, now, i);
        }
      }
      const tw = Math.max(2.5, c * 0.6);
      const ow = Math.max(1.2, c * 0.15);
      const sg = shadowSign();
      const sh = Math.max(1, c * 0.2);
      let views = vv;
      if (T != null) { pathAt(sim, 'a', T, tv.a); pathAt(sim, 'b', T, tv.b); views = tv; }
      ctx.lineJoin = 'miter';
      if (fast) {
        // the growing end of each trail, in the same three passes as the layers (shadow under the stroked trail, ink over it)
        ctx.lineCap = 'butt';
        ctx.lineWidth = tw + ow * 2;
        ctx.globalAlpha = C.dark ? 0.9 : 0.28;
        ctx.strokeStyle = C.edge;
        for (let n = 0; n < 2; n++) strokeLive(n, tw / 2 + ow, sh * sg[0], sh * sg[1]);
        ctx.globalAlpha = 1;
        if (partial) restoreFrom(trCan); else ctx.drawImage(trCan, 0, 0, gW, gH);
        ctx.strokeStyle = C.ink;
        for (let n = 0; n < 2; n++) strokeLive(n, tw / 2 + ow, 0, 0);
        ctx.lineWidth = tw;
        const mr = reduce ? 0 : Math.min(0.7, c * 0.07);
        for (let n = 0; n < 2; n++) { ctx.strokeStyle = inkPat[PL[n]] || C[PL[n]]; strokeLive(n, tw / 2, -mr, -mr); }
      } else {
        ctx.lineCap = 'square';
        // hard offset shadow, then an ink outline, then each rider's ink
        ctx.save();
        ctx.translate(sh * sg[0], sh * sg[1]);
        ctx.strokeStyle = C.edge;
        ctx.globalAlpha = C.dark ? 0.9 : 0.28;
        ctx.lineWidth = tw + ow * 2;
        for (let n = 0; n < 2; n++) { trace(sim[PL[n]], views[PL[n]]); ctx.stroke(); }
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = tw + ow * 2;
        for (let n = 0; n < 2; n++) { trace(sim[PL[n]], views[PL[n]]); ctx.stroke(); }
        ctx.lineWidth = tw;
        for (let n = 0; n < 2; n++) { ctx.strokeStyle = C[PL[n]]; trace(sim[PL[n]], views[PL[n]]); ctx.stroke(); }
      }
      // heads: a bright, outlined bike with a band of its rider's ink
      for (let n = 0; n < 2; n++) { const p = PL[n]; drawBike(p, views[p], now, sim[p].alive || (T != null && T < sim.t - 0.05)); }
      if (T == null) drawFx(now);
      // crash bursts
      if (sim.done && burstAge >= 0) {
        ctx.lineJoin = 'miter'; ctx.lineCap = 'square';
        const ca = sim.a.alive ? null : sim.a.crash;
        const cb = sim.b.alive ? null : sim.b.crash;
        if (ca) drawBurst(ca, burstK(burstAge), burstAge);
        if (cb && !(ca && ca[0] === cb[0] && ca[1] === cb[1])) drawBurst(cb, burstK(burstAge), burstAge);
      }
      if (fast) { RP.set(RC.subarray(0, rcN * 4)); rpN = rcN; rpOver = rcOver; needFull = false; }
    }

    // the banner in the middle of the board; only rebuilt when what it says changes (no strings built per frame)
    let msgNum = -1;
    function syncMsg(now) {
      if (!msgEl) return;
      if (posPending) placeBanner();
      const stage = endStage(now);
      // a number that names what the banner should say: kind, pause reason, countdown, round, result, record stamps
      let kind = 0;
      if (phase === 'pick') kind = 0;
      else if (paused) kind = 1;
      else if (phase === 'count') kind = 2;
      else if (phase === 'run' && now - goAt < 600) kind = 3;
      else if ((phase === 'end' || phase === 'over') && sim && stage === 'banner') kind = 4;
      const rcm = (rc.indexOf('long') >= 0 ? 1 : 0) | (rc.indexOf('shaves') >= 0 ? 2 : 0);
      const num = kind === 0 ? 0 : ((((kind * 4 + pz) * 8 + (cd & 7)) * 16 + (round & 15)) * 4 + (rw === 'a' ? 1 : rw === 'b' ? 2 : 0)) * 4 + rcm;
      if (rpEl) {
        const on = stage === 'replay';
        if (on !== rpEl.classList.contains('is-on')) {
          rpEl.classList.toggle('is-on', on); // the caption's pop-in restarts by itself when the overlay is shown again
          if (on) { capText = captionOf(); rpEl.querySelector('.cy-rp-cap').innerHTML = capText; }
        }
      }
      if (num === msgNum) return;
      msgNum = num;
      let html = '';
      if (kind === 1) {
        const who = local ? '' : api.name(pz === 1 ? 'a' : 'b');
        html = `<span>${local || document.hidden && host && pz === 1 ? 'Paused' : `<b>${esc(who)}</b> stepped away`}</span>`;
      } else if (kind === 2) html = `<span class="is-num">${cd || 3}</span>`;
      else if (kind === 3) html = '<span class="is-num is-go">GO</span>';
      else if (kind === 4) {
        const shaves = sim.a.sh + sim.b.sh;
        const stamps = rc.map((x) => `<i class="cy-stamp">${x === 'long' ? 'LONGEST RIDE!' : 'MOST SHAVES!'}</i>`).join('');
        const small = `<small>Close shaves: ${shaves}${modeLabel() ? ` · ${esc(modeLabel())}` : ''}</small>`;
        if (rw === 'a' || rw === 'b') html = `<span class="w-${rw}"><span class="cy-t"><b>${esc(api.name(rw))}</b> takes round ${round}</span>${small}${stamps}</span>`;
        else html = `<span class="w-d is-heat"><span class="cy-t">DEAD HEAT</span><small>${esc(captionOf())}. Close shaves: ${shaves}. Fresh start next round.</small>${stamps}</span>`;
      }
      msgEl.innerHTML = html;
      msgEl.classList.toggle('is-up', kind === 4);
      if (kind === 4 && sim && cell) { posPending = true; msgEl.style.top = ''; } else { posPending = false; msgEl.style.top = ''; }
    }
    /** Keep the end banner off the crash, inside the board. Runs on the frame after the banner was written, so the layout it
     *  reads is already settled instead of being forced in the middle of a frame. */
    function placeBanner() {
      posPending = false;
      if (!msgEl || !sim || !cell || !msgEl.firstElementChild) return;
      const f = crashFocus();
      const y = qr === 0 ? (f[1] + 0.5) / sim.H : qr === 1 ? (f[0] + 0.5) / sim.W : 1 - (f[0] + 0.5) / sim.W;
      const want = (flip ? 1 - y : y) < 0.5 ? 0.76 : 0.24;
      const bh = cssH; // the canvas, not the (taller) board around it
      const c0 = (boardH - cssH) / 2 - 3; // where the canvas starts inside the board
      const sh = msgEl.firstElementChild.offsetHeight;
      msgEl.style.top = Math.round(c0 + clamp(want * bh, sh / 2 + 6, Math.max(sh / 2 + 6, bh - sh / 2 - 6))) + 'px';
    }
    // a slow device draws fewer pixels: after a second and a half of frames well over budget the layers drop a step of resolution
    function governor(raw, now) {
      if (dpr <= 1 || document.hidden || phase !== 'run') { slowFor = 0; return; }
      slowEma += (Math.min(raw, 100) - slowEma) * 0.05;
      if (slowEma > 24) {
        slowFor += raw;
        if (slowFor > 1500 && canvas) { slowFor = 0; slowEma = 16.7; dprScale = Math.max(0.5, dprScale * 0.8); fit(); }
      } else slowFor = 0;
    }
    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const raw = now - (lastNow || now);
      const dt = Math.min(MAX_DT, raw);
      lastNow = now;
      if (host) hostUpdate(now, Math.min(250, raw)); // the simulation keeps real time through a hitch (a few ticks catch up); only the drawing clamps
      if (!host) stepClock(now, dt);
      updateViews(dt);
      syncMsg(now);
      if (canvas) { draw(now); governor(raw, now); }
    }

    // ── pausing (host): the partner gone, or either tab in the background. Back: a fresh countdown ──
    let partnerAway = false;
    function syncPause() {
      if (!host || phase === 'over' || phase === 'wait' || phase === 'pick') return;
      const gone = !local && (!api.partnerHere || partnerAway);
      const want = document.hidden || gone;
      if (want && !paused) { paused = true; pz = document.hidden ? 1 : 2; publish(); } else if (want && paused && pz !== (document.hidden ? 1 : 2)) { pz = document.hidden ? 1 : 2; publish(); } else if (!want && paused) {
        paused = false; pz = 0;
        const now = perf();
        if (phase === 'run' || phase === 'count') { phase = 'count'; cdStart = now; cd = 3; acc = 0; api.sfx('tick'); } else if (phase === 'end') { endAt = now; crashAt = now; skipped = false; endDue = now + END_TOTAL; }
        publish();
      }
    }
    const onVis = () => { if (host) syncPause(); else publishGuest(); if (!document.hidden) { lastNow = 0; needFull = true; } };
    document.addEventListener('visibilitychange', onVis);
    offs.push(() => document.removeEventListener('visibilitychange', onVis));
    // a phone turned on its side: the next round gets the grid that fits (the host agrees it with the guest)
    let rsT = 0;
    const checkPref = () => {
      const np = prefNow();
      if (np === pref) return;
      pref = np;
      if (phase === 'pick' && pickShown) showPicker();
      else if (!local && canvas && qrFor() !== qr) build(); // the grid stays, this screen draws it the way that fills it
      if (!host) publishGuest();
    };
    const onResize = () => {
      clearTimeout(rsT);
      rsT = setTimeout(() => {
        timers.delete(rsT);
        checkPref();
        // iOS can report the old size just after a turn: look once more
        rsT = setTimeout(() => { timers.delete(rsT); checkPref(); }, 450);
        timers.add(rsT);
      }, 120);
      timers.add(rsT);
    };
    window.addEventListener('resize', onResize);
    offs.push(() => window.removeEventListener('resize', onResize));

    // ── wiring ──
    if (!local) {
      if (host) {
        offs.push(api.on('turn', (d) => { if (d) recvB(d.m, d.g, d.s, d.r, d.d); }));
        offs.push(api.onPartnerState((s) => { if (s && s.v === 2 && !!s.hid !== partnerAway) { partnerAway = !!s.hid; syncPause(); } }));
        offs.push(api.onPartnerState((s) => { if (s && s.mid === mid && s.g && Array.isArray(s.q)) { if (s.g !== curG) recvB(mid, s.g, 0, 0, -1); for (const x of s.q) if (Array.isArray(x)) recvB(mid, s.g, x[0], x[1], x[2]); } }));
        offs.push(api.onPartnerHere(() => syncPause()));
      } else {
        offs.push(api.onPartnerState(onHost));
        publishGuest();
        const s0 = api.partnerState();
        if (s0) onHost(s0);
      }
    }

    // test hook (automation only)
    const hook = {
      info: () => ({
        mode: api.mode, host, me, flip, touch, layout, pref, phase, round, cd, rw, paused, pz, score: { ...score }, md: { ...md }, matchAr, cfg,
        sim: sim && summary(sim),
        rebuilt: host && sim && cfg ? summary(rebuild(cfg, entries, sim.t)) : null,
        log: host ? encs.join(',') : gEntries.filter(Boolean).map(enc).join(','),
        pending: pending.map((p) => p.d),
        cell, cssW, cssH, qr, stage: endStage(perf()), skipped, rc: rc.slice(), caption: sim && sim.done ? captionOf() : '',
        shaves: sim ? sim.a.sh + sim.b.sh : 0, tdisp, tms: cfg && sim ? tickMs(cfg, sim.t) : 0, picker: pickShown,
      }),
      go: (o) => go(o),
      view: (p) => { if (!(sim && cfg)) return null; if (!vvReady) updateViews(0); const v = vv[p]; return { i: v.i, x: v.x, y: v.y, d: v.d }; },
      skip: () => skipReplay(),
      // pure helpers for the tests
      make: (c) => { const s = newSim(c); return { ...summary(s), sym: isSymmetric(s.occ, s.W, s.H), blocks: s.occ.reduce((n, v) => n + (v === 3 ? 1 : 0), 0), st: s.st, toks: s.tl.map((t) => [t.x, t.y, t.k]) }; },
      ramp: (c, t) => tickMs(c, t),
      boostTicks: BOOST_TICKS,
      lib: { newSim, step, rebuild, pathAt, okTurn },
    };
    if (navigator.webdriver) window.__cycles = hook;

    if (host) phase = 'pick';
    if (local) showPicker();
    raf = requestAnimationFrame(frame);
    return {
      destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        timers.forEach((t) => clearTimeout(t));
        teardownBoard();
        offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
        if (window.__cycles === hook) delete window.__cycles;
      },
    };
  },
});
