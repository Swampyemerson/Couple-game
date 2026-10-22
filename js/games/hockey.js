// Air Hockey: live, versus. Tables: Classic (first to 7), Pillar, Twin Pucks, Shrinking Goals,
// Power Puck and Quick (first to 3). Design notes, data keys and testing: docs/games/hockey.md.
//
// One phone: the table fills the stage and each player drags the mallet on their half (real
// multi-touch: every pointer belongs to the half it started in; a second finger on a half waits
// its turn and takes over when the first lifts). One computer: W/A/S/D against the arrow keys, with
// the table turned sideways. Two devices: each sees its own goal at the bottom (or, on a computer,
// the mouse drives your mallet).
//
// Netcode. The host ('a') runs the only real simulation: 120 Hz fixed steps, the guest's mallet
// fed in from its presence samples (velocity estimated from successive samples). The host streams
// { pucks, mallet, score, phase, table, hit counters, events } at ~25/s, stamped on the shared clock
// (net.js). The guest draws its own mallet straight from the finger and draws each puck *ahead* of
// the last host state by (state age + the measured guest->host lag): that is where the puck will be
// when the guest's mallet position reaches the host, so a hit the guest sees is a hit the host sees.
// The guest predicts its own hits locally and holds that prediction until the host's hit counter
// confirms it. Every other correction is blended away over ~100 ms at a limited speed (never a
// visible teleport unless the puck was reset). The host's table choice rides in the same stream
// (phase 'setup' + the chosen table), so a dropped message heals itself.
import { registerGame } from './core.js';
import { createNet } from './net.js';
import { W, H, RM, RP, GH, POST_R, DT, SERVE_V, MALLET_MAX, HIT_WALL, HIT_PILLAR, HIT_FRAME, TABLES, TABLE_ORDER, tableOf, newEnv, setGoals, goalHalf, clampMallet, clampTarget, unsqueeze, trackHand, smoothVel, capToHand, stepPuck, clamp, r1, other } from './hockey/physics.js';
import { createSound } from './hockey/sound.js';
import { SETUP_CSS, createSetup } from './hockey/setup.js';
import { readRecords, rallyResult, fastResult, matchResult, rivalryLine } from './hockey/records.js';
import { grainTile, paintGrain, dots, dotRings, centreMark, malletSprite, puckSprite, splatSprite } from './hockey/art.js';

const RAIL = 5;         // rail thickness (drawn outside the play field)
const GOAL_MS = 1150;   // goal celebration before the countdown
const COUNT_MS = 1500;  // 3-2-1
const KEY_V = 235;      // keyboard mallet top speed (a soft-to-medium pass; the power curve wants a real flick for a slap)
const KEY_ACC = 11;     // keyboard response (1/s): smooth acceleration and stop
const HIT_FX = 16;      // impact speed for a hit sound
const RATE = 25;        // network updates per second
const EDGE = 20;        // px: touches starting this close to the left edge are the iOS back swipe
const GLIDE_V = 180;    // u/s: how fast a mallet slides to a second finger that takes over
const HOG_S = 6;        // seconds a puck may sit on one half (or crawl) before the shot clock fires
const HOG_WARN = 3;     // the 3-2-1 ring starts here
const SAND_S = 0.5;     // a puck squeezed between both mallets this long is reset
const SLOW_MS = 400;    // match-point slow motion (real ms at 0.5x)
const REMOTE_LEAD = 0.1;  // s: how far past its newest sample the guest's mallet is extrapolated on the host
const REMOTE_BLEND = 0.07; // s: a new sample's offset from that guess dies away this fast
const REMOTE_STALE = 0.12; // s: a finger that moves reports every ~50 ms, so a guest mallet silent this long is at rest: its speed dies away
const STALL_MS = 1000;    // the HOG!/RESET stamp has the centre to itself this long before the serve countdown starts
const CORRECT_RATE = 700; // u/s: the fastest a guest's puck display may close a correction
const CORRECT_W = 34;     // rad/s: the guest's puck correction is a critically damped spring (95 % closed in ~140 ms), so its speed is continuous
const PARTNER_DELAY = 75; // ms: the partner's mallet is drawn this far behind the newest sample, between two samples (net.remoteInto)
const HARD_HIT = 120;     // impact speed (u/s) of a hit that gets hit-stop and a shake
const STOP_MS = 50;       // hit-stop: 50 ms at HARD_HIT, up to STOP_MAX for the hardest
const STOP_MAX = 80;
const GOAL_STOP = 80;     // the freeze on a goal
const DPR_MAX = 2;        // canvas pixel ratio cap (a 3x phone draws 2.25x fewer pixels)
const QUALITY = [1, 0.8, 0.64, 0.5]; // dynamic resolution steps

registerGame({
  id: 'hockey',
  title: 'Air Hockey',
  blurb: 'Fast hands, flat puck. Pick a table, first to 7.',
  kind: 'live',
  team: false,
  tags: ['silly'],
  platforms: ['phone', 'computer'],
  best: 'phone',
  immersive: true,
  minutes: 4,
  howTo: [
    'Pick a table, then drag your mallet around your half. A slow push passes, a fast flick slaps.',
    'One computer: W A S D against the arrow keys. Live on a computer: your mouse.',
    'Knock the puck into the slot at the far end. First to 7 wins (3 on the Quick table).',
    'Nobody may sit on the puck: after 6 seconds on one half the shot clock serves it to the other player.',
  ],
  css: `
    .g-hockey { position: absolute; inset: 0; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
    .g-hockey .hk-rig { position: absolute; inset: 0; will-change: transform; }
    .gm.is-immersive .g-hockey .hk-rig { top: calc(60px + env(safe-area-inset-top, 0px)); bottom: calc(4px + env(safe-area-inset-bottom, 0px)); left: env(safe-area-inset-left, 0px); right: env(safe-area-inset-right, 0px); }
    /* a phone on its side: the table turns sideways between the two corner stickers, full height */
    @media (orientation: landscape) and (max-height: 520px) {
      .gm.is-immersive .g-hockey .hk-rig { top: calc(6px + env(safe-area-inset-top, 0px)); left: calc(62px + env(safe-area-inset-left, 0px)); right: calc(62px + env(safe-area-inset-right, 0px)); }
    }
    .g-hockey .hk-slab { position: absolute; background: var(--g-card); box-shadow: var(--g-shadow-lg, var(--g-shadow)); }
    .g-hockey canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: none; }
    .g-hockey.is-local canvas { cursor: grab; }
    /* three layers: the printed table (drawn on resize / theme change only), the scoreboard text (repainted when it changes), the live sprites */
    .g-hockey .hk-tbl, .g-hockey .hk-hud { pointer-events: none; }
    .g-hockey .hk-tbl { z-index: 1; } .g-hockey .hk-hud { z-index: 2; } .g-hockey .hk-live { z-index: 3; }
    .g-hockey .hk-flash, .g-hockey .hk-slowf { position: absolute; pointer-events: none; opacity: 0; }
    .g-hockey .hk-flash { z-index: 2; }
    .g-hockey .hk-slowf { z-index: 4; box-sizing: border-box; border: 0 solid var(--g-ink); will-change: opacity; }
    ${SETUP_CSS}
  `,
  mount(el, api) {
    const local = api.mode === 'local';
    const host = local || api.isHost;           // runs the simulation
    const mine = local ? ['a', 'b'] : [api.me];  // mallets this device controls
    const me = local ? 'a' : api.me;
    const net = local ? null : createNet(api);
    const snd = createSound(api);
    const key = Math.random().toString(36).slice(2, 9); // this mount, so rematches don't mix states
    const coarseMQ = matchMedia('(pointer: coarse)');
    const motionMQ = matchMedia('(prefers-reduced-motion: reduce)');
    const darkMQ = matchMedia('(prefers-color-scheme: dark)');
    let coarse = coarseMQ.matches;
    let reduced = motionMQ.matches;

    el.innerHTML = `<div class="g-hockey ${local ? 'is-local' : ''}"><div class="hk-rig"><div class="hk-slab"></div><canvas class="hk-live" aria-label="Air hockey table"></canvas><canvas class="hk-tbl" aria-hidden="true"></canvas><canvas class="hk-hud" aria-hidden="true"></canvas><div class="hk-flash"></div><div class="hk-slowf"></div></div></div>`;
    const root = el.querySelector('.g-hockey');
    const rig = root.querySelector('.hk-rig');
    const slab = root.querySelector('.hk-slab');
    const cv = root.querySelector('.hk-live');        // the live sprites (mallets, pucks, stamps), cleared every frame; takes the touches
    const cx = cv.getContext('2d');
    const tb = root.querySelector('.hk-tbl');         // the printed table: drawn on resize / theme change, then left alone
    const tc = tb.getContext('2d');
    const hd = root.querySelector('.hk-hud');         // scoreboard text: repainted only when a number changes
    const hc = hd.getContext('2d');
    const flashEl = root.querySelector('.hk-flash');  // goal flash: an opacity animation on the compositor
    const slowEl = root.querySelector('.hk-slowf');   // match-point slow-mo frame
    const readTokens = () => {
      const cs = getComputedStyle(document.documentElement);
      const t = api.tokens();
      return { ...t, edge: cs.getPropertyValue('--g-edge').trim() || t.ink, aText: cs.getPropertyValue('--p-a-text').trim() || t.a, bText: cs.getPropertyValue('--p-b-text').trim() || t.b };
    };
    let T = readTokens();

    // ── world ──
    // px/py: where the mallet was one physics step ago, rx/ry: where it is drawn (the two blended by how far into the next step the clock is)
    const M = {
      a: { who: 'a', x: W / 2, y: H - 22, vx: 0, vy: 0, tx: W / 2, ty: H - 22, px: W / 2, py: H - 22, rx: W / 2, ry: H - 22 },
      b: { who: 'b', x: W / 2, y: 22, vx: 0, vy: 0, tx: W / 2, ty: 22, px: W / 2, py: 22, rx: W / 2, ry: 22 },
    };
    const score = { a: 0, b: 0 };
    const hits = { a: 0, b: 0 };
    const lastPick = (() => { const l = readRecords(api.data()).last; return l === 'surprise' || TABLES[l] ? l : 'classic'; })();
    let sel = lastPick;                     // the picker's choice: a table id or 'surprise'
    let table = tableOf(sel);
    let ON = [];                            // the pucks in play on this table (rebuilt by setTable, never per frame)
    let env = newEnv(table, score);
    const gd = { a: GH, b: GH };            // goal half-widths as drawn (they glide to env's)
    const newPuck = (i) => ({ i, x: W / 2, y: H / 2, px: W / 2, py: H / 2, rx: W / 2, ry: H / 2, vx: 0, vy: 0, on: true, ep: 0, back: 0, serveTo: 'a', t0: 0, half: null, stall: 0, slow: 0, sand: 0, sk: 0 });
    const PK = [newPuck(0), newPuck(1)];
    ON = PK.slice(0, table.pucks);
    const pucksOn = () => ON;
    function setTable(t) { table = t; ON = PK.slice(0, t.pucks); hudV++; }
    const MS = [M.a, M.b];                  // the two mallets, as the physics wants them (no per-step array)
    const parked = [];
    let phase = host ? 'setup' : 'wait'; // setup | count | play | goal | paused | over (guest: 'wait' until the host speaks)
    let phaseEnd = 0;
    let serveTo = Math.random() < 0.5 ? 'a' : 'b';
    let resumeSlow = false;
    let goals = 0;
    let lastScorer = null;
    let winner = null;
    let result = null;
    let acc = 0;
    let macc = 0;               // real seconds since the mallets last stepped
    let pausedFor = null;       // { phase, left }: what to resume after a pause
    const lastHitAt = { a: 0, b: 0 };
    // the drama
    let rally = 0;              // alternating mallet hits since the serve
    let lastHitter = null;
    let rallyAt = -1e9;
    const maxDef = { a: 0, b: 0 };
    let slowUsed = false;
    let slowUntil = 0;
    let ts = 1;                 // puck time scale (match-point slow motion)
    let evN = 0;
    const evq = [];             // [n, code, x, y, extra]: the last few events, streamed to the guest
    let lastEv = -1;
    const stamps = [];
    let pillarAt = -1e9;
    let mpAt = -1e9;
    let prevPhaseR = null;
    let prevRender = 0;
    const centreNow = [];        // what the middle-of-the-table lane shows this frame (test hook)
    let hudV = 1;                // bumps when the printed scoreboard must repaint (layout, theme, table)
    let alpha = 1;               // how far into the next physics step the clock is: the draw blends the last two steps by it
    let stopUntil = 0;           // hit-stop (host / one phone): the sim holds until this time
    let lastStopAt = -1e9;
    let gStop = 0;               // the same on the guest, from its own hits and the host's hz
    let hostFreezes = false;     // the host streams hz, so it freezes too (an older host never does: then the guest never holds either)
    let shakeAt = -1e9; let shakeAmp = 0; let shakeDur = 1; let shakeX = 0; let shakeY = 0;
    let hintK = 1;               // the hint's fade (it steps aside for anything printed in the middle)
    let tableAt = -1e9;
    let recs = readRecords(api.data()); // cached for the bands (refreshed a few times a second)
    let recsAt = 0;

    // ── input ──
    // Every pointer belongs to a player. The first finger down on a half drives that half's mallet;
    // later ones queue (with their latest position) and take over, in order, when it lifts.
    const mkCtl = () => ({ q: [], pos: new Map(), keys: new Set(), kvx: 0, kvy: 0, used: false, glide: false, fx: 0, fy: 0 });
    const ctl = { a: mkCtl(), b: mkCtl() };
    const ptrs = new Map(); // pointerId -> who

    // ── effects ──
    const fx = { flashWho: null, flashAt: -1e9, stampAt: -1e9, stampWho: null, splatX: W / 2, splatY: 0 };
    // speed-line trails: the last five drawn positions of each puck, in typed rings (nothing allocated per frame)
    const trails = [{ x: new Float32Array(5), y: new Float32Array(5), n: 0 }, { x: new Float32Array(5), y: new Float32Array(5), n: 0 }];
    const clearTrails = () => { trails[0].n = 0; trails[1].n = 0; };
    const sqAt = [-1e9, -1e9]; const sqNx = [0, 0]; const sqNy = [1, 1]; const sqA = [0, 0]; // puck squash on a bounce: when, along which table-space normal, how hard
    const pressAt = { a: -1e9, b: -1e9 };   // a finger just came down on this mallet
    const t0 = performance.now();

    // ── layout ──
    let cssW = 0; let cssH = 0; let dpr = 1; let s = 1; let ox = 0; let oy = 0; let view = 'up';
    let qi = 0;                 // dynamic resolution step (QUALITY[qi] x the device ratio, which is capped at DPR_MAX)
    let FX = 0; let FY = 0; let FW = 0; let FH = 0;   // the playing field's rectangle in css px
    let band = null;            // the printed scoreboard bands in the space the table's aspect leaves free (null when it is tight)
    // up: 'a' defends the bottom. down: turned round for 'b'. side: sideways, 'a' defends the left.
    // sideb: sideways for 'b' (their goal on the left). Wide screens use the sideways tables.
    const sideways = () => view === 'side' || view === 'sideb';
    const toPx = (x, y) => (view === 'up' ? [ox + x * s, oy + y * s] : view === 'down' ? [ox + (W - x) * s, oy + (H - y) * s] : view === 'sideb' ? [ox + y * s, oy + (W - x) * s] : [ox + (H - y) * s, oy + x * s]);
    const fromPx = (px, py) => {
      const u = (px - ox) / s; const v = (py - oy) / s;
      return view === 'up' ? [u, v] : view === 'down' ? [W - u, H - v] : view === 'sideb' ? [W - v, u] : [v, H - u];
    };
    // Screen direction -> table direction (for the keyboard).
    const screenToTable = (su, sv) => (view === 'up' ? [su, sv] : view === 'down' ? [-su, -sv] : view === 'sideb' ? [-sv, su] : [sv, -su]);
    // Text near player w is read by w on a shared phone (top player reads upside down).
    const readRot = (w) => (local && view === 'up' && w === 'b' ? Math.PI : 0);
    const px = (n) => n / s; // css px -> table units

    function layout() {
      const r = rig.getBoundingClientRect();
      cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
      cvL = r.left - shakeX; cvT = r.top - shakeY;
      const nat = window.devicePixelRatio || 1;
      dpr = Math.max(Math.min(1, nat), Math.min(DPR_MAX, nat) * QUALITY[qi]);
      // A phone held sideways (or any wide screen) gets the table sideways too, so it fills the screen.
      const wide = cssW >= cssH * 1.15;
      if (local) view = (!coarse && cssW >= cssH * 0.9) || wide ? 'side' : 'up';
      else view = wide ? (api.me === 'b' ? 'sideb' : 'side') : api.me === 'b' ? 'down' : 'up';
      const VW = sideways() ? H : W; const VH = sideways() ? W : H;
      const m = RAIL + 2;
      s = Math.min((cssW - 6) / (VW + m * 2), (cssH - 6) / (VH + m * 2), sideways() ? 5 : 4.6);
      s = Math.max(s, 0.5);
      ox = Math.round((cssW - VW * s) / 2); oy = Math.round((cssH - VH * s) / 2);
      for (const k of [cv, tb, hd]) { k.width = Math.round(cssW * dpr); k.height = Math.round(cssH * dpr); }
      const rp = RAIL * s;
      Object.assign(slab.style, { left: `${ox - rp}px`, top: `${oy - rp}px`, width: `${VW * s + rp * 2}px`, height: `${VH * s + rp * 2}px`, borderRadius: `${Math.round(rp * 1.6)}px` });
      { // the field's rectangle (the goal flash and the slow-mo frame sit exactly on it)
        const ax = projX(0, 0); const ay = projY(0, 0); const bx = projX(W, H); const by = projY(W, H);
        FX = Math.min(ax, bx); FY = Math.min(ay, by); FW = Math.abs(bx - ax); FH = Math.abs(by - ay);
        for (const e of [flashEl, slowEl]) Object.assign(e.style, { left: `${FX}px`, top: `${FY}px`, width: `${FW}px`, height: `${FH}px` });
        slowEl.style.borderWidth = `${7 * s}px`;
      }
      // Free space past each end of the table: a scoreboard band goes there when it is roomy enough.
      band = null;
      if (!sideways()) {
        const gap = oy - rp - 2; const bh = Math.min(76, gap - 20);
        if (bh >= 46) { const bw = Math.min(VW * s + rp * 2, 560); band = { kind: 'h', w: bw, h: bh, x: Math.round(cssW / 2 - bw / 2), top: Math.round(gap / 2 - bh / 2 + 1), bot: Math.round(cssH - gap / 2 - bh / 2 - 1) }; }
      } else {
        const gap = ox - rp - 2; const bw = Math.min(104, gap - 12);
        if (bw >= 46) { const bh = Math.min(VH * s + rp * 2, bw * 3.5); band = { kind: 'v', w: bw, h: bh, y: Math.round(cssH / 2 - bh / 2), left: Math.round(gap / 2 - bw / 2 + 1), right: Math.round(cssW - gap / 2 - bw / 2 - 1) }; }
      }
      buildSprites();
      hudV++;
      drawTable();
    }
    /** Set a canvas transform so drawing happens in table units. */
    function tableT(c) {
      const k = dpr * s;
      if (view === 'up') c.setTransform(k, 0, 0, k, dpr * ox, dpr * oy);
      else if (view === 'down') c.setTransform(-k, 0, 0, -k, dpr * (ox + W * s), dpr * (oy + H * s));
      else if (view === 'sideb') c.setTransform(0, -k, k, 0, dpr * ox, dpr * (oy + W * s));
      else c.setTransform(0, k, -k, 0, dpr * (ox + H * s), dpr * oy);
    }

    // ── the printed table (static layer; goal mouths and the Pillar are drawn live) ──
    // Printed in Riso inks on paper: the card stock takes the paper tooth (a grain of ink specks), the goal ends and the centre
    // circle shade in halftone dots, the creases and the centre mark sit a hair off register. Drawn once per resize / theme change.
    let grain = null;
    function grainFor() {
      const key = `${T.ink}|${T.dark}`;
      if (!grain || grain.key !== key) grain = { key, tile: grainTile(T.ink, !!T.dark) };
      return grain.tile;
    }
    function drawTable() {
      const c = tc;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, tb.width, tb.height);
      tableT(c);
      const inkW = px(2.5);
      // rail
      roundRect(c, -RAIL, -RAIL, W + RAIL * 2, H + RAIL * 2, RAIL * 1.6);
      c.fillStyle = T.card; c.fill();
      // halves, tinted with each player's soft ink
      c.fillStyle = T.bSoft || T.line; c.fillRect(0, 0, W, H / 2);
      c.fillStyle = T.aSoft || T.line; c.fillRect(0, H / 2, W, H / 2);
      // halftone fade toward each goal end: dots that grow toward the rail
      dots(c, 1.6, W - 1, 0, 36, 3.2, 1.05, (d) => 1 - d, T.b, 0.34);
      dots(c, 1.6, W - 1, H - 36, H, 3.2, 1.05, (d) => d, T.a, 0.34);
      // the centre circle sits in a ring of halftone
      dotRings(c, W / 2, H / 2, 16.2, 27, 3, 0.95, T.ink, 0.24);
      // creases: halftone fill in the player's ink, then the line itself
      c.save(); c.beginPath(); c.rect(0, 0, W, H); c.clip();
      dotRings(c, W / 2, 0, 3, 21.5, 2.8, 0.8, T.b, 0.3);
      dotRings(c, W / 2, H, 3, 21.5, 2.8, 0.8, T.a, 0.3);
      c.restore();
      // markings
      c.lineWidth = px(2);
      c.strokeStyle = T.ink;
      c.setLineDash([px(7), px(5)]);
      line(c, 0, H / 2, W, H / 2);
      c.setLineDash([]);
      c.beginPath(); c.arc(W / 2, H / 2, 14, 0, Math.PI * 2); c.stroke();
      centreMark(c, T, px(1));
      for (const [w, y0, a0, a1] of [['b', 0, 0, Math.PI], ['a', H, Math.PI, Math.PI * 2]]) {
        // goal crease: the colour plate, with the thin key plate printed a hair off it
        c.strokeStyle = T[w]; c.lineWidth = px(3);
        c.beginPath(); c.arc(W / 2, y0, 22, a0, a1); c.stroke();
        c.strokeStyle = T.ink; c.lineWidth = px(0.9); c.globalAlpha = 0.75;
        c.beginPath(); c.arc(W / 2 + 0.55, y0 + (w === 'b' ? 0.45 : -0.45), 22.9, a0, a1); c.stroke(); c.globalAlpha = 1;
        // face-off spots
        c.fillStyle = T[w];
        const fy = y0 === 0 ? 34 : H - 34;
        for (const fx0 of [W * 0.22, W * 0.78]) { c.beginPath(); c.arc(fx0, fy, 1.6, 0, Math.PI * 2); c.fill(); c.strokeStyle = T.ink; c.lineWidth = px(1.5); c.beginPath(); c.arc(fx0, fy, 4.2, 0, Math.PI * 2); c.stroke(); }
      }
      // paper tooth over the card stock (clipped to the rail so nothing speckles the space around the table)
      c.save();
      roundRect(c, -RAIL, -RAIL, W + RAIL * 2, H + RAIL * 2, RAIL * 1.6); c.clip();
      paintGrain(c, grainFor(), tb.width, tb.height);
      c.restore();
      // play field outline
      c.strokeStyle = T.ink; c.lineWidth = inkW;
      c.strokeRect(0, 0, W, H);
      // rail outline
      c.lineWidth = inkW;
      roundRect(c, -RAIL, -RAIL, W + RAIL * 2, H + RAIL * 2, RAIL * 1.6);
      c.stroke();
      // each player's name printed on the rail beside their goal
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const fs = Math.max(8, Math.min(13, RAIL * s * 0.62));
      for (const w of ['a', 'b']) {
        const [x, y] = toPx(w === 'a' ? W / 2 + GH + 17 : W / 2 - GH - 17, w === 'a' ? H + RAIL / 2 : -RAIL / 2);
        const rot = sideways() ? ((w === 'a') === (view === 'side') ? -Math.PI / 2 : Math.PI / 2) : readRot(w);
        label(c, api.name(w).toUpperCase(), x, y, fs, T[w + 'Text'], rot);
      }
      for (const w of ['a', 'b']) drawBandStatic(c, w);
    }

    // ── the scoreboard bands: printed cards in the room the table's aspect leaves on tall phones ──
    // Portrait: one at each end of the table (the one-phone game turns the far one round to face its
    // player). Landscape: one left and one right. Missing when there is less than ~50 px to spare.
    function bandRect(w) {
      if (!band) return null;
      if (band.kind === 'h') {
        const bottom = local ? w === 'a' : w === me;
        const rot = local && !bottom ? Math.PI : 0;
        return { x: band.x, y: bottom ? band.bot : band.top, w: band.w, h: band.h, rot, outer: bottom || rot ? 'down' : 'up', u: band.h / 66 };
      }
      const left = w === (view === 'side' ? 'a' : 'b');
      return { x: left ? band.left : band.right, y: band.y, w: band.w, h: band.h, rot: 0, outer: left ? 'left' : 'right', u: band.w / 54 };
    }
    /** Move the origin to the band's own top-left, turned to face its reader. */
    function bandFrame(c, g) {
      c.translate(g.x + g.w / 2, g.y + g.h / 2); if (g.rot) c.rotate(g.rot); c.translate(-g.w / 2, -g.h / 2);
    }
    function drawBandStatic(c, w) {
      const g = bandRect(w);
      if (!g) return;
      const { u } = g;
      c.save(); bandFrame(c, g);
      const r = 9 * u;
      roundRect(c, 3 * u, 4 * u, g.w, g.h, r); c.fillStyle = T.edge; c.fill();
      roundRect(c, 0, 0, g.w, g.h, r); c.fillStyle = T.card; c.fill();
      c.save(); c.clip();
      c.fillStyle = T[w + 'Soft'] || T.line; c.fillRect(0, 0, g.w, g.h);
      // halftone, heaviest at the outer edge (the same fade the table prints toward each goal)
      c.fillStyle = T[w]; c.globalAlpha = 0.24;
      const vert = g.outer === 'left' || g.outer === 'right';
      const step = 3.4 * u; const depth = (vert ? g.w : g.h) * 0.5; const along = vert ? g.h : g.w;
      for (let d = step * 0.5, row = 0; d < depth; d += step * 0.87, row++) {
        const rr = 1.2 * u * (1 - d / depth); const off = (row % 2) * step * 0.5;
        for (let q = step * 0.5 + off; q < along; q += step) {
          const a = g.outer === 'up' || g.outer === 'left' ? d : (vert ? g.w : g.h) - d;
          c.beginPath(); if (vert) c.arc(a, q, rr, 0, Math.PI * 2); else c.arc(q, a, rr, 0, Math.PI * 2); c.fill();
        }
      }
      c.globalAlpha = 1;
      paintGrain(c, grainFor(), tb.width, tb.height); // (device pixels, clipped to the card)
      c.restore();
      roundRect(c, 0, 0, g.w, g.h, r); c.strokeStyle = T.ink; c.lineWidth = Math.max(2, 2.5); c.stroke();
      c.restore();
    }
    function drawBandText(c, w, now) {
      const g = bandRect(w);
      if (!g) return;
      const { u } = g;
      const mpOn = score[w] === table.toWin - 1 && !winner;
      const flash = !reduced && fx.flashWho === w ? Math.max(0, 1 - (now - fx.flashAt) / 300) : 0;
      const num = String(score[w]);
      const tag = `${table.name.toUpperCase()} · FIRST TO ${table.toWin}`;
      const nameC = T[w + 'Text'];
      const rallyOn = phase === 'play' && rally > 0;
      c.save(); bandFrame(c, g);
      c.lineJoin = 'round';
      const chip = (str, x, y, size, maxW) => { // a printed flag
        c.font = `900 ${size}px ${T.fontDisplay || 'system-ui'}`;
        const tw = Math.min(maxW, c.measureText(str).width + size * 1.1); const th = size * 1.7;
        const bob = reduced ? 0 : Math.sin(now / 260) * u * 0.6;
        roundRect(c, x + u, y - th / 2 + u + bob, tw, th, th * 0.3); c.fillStyle = T.edge; c.fill();
        roundRect(c, x, y - th / 2 + bob, tw, th, th * 0.3); c.fillStyle = T.hl; c.fill(); c.strokeStyle = T.ink; c.lineWidth = Math.max(1.5, u * 1.6); c.stroke();
        text(c, str, x + tw / 2, y + bob + size * 0.04, size, T.ink, 0, null, 900, T.fontDisplay, tw - size * 0.5);
      };
      if (g.outer === 'up' || g.outer === 'down') {
        const { w: bw, h: bh } = g;
        misOn = true; text(c, num, 30 * u, bh / 2 + 2 * u, 46 * u * (1 + 0.3 * flash), T[w], 0, T.ink); misOn = false;
        c.strokeStyle = T.ink; c.globalAlpha = 0.45; c.lineWidth = Math.max(1.2, u * 1.4); c.setLineDash([u * 4, u * 3]);
        c.beginPath(); c.moveTo(58 * u, 11 * u); c.lineTo(58 * u, bh - 11 * u); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
        const rw = 96 * u; const mx = 68 * u; const midW = Math.max(10, bw - mx - rw - 6 * u);
        if ('letterSpacing' in c) c.letterSpacing = `${Math.round(2 * u)}px`;
        text(c, api.name(w).toUpperCase(), mx, bh * 0.31, 14 * u, nameC, 0, null, 900, T.fontDisplay, midW, 'left');
        if ('letterSpacing' in c) c.letterSpacing = '0px';
        if (mpOn && phase !== 'over') chip('MATCH POINT', mx, bh * 0.68, 10 * u, midW);
        else { c.globalAlpha = 0.7; text(c, tag, mx, bh * 0.68, 9 * u, T.ink, 0, null, 800, T.fontBody, midW, 'left'); c.globalAlpha = 1; }
        // right: the rally counter and the rally to beat
        const xr = bw - 13 * u;
        const pop = reduced || !rallyOn ? 1 : 1 + 0.3 * Math.max(0, 1 - (now - rallyAt) / 200);
        const rs = String(rally);
        c.font = `900 ${24 * u}px ${T.fontDisplay || 'system-ui'}`;
        const nw = c.measureText(rs).width;
        c.globalAlpha = 0.65; text(c, 'RALLY', xr - nw * pop - 6 * u, bh * 0.33, 9 * u, T.ink, 0, null, 800, T.fontBody, 0, 'right'); c.globalAlpha = 1;
        c.globalAlpha = rallyOn ? 1 : 0.4;
        text(c, rs, xr, bh * 0.33, 24 * u * pop, rally >= 8 && rallyOn ? T.hl : T.ink, 0, rally >= 8 && rallyOn ? T.ink : null, 900, T.fontDisplay, 0, 'right');
        c.globalAlpha = 0.75;
        const best = recs.rallyBest ? `BEST ${recs.rallyBest}${recs.rallyWho ? ` · ${api.name(recs.rallyWho).toUpperCase()}` : ''}` : 'BEST RALLY: NONE YET';
        text(c, best, xr, bh * 0.68, 9 * u, T.ink, 0, null, 800, T.fontBody, rw, 'right');
        c.globalAlpha = 1;
      } else {
        const { w: bw, h: bh } = g;
        const cxm = bw / 2;
        if ('letterSpacing' in c) c.letterSpacing = `${Math.round(1.2 * u)}px`;
        text(c, api.name(w).toUpperCase(), cxm, 14 * u, 9 * u, nameC, 0, null, 900, T.fontDisplay, bw - 8 * u);
        if ('letterSpacing' in c) c.letterSpacing = '0px';
        misOn = true; text(c, num, cxm, bh * 0.31, 40 * u * (1 + 0.3 * flash), T[w], 0, T.ink); misOn = false;
        c.strokeStyle = T.ink; c.globalAlpha = 0.45; c.lineWidth = Math.max(1.2, u * 1.4); c.setLineDash([u * 4, u * 3]);
        c.beginPath(); c.moveTo(8 * u, bh * 0.485); c.lineTo(bw - 8 * u, bh * 0.485); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
        if (mpOn && phase !== 'over') { chip('MATCH', cxm - 18 * u, bh * 0.555, 8.5 * u, 36 * u); chip('POINT', cxm - 18 * u, bh * 0.555 + 14 * u, 8.5 * u, 36 * u); }
        else { c.globalAlpha = 0.7; text(c, `FIRST TO ${table.toWin}`, cxm, bh * 0.57, 7.5 * u, T.ink, 0, null, 800, T.fontBody, bw - 8 * u); c.globalAlpha = 1; }
        c.globalAlpha = 0.65; text(c, 'RALLY', cxm, bh * 0.72, 7.5 * u, T.ink, 0, null, 800, T.fontBody, bw - 8 * u); c.globalAlpha = rallyOn ? 1 : 0.4;
        text(c, String(rally), cxm, bh * 0.81, 16 * u * (reduced || !rallyOn ? 1 : 1 + 0.3 * Math.max(0, 1 - (now - rallyAt) / 200)), rally >= 8 && rallyOn ? T.hl : T.ink, 0, rally >= 8 && rallyOn ? T.ink : null, 900, T.fontDisplay, bw - 8 * u);
        c.globalAlpha = 0.7; text(c, recs.rallyBest ? `BEST ${recs.rallyBest}` : 'BEST -', cxm, bh * 0.915, 7.5 * u, T.ink, 0, null, 800, T.fontBody, bw - 8 * u);
        c.globalAlpha = 1;
      }
      c.restore();
    }
    function label(c, str, x, y, size, color, rot) {
      c.save(); c.translate(x, y); c.rotate(rot);
      c.font = `900 ${size}px ${T.fontDisplay || 'system-ui'}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if ('letterSpacing' in c) c.letterSpacing = `${Math.round(size * 0.18)}px`;
      c.fillStyle = color; c.fillText(str, 0, 0);
      c.restore();
    }
    function roundRect(c, x, y, w, h, r) {
      c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    }
    function line(c, x0, y0, x1, y1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }

    // ── sound / feel ──
    function hitFx(imp) {
      if (imp < HIT_FX) return;
      api.sfx('hit');
      api.haptic(imp > 120 ? 14 : 8);
    }
    let extrap = false;         // the guest is only guessing ahead (extrapolate): sounds as before, no juice
    /** A few px of shake on the whole rig (compositor only). The bigger one wins; off under reduced motion. */
    function shake(amp, dur) {
      if (reduced) return;
      const now = performance.now();
      if (amp >= shakeAmp * Math.max(0, 1 - (now - shakeAt) / shakeDur)) { shakeAt = now; shakeAmp = amp; shakeDur = dur; }
    }
    /** The puck squashes along `n` (table space) when it hits something, then springs back (~130 ms). */
    function squash(i, nx, ny, a) {
      if (reduced || extrap) return;
      sqAt[i] = performance.now(); sqNx[i] = nx; sqNy[i] = ny; sqA[i] = a;
    }
    function squashWall(p, mask, sp) {
      let nx; let ny;
      if (mask & HIT_PILLAR) { nx = p.x - W / 2; ny = p.y - H / 2; const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d; }
      else if (p.x <= RP + 0.06) { nx = 1; ny = 0; } else if (p.x >= W - RP - 0.06) { nx = -1; ny = 0; }
      else if (p.y <= RP + 0.06) { nx = 0; ny = 1; } else if (p.y >= H - RP - 0.06) { nx = 0; ny = -1; }
      else { const d = Math.hypot(p.vx, p.vy) || 1; nx = p.vx / d; ny = p.vy / d; }
      squash(p.i, nx, ny, clamp(sp / 170, 0.3, 1));
    }
    /** A hard mallet hit: a short hit-stop and a shake. The host / one phone freezes its sim (and streams hz so the guest freezes too). */
    function hardHit(imp) {
      if (reduced || extrap || imp < HARD_HIT) return;
      const now = performance.now();
      if (now - lastStopAt > 320) {
        lastStopAt = now;
        const ms = STOP_MS + clamp((imp - HARD_HIT) * 0.3, 0, STOP_MAX - STOP_MS);
        if (host) stopUntil = now + ms; else if (hostFreezes) gStop = now + ms;
      }
      shake(1.6 + clamp((imp - HARD_HIT) / 90, 0, 1.4), 170);
    }
    /** wall / Pillar sounds for a puck step's bounce mask (the goal frame is the host's POST event). */
    function bounceFx(mask, p) {
      if (!mask) return;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp < 22) return;
      squashWall(p, mask, sp);
      if (mask & HIT_PILLAR) { snd.pillar(sp); pillarAt = performance.now(); } else if (mask & HIT_WALL) snd.wall(sp);
    }
    let flashAnim = null;
    function goalFx(scorer, gx) {
      const now = performance.now();
      fx.flashWho = scorer; fx.flashAt = now;
      fx.stampWho = scorer; fx.stampAt = now;
      fx.splatX = clamp(gx === undefined ? W / 2 : gx, 18, W - 18); fx.splatY = scorer === 'a' ? 0 : H;
      shake(4.5, 240);
      if (!reduced) {
        if (host) stopUntil = Math.max(stopUntil, now + GOAL_STOP); else if (hostFreezes) gStop = Math.max(gStop, now + GOAL_STOP);
        flashEl.style.background = T[scorer];
        if (flashEl.animate) { if (flashAnim) flashAnim.cancel(); flashAnim = flashEl.animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' }); } else flashEl.style.opacity = '0';
      }
      clearTrails();
      api.sfx(local || scorer === me ? 'good' : 'bad');
      api.haptic(40);
    }
    function addStamp(text, sub, x, y, colKey, size, dur, o = {}) {
      stamps.push({ t0: performance.now(), dur, text, sub, x, y, col: colKey, size, rot: o.rot || 0, both: !!o.both });
    }
    /** An event happened (host: just now; guest: the host told us). Stamps and sounds. */
    function runEvent(code, x, y, extra) {
      if (code === 1) { // POST!
        snd.clang();
        addStamp('POST!', null, clamp(x, 26, W - 26), y < H / 2 ? 30 : H - 30, 'hl', 8.5, 900, { rot: readRot(y < H / 2 ? 'b' : 'a') });
      } else if (code === 2 || code === 3) { // HOG! / RESET
        snd.buzz();
        const who = extra === 0 ? 'a' : 'b';
        addStamp(code === 2 ? 'HOG!' : 'RESET', code === 2 ? `${api.name(who)} sat on it` : 'puck squeezed', W / 2, H / 2, 'bad', 17, STALL_MS, { both: true });
      } else if (code === 4) { // rally record
        snd.record();
        addStamp(`RALLY RECORD ${extra}`, 'longest ever', W / 2, H / 2 + (local && view === 'up' ? 0 : 24), 'good', 9, 1900, { both: true });
      } else if (code === 5) { // fastest goal
        snd.record();
        addStamp('FASTEST GOAL', `${(extra / 1000).toFixed(1)} s from the serve`, W / 2, H / 2 + (local && view === 'up' ? 0 : -24), 'good', 9, 1900, { both: true });
      } else if (code === 6) { // slow motion
        snd.slow();
      } else if (code === 7) { // table intro
        tableAt = performance.now();
      } else if (code === 8) { // comeback on the winning goal
        addStamp('COMEBACK!', `from ${extra} down`, W / 2, H / 2, 'good', 15, 1700, { both: true });
      }
    }
    function emit(code, x, y, extra = 0) {
      const ev = [++evN, code, r1(x), r1(y), extra];
      evq.push(ev); if (evq.length > 5) evq.shift();
      runEvent(code, x, y, extra);
      publishSoon();
    }

    // ── host / one-device simulation ──
    const heatOf = (r) => Math.min(10, r) / 10;
    const boostOf = (r) => 1 + 0.06 * Math.min(10, r);
    function onHit(m, imp, p) {
      const now = performance.now();
      lastHv = Math.max(lastHv, imp); // rides along so the guest can play the host's hit sounds
      if (now - lastHitAt[m.who] > 80) {
        lastHitAt[m.who] = now; hits[m.who]++; hitFx(imp);
        if (imp >= 14) { const dx = p.x - m.x; const dy = p.y - m.y; const d = Math.hypot(dx, dy) || 1; squash(p.i, dx / d, dy / d, clamp(imp / 190, 0.3, 1)); }
        hardHit(imp);
        if (lastHitter !== m.who && imp >= 14) { // a mallet just touching/squeezing a resting puck isn't a rally hit
          const before = boostOf(rally);
          rally++; lastHitter = m.who; rallyAt = now;
          if (env.power) { const r = boostOf(rally) / before; p.vx *= r; p.vy *= r; if (rally >= 2) snd.heat(heatOf(rally)); }
        }
      }
    }
    function placePucks(serve) {
      PK.forEach((p, i) => {
        Object.assign(p, { x: table.pucks > 1 ? W / 2 + (i ? 14 : -14) : env.post ? W / 2 + (Math.random() < 0.5 ? -22 : 22) : W / 2, y: H / 2, vx: 0, vy: 0, on: true, back: 0, half: null, stall: 0, slow: 0, sand: 0, sk: 0 });
        p.ep++; p.px = p.x; p.py = p.y;
        p.serveTo = i ? other(serve) : serve; p.launch = true;
      });
      clearTrails();
    }
    function startCount(serve) {
      phase = 'count';
      phaseEnd = performance.now() + COUNT_MS;
      serveTo = serve || serveTo;
      if (serve) placePucks(serve);
      rally = 0; lastHitter = null; slowUsed = false;
      publishSoon();
    }
    function serveVec(to) {
      const th = (Math.random() - 0.5) * 0.7;
      return [Math.sin(th) * SERVE_V, Math.cos(th) * SERVE_V * (to === 'a' ? 1 : -1)];
    }
    const goalLog = []; // for tests: how each goal happened
    function endRally(who) {
      if (rally < 3) return;
      const rr = rallyResult(api.data(), rally, who);
      if (rr.patch) api.setData(rr.patch);
      if (rr.record) emit(4, W / 2, H / 2, rally);
    }
    function scoreGoal(w, how = 'puck', pk = PK[0]) {
      if (phase === 'over' || winner) return;
      const now = performance.now();
      goalLog.push({ w, how, phase, at: Math.round(now), x: r1(pk.x), y: r1(pk.y), vx: r1(pk.vx), vy: r1(pk.vy) });
      endRally(w);
      if (how === 'puck' && pk.t0) {
        const fr = fastResult(api.data(), now - pk.t0, w);
        if (fr.patch) api.setData(fr.patch);
        if (fr.record) emit(5, W / 2, H / 2, Math.round(now - pk.t0));
      }
      score[w]++; goals++; lastScorer = w;
      for (const p of ['a', 'b']) maxDef[p] = Math.max(maxDef[p], score[other(p)] - score[p]);
      setGoals(env, score);
      const wins = score[w] >= table.toWin;
      if (wins) winner = w;
      rally = 0; lastHitter = null; slowUsed = false; ts = 1; slowUntil = 0;
      api.setScore(score);
      goalFx(w, pk.x);
      if (wins || table.pucks === 1) {
        phase = 'goal';
        const cb = wins && maxDef[w] >= 3;
        phaseEnd = now + (wins ? (cb ? 1900 : 1300) : GOAL_MS);
        if (cb) emit(8, W / 2, H / 2, maxDef[w]);
      } else { // Twin Pucks: only that puck re-serves, the other keeps playing
        pk.on = false; pk.back = now + GOAL_MS + 500; pk.serveTo = other(w); pk.sk = 0;
      }
      publishSoon();
    }
    function stallBreak(pk, kind, half) {
      const now = performance.now();
      emit(kind === 'hog' ? 2 : 3, W / 2, H / 2, half === 'a' ? 0 : 1);
      if (kind === 'hog') endRally(lastHitter || half);
      rally = 0; lastHitter = null;
      const to = kind === 'hog' ? other(half) : Math.random() < 0.5 ? 'a' : 'b';
      if (table.pucks === 1) { startCount(to); phaseEnd += STALL_MS; }
      else { pk.on = false; pk.back = now + 700; pk.serveTo = to; pk.sk = 0; }
    }
    function respawn(pk, now) {
      const [vx, vy] = serveVec(pk.serveTo);
      Object.assign(pk, { x: W / 2 + (pk.i ? 14 : -14), y: H / 2, vx, vy, on: true, back: 0, t0: now, half: null, stall: 0, slow: 0, sand: 0, sk: 0 });
      pk.ep++;
      trails[pk.i].n = 0; pk.px = pk.x; pk.py = pk.y;
    }
    /** shot clock + squeezed-puck check for one puck over dt seconds */
    function stallTick(pk, dt) {
      const half = pk.y >= H / 2 ? 'a' : 'b';
      if (pk.half !== half) { pk.half = half; pk.stall = 0; } else pk.stall += dt;
      if (Math.hypot(pk.vx, pk.vy) < 25) pk.slow += dt; else pk.slow = 0;
      const t = Math.max(pk.stall, pk.slow);
      const R = RM + RP + 0.4;
      if (Math.hypot(pk.x - M.a.x, pk.y - M.a.y) < R && Math.hypot(pk.x - M.b.x, pk.y - M.b.y) < R) pk.sand += dt; else pk.sand = 0;
      pk.sk = t >= HOG_WARN ? Math.max(1, Math.round((HOG_S - t) * 1000)) : 0;
      if (pk.sand >= SAND_S) stallBreak(pk, 'reset', half);
      else if (t >= HOG_S) stallBreak(pk, 'hog', half);
      else if (pk.sk && Math.ceil(pk.sk / 1000) !== pk.tk) { pk.tk = Math.ceil(pk.sk / 1000); snd.shotTick(pk.tk); }
    }
    /** Match point, once per point: the puck enters the defending third headed at goal. */
    function slowCheck(now) {
      if (slowUsed || phase !== 'play') return;
      for (const pk of pucksOn()) {
        if (!pk.on) continue;
        for (const att of ['a', 'b']) {
          if (score[att] !== table.toWin - 1) continue;
          const up = att === 'a'; // 'a' scores in the top goal (y = 0)
          if (up ? !(pk.y < H / 3 && pk.vy < -70) : !(pk.y > (2 * H) / 3 && pk.vy > 70)) continue;
          const t = up ? pk.y / -pk.vy : (H - pk.y) / pk.vy;
          if (Math.abs(pk.x + pk.vx * t - W / 2) > goalHalf(env, other(att)) + 8) continue;
          slowUsed = true; slowUntil = now + SLOW_MS;
          emit(6, pk.x, pk.y, 0);
          return;
        }
      }
    }
    function simulate(dt, now, dtm) {
      if (phase === 'setup') return;
      if (phase === 'goal' && now >= phaseEnd) {
        if (winner) finishMatch();
        else startCount(other(lastScorer));
      }
      if (phase === 'count' && now >= phaseEnd) {
        phase = 'play';
        for (const pk of pucksOn()) {
          pk.t0 = now; pk.half = null; pk.stall = 0; pk.slow = 0; pk.sand = 0;
          if (pk.launch) { [pk.vx, pk.vy] = serveVec(pk.serveTo); pk.launch = false; } else if (resumeSlow) { pk.vx *= 0.5; pk.vy *= 0.5; }
        }
        resumeSlow = false;
        publishSoon();
      }
      if (phase === 'play') for (const pk of pucksOn()) if (!pk.on && pk.back && now >= pk.back) respawn(pk, now);
      // slow motion eases back
      if (now < slowUntil) ts = 0.5; else if (ts < 1) ts = Math.min(1, ts + dt / 0.12);
      // hit-stop: the clock holds (the picture stays put, the mallets wait where they are) and picks up where it left off;
      // macc keeps counting real time so the mallets' speed afterwards is still distance over real time
      acc += now < stopUntil ? 0 : dt; macc += dtm;
      let n = Math.floor(acc / DT);
      if (n > 14) { n = 14; acc = 0; } else acc -= n * DT;
      if (!n) return;
      const rdt = clamp(macc, DT, 0.1); macc = 0; // real time since the mallets last moved: their speed is dx / rdt, whatever n came out as
      const ms = MS;
      const frozen = phase === 'paused' || phase === 'over';
      parked.length = 0;
      for (const p of ON) if (p.on) parked.push(p);
      for (const m of ms) {
        trackHand(m, rdt);
        // While a puck is parked, it's an obstacle: aim beside it, never into it. (Pushing
        // the mallet out every step would give it a fake speed that slams the puck at the serve.)
        if (phase !== 'play') {
          for (const P of parked) {
            const dx = m.tx - P.x; const dy = m.ty - P.y; const d = Math.hypot(dx, dy); const R = RM + RP + 0.05;
            if (d < R) {
              const nx = d > 1e-6 ? dx / d : 0; const ny = d > 1e-6 ? dy / d : m.who === 'a' ? 1 : -1;
              [m.tx, m.ty] = clampTarget(m.who, P.x + nx * R, P.y + ny * R, env);
            }
          }
        }
        m.sx = m.x; m.sy = m.y;
        let dx = frozen ? 0 : m.tx - m.x; let dy = frozen ? 0 : m.ty - m.y;
        const maxd = MALLET_MAX * rdt; const d = Math.hypot(dx, dy);
        if (d > maxd) { dx *= maxd / d; dy *= maxd / d; }
        m.dx = dx; m.dy = dy;
        smoothVel(m, dx, dy, rdt);
      }
      for (let i = 1; i <= n; i++) {
        if (phase === 'play' && now < stopUntil) { // a hard hit just landed: the rest of this frame waits too
          for (const pk of ON) { pk.px = pk.x; pk.py = pk.y; }
          for (const m of ms) { m.px = m.x; m.py = m.y; }
          break;
        }
        for (const m of ms) {
          const nx = m.sx + (m.dx * i) / n; const ny = m.sy + (m.dy * i) / n;
          m.px = m.x; m.py = m.y;
          m.vx = m.wvx; m.vy = m.wvy; m.x = nx; m.y = ny;
          clampMallet(m, env);
          capToHand(m);
          if (phase !== 'play') for (const P of parked) unsqueeze(P, m, env); // keep mallets off parked pucks
        }
        if (phase === 'play') {
          for (const pk of ON) {
            if (!pk.on) continue;
            pk.px = pk.x; pk.py = pk.y;
            const r = stepPuck(pk, ms, onHit, false, env, ts);
            if (r.mask) {
              bounceFx(r.mask, pk);
              if (r.mask & HIT_FRAME && Math.hypot(pk.vx, pk.vy) > 55) emit(1, pk.x, pk.y < H / 2 ? 0 : H, 0);
            }
            if (r.goal) { scoreGoal(r.goal, 'puck', pk); if (phase !== 'play') break; }
          }
          if (phase !== 'play') break;
        }
      }
      if (phase === 'play') {
        for (const pk of ON) if (pk.on) stallTick(pk, n * DT);
        if (phase === 'play') slowCheck(now);
      }
    }
    function finishMatch() {
      phase = 'over';
      const mr = matchResult(api.data(), { winner, score, deficit: maxDef[winner] });
      api.setData(mr.patch);
      result = {
        winner,
        score: { a: score.a, b: score.b },
        sub: rivalryLine({ names: { a: api.name('a'), b: api.name('b') }, winner, score, tableName: table.name, comeback: mr.comeback, deficit: maxDef[winner], streak: mr.streak, shutout: mr.shutout, newStreakBest: mr.newStreakBest }),
      };
      publishSoon();
      api.finish(result);
    }
    /** The host picks GO (or a test does): lock in the table and start the first countdown. */
    function startMatch(pick) {
      if (!host || phase !== 'setup') return;
      if (pick) sel = pick;
      let id = sel;
      if (id === 'surprise') id = TABLE_ORDER[Math.floor(Math.random() * TABLE_ORDER.length)];
      applyTable(id);
      api.setData({ hockey_last: sel });
      setup.hide();
      score.a = 0; score.b = 0; goals = 0; winner = null; maxDef.a = 0; maxDef.b = 0;
      api.setScore(score);
      setGoals(env, score);
      serveTo = Math.random() < 0.5 ? 'a' : 'b';
      startCount(serveTo);
      phaseEnd = performance.now() + COUNT_MS + 400;
      emit(7, W / 2, H / 2, 0);
    }
    function applyTable(id) {
      setTable(tableOf(id));
      env = newEnv(table, score);
      gd.a = env.ghA; gd.b = env.ghB;
      placePucks(serveTo);
    }

    // ── guest: prediction ──
    let HS = null;              // latest host state
    let staleKey = null;        // a finished game's host state still in presence after a rematch
    let lastN = -1;
    // dp: the predicted puck (stepped locally). ox/oy + ovx/ovy: the display correction (a critically damped spring that dies away in ~140 ms,
    // so a new host state never makes the puck jump or change speed abruptly). rx/ry: where it was drawn last.
    const mkG = (i) => ({ dp: { i, x: W / 2, y: H / 2, px: W / 2, py: H / 2, vx: 0, vy: 0 }, ox: 0, oy: 0, ovx: 0, ovy: 0, rx: W / 2, ry: H / 2, on: true, ep: -1, sk: 0, ov: null });
    const G = [mkG(0), mkG(1)];   // displayed (predicted) pucks and their display corrections (decay to 0)
    const hostM = { who: 'a', x: W / 2, y: H - 22, vx: 0, vy: 0 };   // the host's mallet as drawn (interpolated between two samples)
    const hostC = { who: 'a', x: W / 2, y: H - 22, vx: 0, vy: 0 };   // ... and where the puck prediction collides with it (a little ahead of the drawn one)
    const GMS = [M[me], hostC];
    const rem = {};             // net.remoteInto target: the host's state interpolated at now - PARTNER_DELAY (allocation-free)
    if (net) net.delay = PARTNER_DELAY;
    // The host's match as last seen in progress. Mirrored in our presence, so a host that
    // reloads or closes and reopens the game picks the score back up instead of restarting 0–0.
    let keep = null;            // { k, s: [a, b], g, ph, tb }
    let hostAway = false;

    function hostAge(S, now) {
      return net && net.synced ? net.now() - S.__t : now - S.recv + 40;
    }
    function extrapolate(S, a, now) {
      const p = { i: 0, x: a[0], y: a[1], px: a[0], py: a[1], vx: a[2], vy: a[3] };
      const lead = clamp(S.gl || 60, 15, 160);
      // the host's puck waits out its hit-stop (hz ms left when it sent this), so the guess only moves for the rest of the time
      const steps = Math.round(clamp(hostAge(S, now) + lead - (S.hz || 0), 0, 280) / (DT * 1000));
      const ms = [{ ...M[me] }, { ...hostC }];
      const sts = S.ts || 1;
      extrap = true;
      for (let i = 0; i < steps; i++) { const r = stepPuck(p, ms, guestHit, true, env, sts); if (r.mask) bounceFx(r.mask & ~HIT_FRAME, p); }
      extrap = false;
      p.px = p.x; p.py = p.y;
      return p;
    }
    function guestHit(m, imp, p) {
      if (m.who !== me) return;
      const now = performance.now();
      if (!HS || now - lastHitAt[me] < 90) return;
      lastHitAt[me] = now;
      const g = G[p.i] || G[0];
      g.ov = { hb: HS.h[1], until: now + clamp((net ? net.rtt : 80) + 160, 200, 450) };
      if (env.power && HS.lh !== me) { const r = boostOf((HS.ry || 0) + 1) / boostOf(HS.ry || 0); p.vx *= r; p.vy *= r; }
      hitFx(imp);
      if (extrap) return;
      if (imp >= 14) { const dx = p.x - m.x; const dy = p.y - m.y; const d = Math.hypot(dx, dy) || 1; squash(p.i, dx / d, dy / d, clamp(imp / 190, 0.3, 1)); }
      hardHit(imp);
    }
    function onHostState(S) {
      if (!S || !Array.isArray(S.pk) || S.k === staleKey) return;
      if (HS && S.k === HS.k && S.n <= lastN) return;
      const now = performance.now();
      const prev = HS && HS.k === S.k ? HS : null;
      lastN = S.n;
      HS = { ...S, recv: now };
      // A fresh host mount (new key, fewer goals) hasn't picked our score up yet: keep reporting it.
      if (!keep || S.k === keep.k || (S.g || 0) >= keep.g || S.res) keep = { k: S.k, s: [S.s[0], S.s[1]], g: S.g || 0, ph: S.res ? 'over' : S.ph, tb: S.tb };
      // which table
      const tid = TABLES[S.tb] ? S.tb : null;
      if (tid && (tid !== table.id)) { setTable(tableOf(tid)); env = newEnv(table, score); gd.a = env.ghA; gd.b = env.ghB; }
      if (S.ph === 'setup') { sel = S.tb; setup.select(S.tb); }
      // hit-stop: a host that streams hz freezes on hard hits and goals; hold our own copy of the world for the same moment
      if (typeof S.hz === 'number') {
        hostFreezes = true;
        if (S.hz > 0 && !reduced) { const left = S.hz - hostAge(S, now) - clamp(S.gl || 60, 15, 160); if (left > 0) gStop = Math.max(gStop, now + Math.min(left, STOP_MAX + 20)); }
      }
      // events (once each, in order; a late joiner skips the old ones)
      if (Array.isArray(S.ev)) {
        for (const e of S.ev) if (e[0] > lastEv) { if (lastEv >= 0 || prev) runEvent(e[1], e[2], e[3], e[4]); lastEv = e[0]; }
      }
      if (prev) {
        if (S.g > prev.g && S.sc) goalFx(S.sc, G[0].rx);
        if (S.h[0] > prev.h[0] && (S.hv || 0) >= HIT_FX) {
          api.sfx('hit');
          // the host hit it: squash the puck nearest its mallet along the way it flew off, shake if it was hard
          let bi = 0; let bd = 1e9;
          for (let i = 0; i < table.pucks; i++) { const d = Math.hypot(G[i].dp.x - hostM.x, G[i].dp.y - hostM.y); if (d < bd) { bd = d; bi = i; } }
          const a = S.pk[bi]; if (a) { const d = Math.hypot(a[2], a[3]) || 1; squash(bi, -a[2] / d, -a[3] / d, clamp((S.hv || 0) / 190, 0.3, 1)); }
          if ((S.hv || 0) >= HARD_HIT) shake(1.6 + clamp(((S.hv || 0) - HARD_HIT) / 90, 0, 1.4), 170);
        }
      }
      if (score.a !== S.s[0] || score.b !== S.s[1] || !prev) { score.a = S.s[0]; score.b = S.s[1]; api.setScore(score); setGoals(env, score); }
      phase = S.ph; ts = S.ts || 1; rally = S.ry || 0; lastHitter = S.lh || null;
      if (S.ry && (!prev || S.ry !== prev.ry)) rallyAt = now;
      S.pk.forEach((a, i) => {
        if (i >= table.pucks) return;
        const g = G[i];
        const wasOn = g.on && g.ep === a[5];
        g.on = !!a[4]; g.sk = a[6] || 0;
        if (!g.on) { g.ep = a[5]; return; }
        if (S.ph === 'play') {
          if (g.ov && S.h[1] <= g.ov.hb && now < g.ov.until) { g.ep = a[5]; return; } // keep our predicted hit
          g.ov = null;
          // what is on screen right now (blended step, plus the correction still to go) and how fast it is moving
          const sx = g.rx; const sy = g.ry;
          const svx = g.dp.vx + g.ovx; const svy = g.dp.vy + g.ovy;
          const ext = extrapolate(S, a, now);
          const ex = sx - ext.x; const ey = sy - ext.y;
          Object.assign(g.dp, ext, { i });
          // Blend, never snap: only a reset (new epoch / phase change) or a huge error jumps. The picture keeps its position AND its
          // velocity across the new state; the spring then walks the difference out (so the puck never kinks or jumps).
          if (prev && prev.ph === 'play' && wasOn && Math.hypot(ex, ey) < 160) { g.ox = ex; g.oy = ey; g.ovx = svx - ext.vx; g.ovy = svy - ext.vy; } else { g.ox = 0; g.oy = 0; g.ovx = 0; g.ovy = 0; g.rx = ext.x; g.ry = ext.y; trails[i].n = 0; }
        } else {
          Object.assign(g.dp, { x: a[0], y: a[1], px: a[0], py: a[1], vx: 0, vy: 0, i });
          g.ox = 0; g.oy = 0; g.ovx = 0; g.ovy = 0; g.ov = null; g.rx = a[0]; g.ry = a[1];
        }
        g.ep = a[5];
      });
    }
    function guestUpdate(dt, now, dtm) {
      const S = HS;
      // The host's mallet: the host's stream interpolated 75 ms behind the newest sample (smooth, never a guess).
      // Before the clock is synced, the old way: extrapolate the last sample a little, then ease toward it.
      if (S) {
        const r = net && net.synced ? net.remoteInto(rem) : null;
        if (r && Array.isArray(r.m) && r.m.length > 3) {
          hostM.x = r.m[0]; hostM.y = r.m[1]; hostM.vx = r.m[2]; hostM.vy = r.m[3];
        } else {
          const age = clamp(hostAge(S, now), 0, 70) / 1000;
          const tx = S.m[0] + S.m[2] * age; const ty = S.m[1] + S.m[3] * age;
          const k = 1 - Math.exp(-dt / 0.045);
          hostM.x += (tx - hostM.x) * k; hostM.y += (ty - hostM.y) * k;
          hostM.vx = S.m[2]; hostM.vy = S.m[3];
        }
        clampMallet(hostM, env);
        M.a.px = M.a.x = M.a.rx = hostM.x; M.a.py = M.a.y = M.a.ry = hostM.y;
        // the puck prediction collides with where the mallet is about to be, not where it was drawn
        const ld = net && net.synced ? PARTNER_DELAY / 1000 : 0;
        hostC.x = hostM.x + hostM.vx * ld; hostC.y = hostM.y + hostM.vy * ld; hostC.vx = hostM.vx; hostC.vy = hostM.vy;
        clampMallet(hostC, env);
      }
      const held = hostFreezes && now < gStop;   // hit-stop: the clock waits, the mallet waits with it
      acc += held ? 0 : dt; macc += dtm;
      let n = Math.floor(acc / DT);
      if (n > 14) { n = 14; acc = 0; } else acc -= n * DT;
      const m = M[me];
      const live = S && S.ph === 'play' && !hostAway;
      if (n) {
        const rdt = clamp(macc, DT, 0.1); macc = 0;
        trackHand(m, rdt);
        m.sx = m.x; m.sy = m.y;
        let dx = phase === 'setup' ? 0 : m.tx - m.x; let dy = phase === 'setup' ? 0 : m.ty - m.y;
        const maxd = MALLET_MAX * rdt; const d = Math.hypot(dx, dy);
        if (d > maxd) { dx *= maxd / d; dy *= maxd / d; }
        smoothVel(m, dx, dy, rdt);
        for (let i = 1; i <= n; i++) {
          if (live && hostFreezes && now < gStop) { m.px = m.x; m.py = m.y; for (let j = 0; j < table.pucks; j++) { G[j].dp.px = G[j].dp.x; G[j].dp.py = G[j].dp.y; } break; } // our own hard hit just landed
          const nx = m.sx + (dx * i) / n; const ny = m.sy + (dy * i) / n;
          m.px = m.x; m.py = m.y;
          m.vx = m.wvx; m.vy = m.wvy; m.x = nx; m.y = ny;
          clampMallet(m, env);
          capToHand(m);
          if (live) for (let j = 0; j < table.pucks; j++) { const g = G[j]; if (g.on) { g.dp.px = g.dp.x; g.dp.py = g.dp.y; const r = stepPuck(g.dp, GMS, guestHit, true, env, ts); if (r.mask) bounceFx(r.mask & ~HIT_FRAME, g.dp); } }
        }
      }
      // close the display corrections: a critically damped spring (exact solution), ~140 ms to 95 %. Its velocity starts where the
      // picture was already going, so there is no kick when a host state lands; capped at CORRECT_RATE so a big error never looks like a teleport.
      if (!held) {
        const e = Math.exp(-CORRECT_W * dt);
        for (const g of G) {
          if (!g.ox && !g.oy && !g.ovx && !g.ovy) continue;
          if (Math.abs(g.ox) + Math.abs(g.oy) + Math.abs(g.ovx) + Math.abs(g.ovy) < 0.02) { g.ox = 0; g.oy = 0; g.ovx = 0; g.ovy = 0; continue; }
          let j = g.ovx + CORRECT_W * g.ox; const nx = (g.ox + j * dt) * e; const nvx = (g.ovx - j * CORRECT_W * dt) * e;
          j = g.ovy + CORRECT_W * g.oy; const ny = (g.oy + j * dt) * e; const nvy = (g.ovy - j * CORRECT_W * dt) * e;
          g.ox = nx; g.oy = ny; g.ovx = nvx; g.ovy = nvy;
          const sp = Math.hypot(g.ovx, g.ovy);
          if (sp > CORRECT_RATE) { g.ovx *= CORRECT_RATE / sp; g.ovy *= CORRECT_RATE / sp; }
        }
      }
    }

    // ── network ──
    let lastPub = 0;
    let pubSoon = false;
    let lastHv = 0;
    let gs = null;              // guest mallet sample on the host { x, y, t, at }
    let gv = { x: 0, y: 0 };
    const goff = { x: 0, y: 0 };  // the shown guest mallet target minus the newest sample: decays to 0
    let gk = null; let gn = -1;
    let glag = 0;
    let partnerAway = false;    // partner's tab is hidden
    let myN = 0;
    function publishSoon() { pubSoon = true; }
    function hostState() {
      return {
        k: key, ph: phase, tb: phase === 'setup' ? sel : table.id,
        cd: phase === 'count' || phase === 'goal' ? Math.max(0, Math.round(phaseEnd - performance.now())) : 0,
        pk: pucksOn().map((p) => [r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.on ? 1 : 0, p.ep, p.sk | 0]),
        m: [r1(M.a.x), r1(M.a.y), r1(M.a.vx), r1(M.a.vy)],
        s: [score.a, score.b], g: goals, sc: lastScorer, h: [hits.a, hits.b], hv: Math.round(lastHv),
        ry: rally, lh: lastHitter, ts: Math.round(ts * 100) / 100,
        ev: evq, hz: Math.max(0, Math.round(stopUntil - performance.now())),
        gl: Math.round(glag), res: result, away: document.hidden ? 1 : 0,
      };
    }
    let lastSent = '';
    function publish(now) {
      if (local) return;
      const due = now - lastPub >= 1000 / RATE - 2;
      if (!due && !(pubSoon && now - lastPub > 15)) return;
      if (host) {
        const st = hostState();
        const body = JSON.stringify(st);
        if (body === lastSent && now - lastPub < 500 && !pubSoon) return; // nothing moved: don't spend the message budget
        lastSent = body;
        api.setPresence({ ...st, n: ++myN, __t: Math.round(net.now()) });
      } else {
        const m = M[me];
        const body = `${r1(m.x)},${r1(m.y)}`;
        if (body === lastSent && now - lastPub < 400 && !pubSoon) return;
        lastSent = body;
        api.setPresence({ k: key, n: ++myN, __t: Math.round(net.now()), sy: net.synced ? 1 : 0, m: [r1(m.x), r1(m.y)], away: document.hidden ? 1 : 0, ...keepState() });
      }
      lastPub = now; pubSoon = false;
    }
    const keepState = () => (keep ? { hk: keep.k, hs: keep.s, hg: keep.g, hph: keep.ph, htb: keep.tb } : {});
    // Host: we were reloaded or reopened mid-match. The guest still remembers our old game's
    // table and score; carry on from them (only right after mounting, and only if nothing has happened here yet).
    let adopted = false;
    function adoptMatch(st) {
      if (adopted || !st || typeof st.hk !== 'string' || st.hk === key || st.hph === 'over' || !Array.isArray(st.hs)) return;
      adopted = true;
      if (goals > 0 || winner || phase === 'over' || performance.now() - t0 > 6000) return;
      if (st.hph === 'setup') return; // they were still picking: we pick again
      if (TABLES[st.htb]) { sel = st.htb; if (phase === 'setup') { applyTable(st.htb); setup.hide(); setup.select(sel); serveTo = Math.random() < 0.5 ? 'a' : 'b'; startCount(serveTo); phaseEnd = performance.now() + COUNT_MS + 400; } }
      const a0 = clamp(st.hs[0] | 0, 0, table.toWin); const b0 = clamp(st.hs[1] | 0, 0, table.toWin);
      if (!a0 && !b0) return;
      score.a = a0; score.b = b0;
      goals = Math.max(st.hg | 0, a0 + b0);
      setGoals(env, score); gd.a = env.ghA; gd.b = env.ghB;
      for (const p of ['a', 'b']) maxDef[p] = Math.max(maxDef[p], score[other(p)] - score[p]);
      const w = a0 >= table.toWin ? 'a' : b0 >= table.toWin ? 'b' : null;
      if (w) { winner = w; lastScorer = w; phase = 'goal'; phaseEnd = performance.now() + 400; }
      api.setScore(score);
      publishSoon();
    }
    function onGuestState(st) {
      if (!st) return;
      adoptMatch(st);
      if (st.k === gk && st.n <= gn) return;
      const fresh = st.k !== gk;
      gk = st.k; gn = st.n;
      const away = !!st.away;
      if (away !== partnerAway) { partnerAway = away; updatePause(); }
      if (!Array.isArray(st.m)) return;
      const now = performance.now();
      const [x, y] = clampTarget('b', st.m[0], st.m[1], env);
      if (gs && !fresh && st.__t > gs.t) {
        const dts = clamp((st.__t - gs.t) / 1000, 0.012, 0.25);
        const vx = (x - gs.x) / dts; const vy = (y - gs.y) / dts;
        if (x === gs.x && y === gs.y) gv = { x: 0, y: 0 }; // the same spot again (the resting heartbeat): it has stopped, no stale speed left to extrapolate
        else gv = { x: gv.x * 0.35 + vx * 0.65, y: gv.y * 0.35 + vy * 0.65 };
      } else gv = { x: 0, y: 0 };
      if (st.sy) { const lag = net.now() - st.__t; if (lag >= 0 && lag < 1000) glag = glag ? glag * 0.85 + lag * 0.15 : lag; }
      // Carry on from where the shown target was and let the difference die away (never a jump of the mallet,
      // so its speed at a hit is the guest's finger speed, not the catch-up between two samples).
      if (gs && !fresh) { const ex = M.b.tx - x; const ey = M.b.ty - y; if (ex * ex + ey * ey < 900) { goff.x = ex; goff.y = ey; } else { goff.x = 0; goff.y = 0; } } else { goff.x = 0; goff.y = 0; }
      gs = { x, y, t: st.__t, at: now };
    }
    function remoteTarget(now, dt) {
      if (!gs) return;
      const age = (now - gs.at) / 1000;
      if (age > REMOTE_STALE) { const f = Math.exp(-dt / 0.06); gv.x *= f; gv.y *= f; }
      const e = Math.min(age, REMOTE_LEAD);
      const k = Math.exp(-dt / REMOTE_BLEND);
      goff.x *= k; goff.y *= k;
      const [x, y] = clampTarget('b', gs.x + gv.x * e + goff.x, gs.y + gv.y * e + goff.y, env);
      M.b.tx = x; M.b.ty = y;
    }

    // ── pausing: partner gone, partner's tab hidden, or ours hidden ──
    let partnerHere = local || api.partnerHere;
    function updatePause() {
      if (!host || phase === 'over' || phase === 'setup') return;
      const why = document.hidden ? 'hidden' : !local && (!partnerHere || partnerAway) ? 'away' : null;
      if (why && phase !== 'paused') {
        pausedFor = { phase, left: phaseEnd - performance.now() };
        phase = 'paused';
        publishSoon();
      } else if (!why && phase === 'paused') {
        const was = pausedFor; pausedFor = null;
        if (was && was.phase === 'goal') { phase = 'goal'; phaseEnd = performance.now() + Math.max(200, was.left); }
        else { resumeSlow = was && was.phase === 'play'; startCount(was && was.phase === 'count' ? serveTo : null); }
        publishSoon();
      }
    }

    // ── the table picker ──
    const setup = createSetup(root, {
      chooser: host,
      hostName: api.name('a'),
      onPick(id) {
        if (!host) return;
        sel = id; api.sfx('tap');
        if (TABLES[id]) { applyTable(id); }
        setup.setRecords(recordsHTML());
        publishSoon();
      },
      onGo() { api.sfx('place'); startMatch(); },
    });
    function recordsHTML() {
      const r = readRecords(api.data());
      const bits = [];
      if (r.rallyBest) bits.push(`Longest rally <b>${r.rallyBest}</b>${r.rallyWho ? ` (${esc(api.name(r.rallyWho))})` : ''}`);
      if (r.fastMs) bits.push(`Fastest goal <b>${(r.fastMs / 1000).toFixed(1)} s</b>${r.fastWho ? ` (${esc(api.name(r.fastWho))})` : ''}`);
      if (r.streakWho && r.streakN > 1) bits.push(`${esc(api.name(r.streakWho))} is on a <b>${r.streakN}</b>-match streak`);
      return bits.join(' · ');
    }
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    setup.select(sel);
    setup.setRecords(recordsHTML());
    if (phase === 'setup' || !host) setup.show();
    if (host) placePucks(serveTo);

    // ── input handlers ──
    // The table's top-left on screen is cached: layout() sets it (ResizeObserver) and a new finger refreshes it. Reading the
    // rect on every pointermove forced a layout each time; the shake offset is subtracted, so a moving rig doesn't shift the aim.
    let cvL = 0; let cvT = 0;
    function readRect() { const r = rig.getBoundingClientRect(); cvL = r.left - shakeX; cvT = r.top - shakeY; }
    function canonFromEvent(e) {
      return fromPx(e.clientX - cvL, e.clientY - cvT);
    }
    /** The controlling finger moved: steer who's mallet. */
    function aim(who, e) {
      const [x, y] = canonFromEvent(e);
      const [tx, ty] = clampTarget(who, x, y, env);
      steer(who, tx, ty);
    }
    function steer(who, tx, ty) {
      const c = ctl[who]; const m = M[who];
      c.fx = tx; c.fy = ty;
      if (!c.glide) { m.tx = tx; m.ty = ty; }
      c.kvx = 0; c.kvy = 0; c.used = true;
    }
    function onDown(e) {
      if (e.pointerType !== 'mouse' && e.clientX < EDGE) return; // iOS back-swipe zone
      e.preventDefault();
      if (phase === 'setup') return;
      readRect();
      let who;
      if (local) { const [, y] = canonFromEvent(e); who = y >= H / 2 ? 'a' : 'b'; } else who = me;
      const c = ctl[who];
      ptrs.set(e.pointerId, who);
      pressAt[who] = performance.now();
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic pointers can't be captured */ }
      const [x, y] = canonFromEvent(e);
      c.pos.set(e.pointerId, clampTarget(who, x, y, env));
      c.q.push(e.pointerId);
      if (c.q.length === 1) { c.glide = false; aim(who, e); api.sfx('tap'); }
    }
    function onMove(e) {
      const who = ptrs.get(e.pointerId);
      if (who) {
        const c = ctl[who];
        const [x, y] = canonFromEvent(e);
        c.pos.set(e.pointerId, clampTarget(who, x, y, env));
        if (c.q[0] === e.pointerId) aim(who, e);
        return;
      }
      if (!local && e.pointerType === 'mouse' && phase !== 'setup') aim(me, e); // on a computer the mouse just drives your mallet
    }
    function onUp(e) {
      const who = ptrs.get(e.pointerId);
      if (!who) return;
      ptrs.delete(e.pointerId);
      const c = ctl[who];
      const wasFirst = c.q[0] === e.pointerId;
      c.q = c.q.filter((id) => id !== e.pointerId);
      c.pos.delete(e.pointerId);
      try { cv.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (wasFirst && c.q.length) { // control passes to the next finger on this half: slide there, don't slam
        const [tx, ty] = c.pos.get(c.q[0]);
        c.fx = tx; c.fy = ty; c.glide = true;
      }
    }
    function glideDrive(dt) {
      for (const w of mine) {
        const c = ctl[w]; const m = M[w];
        if (!c.glide) continue;
        if (c.q.length) { const p = c.pos.get(c.q[0]); if (p) { c.fx = p[0]; c.fy = p[1]; } }
        const dx = c.fx - m.tx; const dy = c.fy - m.ty; const d = Math.hypot(dx, dy); const step = GLIDE_V * dt;
        if (d <= step) { m.tx = c.fx; m.ty = c.fy; c.glide = false; } else { m.tx += (dx / d) * step; m.ty += (dy / d) * step; }
      }
    }
    const stopTouch = (e) => { if (e.cancelable) e.preventDefault(); };
    const KEYS = {
      KeyW: ['a', 'up'], KeyA: ['a', 'left'], KeyS: ['a', 'down'], KeyD: ['a', 'right'],
      ArrowUp: ['b', 'up'], ArrowLeft: ['b', 'left'], ArrowDown: ['b', 'down'], ArrowRight: ['b', 'right'],
    };
    function keyOf(e) {
      const k = KEYS[e.code] || KEYS[e.key];
      if (!k) return null;
      return [local ? k[0] : me, k[1]];
    }
    function onKey(e) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!root.isConnected || el.closest('[hidden]')) return;
      if (e.type === 'keydown' && phase === 'setup' && host && (e.key === 'Enter' || (e.key === ' ' && !(t && t.tagName === 'BUTTON'))) && !(t && t.classList && t.classList.contains('hk-go'))) { e.preventDefault(); startMatch(); return; }
      const k = keyOf(e);
      if (!k) return;
      if (phase === 'setup') return;
      e.preventDefault();
      const c = ctl[k[0]];
      if (e.type === 'keydown') { c.keys.add(k[1]); c.used = true; } else c.keys.delete(k[1]);
    }
    function onBlur() { for (const w of ['a', 'b']) ctl[w].keys.clear(); }
    function keyDrive(dt) {
      for (const w of mine) {
        const c = ctl[w]; const m = M[w];
        let su = (c.keys.has('right') ? 1 : 0) - (c.keys.has('left') ? 1 : 0);
        let sv = (c.keys.has('down') ? 1 : 0) - (c.keys.has('up') ? 1 : 0);
        const l = Math.hypot(su, sv); if (l) { su /= l; sv /= l; }
        const [dx, dy] = screenToTable(su, sv);
        const k = 1 - Math.exp(-KEY_ACC * dt);
        c.kvx += (dx * KEY_V - c.kvx) * k; c.kvy += (dy * KEY_V - c.kvy) * k;
        if (Math.abs(c.kvx) < 0.3 && Math.abs(c.kvy) < 0.3 && !l) { c.kvx = 0; c.kvy = 0; continue; }
        const [tx, ty] = clampTarget(w, m.tx + c.kvx * dt, m.ty + c.kvy * dt, env);
        if (tx !== m.tx + c.kvx * dt) c.kvx = 0;
        if (ty !== m.ty + c.kvy * dt) c.kvy = 0;
        m.tx = tx; m.ty = ty;
      }
    }

    // ── drawing ──
    // Per frame the live canvas only blits cached sprites (mallets, pucks, splat) and draws a few strokes; the table, the grain and the
    // scoreboard text live in their own layers (see layout / drawTable / paintHud).
    const projX = (x, y) => (view === 'up' ? ox + x * s : view === 'down' ? ox + (W - x) * s : view === 'sideb' ? ox + y * s : ox + (H - y) * s);
    const projY = (x, y) => (view === 'up' ? oy + y * s : view === 'down' ? oy + (H - y) * s : view === 'sideb' ? oy + (W - x) * s : oy + x * s);
    function disc(c, x, y, r, fill, stroke, lw) {
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
    }
    const spr = { m: {}, p: [], s: {} };   // sprites, rebuilt with the table (resize, theme)
    function buildSprites() {
      spr.m.a = malletSprite(T, 'a', s, dpr); spr.m.b = malletSprite(T, 'b', s, dpr);
      spr.p[0] = puckSprite(T, 0, s, dpr); spr.p[1] = puckSprite(T, 1, s, dpr);
      spr.s.a = splatSprite(T, 'a', s, dpr); spr.s.b = splatSprite(T, 'b', s, dpr);
    }
    function drawMallet(w, now) {
      const m = M[w]; const sp = spr.m[w];
      const X = projX(m.rx, m.ry); const Y = projY(m.rx, m.ry);
      const k = reduced ? 0 : Math.max(0, 1 - (now - pressAt[w]) / 170);
      const h = sp.half * (1 + 0.16 * k * k); // a finger just came down: the mallet pops up and settles
      cx.drawImage(sp.cv, X - h, Y - h, h * 2, h * 2);
    }
    function heatColour(h, now) {
      const pulse = 0.5 + 0.5 * Math.sin(now / (170 - 110 * h));
      return { col: h > 0.55 ? T.bad : T.hl, a: reduced ? 0.8 : 0.45 + 0.55 * pulse };
    }
    function drawPuck(i, pk, heat, now) {
      const c = cx; const sp = spr.p[i]; const h = sp.body.half;
      const X = projX(pk.rx, pk.ry); const Y = projY(pk.rx, pk.ry);
      c.drawImage(sp.shadow.cv, X - h, Y - h, h * 2, h * 2);
      if (heat > 0.05) { const hc = heatColour(heat, now); c.globalAlpha = hc.a; disc(c, X, Y, RP * s * (1.25 + 0.35 * heat), null, hc.col, Math.max(2, s * (0.5 + 0.9 * heat))); c.globalAlpha = 1; }
      const age = now - sqAt[i];
      const k = age < 130 ? sqA[i] * (1 - age / 130) * (1 - age / 130) : 0; // squash along the hit normal, then spring back
      if (k > 0.03) {
        const nx = sqNx[i]; const ny = sqNy[i];
        const ang = view === 'up' ? Math.atan2(ny, nx) : view === 'down' ? Math.atan2(-ny, -nx) : view === 'sideb' ? Math.atan2(-nx, ny) : Math.atan2(nx, -ny);
        c.save(); c.translate(X, Y); c.rotate(ang); c.scale(1 - 0.3 * k, 1 + 0.2 * k);
        c.drawImage(sp.body.cv, -h, -h, h * 2, h * 2);
        c.restore();
      } else c.drawImage(sp.body.cv, X - h, Y - h, h * 2, h * 2);
    }
    let misOn = false;          // print a text with its pink and blue plates a hair off register
    function text(c, str, x, y, size, fill, rot = 0, stroke = null, weight = 900, font = T.fontDisplay, maxW = 0, align = 'center') {
      c.save(); c.translate(x, y); c.rotate(rot);
      c.font = `${weight} ${size}px ${font || 'system-ui'}`;
      if (maxW) { const w = c.measureText(str).width; if (w > maxW) { size *= maxW / w; c.font = `${weight} ${size}px ${font || 'system-ui'}`; } }
      c.textAlign = align; c.textBaseline = 'middle';
      if (stroke) {
        c.lineJoin = 'round'; const lw = Math.max(2, size * 0.09);
        if (misOn && size >= 12) { // the two colour plates, a hair off the black key plate
          c.lineWidth = lw + size * 0.035;
          c.globalAlpha *= 0.8; c.strokeStyle = T.b; c.strokeText(str, size * 0.035, size * 0.025);
          c.strokeStyle = T.a; c.strokeText(str, -size * 0.028, -size * 0.016);
          c.globalAlpha /= 0.8;
        }
        c.lineWidth = lw; c.strokeStyle = stroke; c.strokeText(str, 0, 0);
      }
      c.fillStyle = fill; c.fillText(str, misOn && stroke && size >= 12 ? size * 0.012 : 0, misOn && stroke && size >= 12 ? size * 0.008 : 0);
      c.restore();
    }
    function keycap(c, x, y, sz, glyph) {
      const r = sz * 0.2;
      c.fillStyle = T.edge; roundRect(c, x - sz / 2 + 2, y - sz / 2 + 2, sz, sz, r); c.fill();
      c.fillStyle = T.card; c.strokeStyle = T.ink; c.lineWidth = 1.5;
      roundRect(c, x - sz / 2, y - sz / 2, sz, sz, r); c.fill(); c.stroke();
      c.fillStyle = T.ink;
      if (glyph.length === 1) { text(c, glyph, x, y + 0.5, sz * 0.5, T.ink, 0, null, 800); return; }
      const a = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 }[glyph];
      c.save(); c.translate(x, y); c.rotate(a); c.beginPath();
      c.moveTo(sz * 0.2, 0); c.lineTo(-sz * 0.13, -sz * 0.18); c.lineTo(-sz * 0.13, sz * 0.18); c.closePath(); c.fill(); c.restore();
    }
    function legend(c, w, x, y, alpha) {
      const sz = 24; const g = 4;
      const keys = w === 'a' ? ['W', 'A', 'S', 'D'] : ['up', 'left', 'down', 'right'];
      c.globalAlpha = alpha;
      text(c, api.name(w), x, y - sz * 1.55, 13, T[w + 'Text'], 0, null, 800, T.fontBody);
      keycap(c, x, y - (sz + g) / 2, sz, keys[0]);
      for (let i = 0; i < 3; i++) keycap(c, x + (i - 1) * (sz + g), y + (sz + g) / 2, sz, keys[i + 1]);
      c.globalAlpha = 1;
    }

    // Comic-book speed lines behind a fast puck: crisp ink strokes, no blur. On the Power Puck the
    // lines heat up (yellow, then red) and pulse.
    const SL = [[-0.62, 0.6], [0, 1], [0.62, 0.75]];
    function speedLines(c, pk, tr, heat, now) {
      const hx = projX(pk.rx, pk.ry); const hy = projY(pk.rx, pk.ry);
      const ox0 = projX(tr.x[0], tr.y[0]); const oy0 = projY(tr.x[0], tr.y[0]);
      let dx = hx - ox0; let dy = hy - oy0;
      const len = Math.hypot(dx, dy);
      if (len < RP * s * 0.9) return;
      dx /= len; dy /= len;
      const nx = -dy; const ny = dx; const r = RP * s;
      const L = Math.min(len * 1.3, r * (4.5 + 3 * heat));
      c.lineCap = 'round';
      const hot = heat > 0.05 ? heatColour(heat, now) : null;
      for (let pass = 0; pass < (hot ? 2 : 1); pass++) {
        c.strokeStyle = pass ? hot.col : T.ink; c.globalAlpha = pass ? hot.a : 1;
        c.lineWidth = pass ? Math.max(1, s * 0.25) : Math.max(1.5, s * 0.45) + (hot ? s * 0.4 : 0);
        c.beginPath();
        for (let q = 0; q < 3; q++) {
          const o = SL[q][0]; const f = SL[q][1];
          const sx = hx - dx * r * 1.25 + nx * o * r; const sy = hy - dy * r * 1.25 + ny * o * r;
          c.moveTo(sx, sy); c.lineTo(sx - dx * L * f, sy - dy * L * f);
        }
        c.stroke();
      }
      c.globalAlpha = 1;
    }
    /** goal mouths (they can shrink) and the Pillar, drawn in table units over the printed table */
    function drawLive(c, now, dt) {
      tableT(c);
      const inkW = px(2.5);
      for (let q = 0; q < 2; q++) {
        const w = q ? 'a' : 'b'; const y0 = q ? H : 0;
        const target = q ? env.ghA : env.ghB;
        gd[w] += (target - gd[w]) * (reduced ? 1 : 1 - Math.exp(-dt * 8));
        if (Math.abs(target - gd[w]) < 0.02) gd[w] = target;
        const gh = gd[w];
        const outer = q ? H + RAIL : -RAIL;
        c.fillStyle = T.edge; c.fillRect(W / 2 - gh, q ? H : -RAIL - 0.5, gh * 2, RAIL + 0.5);
        c.fillStyle = T[w]; c.fillRect(W / 2 - gh, q ? H : -px(4), gh * 2, px(4));
        c.strokeStyle = T.ink; c.lineWidth = inkW; line(c, W / 2 - gh, outer, W / 2 + gh, outer);
        c.fillStyle = T.card; c.strokeStyle = T.ink; c.lineWidth = px(2);
        c.beginPath(); c.arc(W / 2 - gh, y0, 1.6, 0, Math.PI * 2); c.fill(); c.stroke();
        c.beginPath(); c.arc(W / 2 + gh, y0, 1.6, 0, Math.PI * 2); c.fill(); c.stroke();
      }
      if (env.post) {
        const pulse = reduced ? 0 : Math.max(0, 1 - (now - pillarAt) / 220);
        const r = POST_R * (1 + 0.14 * pulse);
        c.fillStyle = T.edge; c.beginPath(); c.arc(W / 2 + 1.3, H / 2 + 1.8, r, 0, Math.PI * 2); c.fill();
        c.fillStyle = T.card; c.strokeStyle = T.ink; c.lineWidth = px(2.5); c.beginPath(); c.arc(W / 2, H / 2, r, 0, Math.PI * 2); c.fill(); c.stroke();
        c.fillStyle = T.hl; c.beginPath(); c.arc(W / 2, H / 2, r * 0.6, 0, Math.PI * 2); c.fill(); c.lineWidth = px(1.6); c.stroke();
        c.fillStyle = T.ink; c.beginPath(); c.arc(W / 2, H / 2, r * 0.18, 0, Math.PI * 2); c.fill();
      }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    /** a printed sticker: the stamp's colour, a hard shadow, ink outline, the colour plates a hair off register */
    function sticker(c, str, x, y, size, fill, rot, maxW) {
      text(c, str, x + size * 0.05, y + size * 0.07, size, T.edge, rot, null, 900, T.fontDisplay, maxW);
      misOn = true;
      text(c, str, x, y, size, fill, rot, T.ink, 900, T.fontDisplay, maxW);
      misOn = false;
    }
    const colOf = (k) => (k === 'a' || k === 'b' ? T[k] : k === 'hl' ? T.hl : k === 'bad' ? T.bad : k === 'good' ? T.good : T.ink);

    // ── the scoreboard layer: text is repainted only when a number (or its pop) changes ──
    const RD2 = ['a', 'b']; const RD1 = [me]; const mpList = []; const laneItems = [];
    let slowShown = 0;
    const hudSt = { a: { v: 0 }, b: { v: 0 }, sc: { v: 0 } };
    function paintHud(now) {
      hc.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (band && phase !== 'wait') { hudBand('b', now); hudBand('a', now); } else if (hudSt.a.drawn || hudSt.b.drawn) { hc.clearRect(0, 0, cssW, cssH); hudSt.a.v = hudSt.b.v = 0; hudSt.a.drawn = hudSt.b.drawn = false; }
      if (!band) hudScores();
    }
    function hudBand(w, now) {
      const g = bandRect(w);
      if (!g) return;
      const st = hudSt[w];
      const mpOn = score[w] === table.toWin - 1 && !winner;
      const flash = !reduced && fx.flashWho === w ? Math.max(0, 1 - (now - fx.flashAt) / 300) : 0;
      const rallyOn = phase === 'play' && rally > 0;
      const pop = reduced || !rallyOn ? 0 : Math.max(0, 1 - (now - rallyAt) / 200);
      const fq = Math.round(flash * 24); const pq = Math.round(pop * 24);
      const bq = mpOn && phase !== 'over' && !reduced ? Math.round(Math.sin(now / 260) * 6) : 0;
      if (st.v === hudV && st.sc === score[w] && st.ry === rally && st.ro === rallyOn && st.mp === mpOn && st.ov === (phase === 'over') && st.fq === fq && st.pq === pq && st.bq === bq && st.rb === recs.rallyBest && st.rw === recs.rallyWho) return;
      st.v = hudV; st.sc = score[w]; st.ry = rally; st.ro = rallyOn; st.mp = mpOn; st.ov = phase === 'over'; st.fq = fq; st.pq = pq; st.bq = bq; st.rb = recs.rallyBest; st.rw = recs.rallyWho; st.drawn = true;
      const pad = 3;
      hc.clearRect(g.x - pad, g.y - pad, g.w + pad * 2, g.h + pad * 2);
      drawBandText(hc, w, now);
    }
    function hudScores() {
      const st = hudSt.sc;
      if (st.v === hudV && st.a === score.a && st.b === score.b) return;
      st.v = hudV; st.a = score.a; st.b = score.b;
      hc.clearRect(0, 0, cssW, cssH);
      const ss = Math.min(64, 15 * s);
      hc.globalAlpha = 0.9; misOn = true;
      for (const w of ['a', 'b']) {
        const [x, y] = toPx(w === 'a' ? W - 14 : 14, w === 'a' ? H / 2 + 18 : H / 2 - 18);
        text(hc, String(score[w]), x, y, ss, T[w], readRot(w), T.ink);
      }
      misOn = false; hc.globalAlpha = 1;
    }

    /** blend the last two physics steps by how far into the next one the clock is (render interpolation), and project nothing yet */
    function prepRender() {
      const al = alpha;
      for (const w of RD2) {
        const m = M[w];
        if (host || w === me) { m.rx = m.px + (m.x - m.px) * al; m.ry = m.py + (m.y - m.py) * al; } else { m.rx = m.x; m.ry = m.y; }
      }
      if (host) {
        for (const pk of ON) { if (phase === 'play') { pk.rx = pk.px + (pk.x - pk.px) * al; pk.ry = pk.py + (pk.y - pk.py) * al; } else { pk.rx = pk.x; pk.ry = pk.y; } }
      } else {
        for (let i = 0; i < table.pucks; i++) {
          const g = G[i]; const d = g.dp;
          g.rx = d.px + (d.x - d.px) * al + g.ox; g.ry = d.py + (d.y - d.py) * al + g.oy;
        }
      }
    }
    const easeBack = (t) => { const c1 = 1.70158; const u = t - 1; return 1 + (c1 + 1) * u * u * u + c1 * u * u; };

    function render(now, dt) {
      const c = cx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, cssW, cssH);
      prepRender();
      const fx0 = FX; const fy0 = FY; const fw = FW; const fh = FH;
      const ccx = projX(W / 2, H / 2); const ccy = projY(W / 2, H / 2);
      const setupOn = phase === 'setup' || phase === 'wait';
      if (now - recsAt > 400) { recsAt = now; recs = readRecords(api.data()); }
      const dtR = Math.min(0.1, Math.max(0, (now - prevRender) / 1000)); prevRender = now;
      drawLive(c, now, dt);
      paintHud(now);
      // match point: the banner when the countdown starts, a small tag by the leader's score
      const mp = mpList; mp.length = 0;
      for (const w of RD2) if (score[w] === table.toWin - 1 && !winner) mp.push(w);
      if (phase !== prevPhaseR) {
        if (phase === 'count' && mp.length) { mpAt = now; snd.matchPoint(); }
        prevPhaseR = phase;
      }
      for (const w of RD2) {
        if (mp.includes(w) && !setupOn && phase !== 'count') { // (the countdown has its own banner)
          const [mx, my] = toPx(w === 'a' ? W - 14 : 14, w === 'a' ? H / 2 + 32 : H / 2 - 32);
          const bob = reduced ? 0 : Math.sin(now / 260) * 0.8;
          sticker(c, 'MATCH POINT', mx, my + bob, Math.max(8, 3.1 * s), T.hl, readRot(w), 30 * s);
        }
      }
      // the goal: an ink splat in the scorer's colour blots in at the goal mouth (the flash is a DOM opacity animation)
      const since = Math.max(0, now - fx.flashAt);
      if (fx.flashWho && since < GOAL_MS) {
        const sp = spr.s[fx.flashWho];
        const grow = reduced ? 1 : since < 240 ? easeBack(since / 240) : 1;
        const fade = reduced ? (since < GOAL_MS - 80 ? 1 : 0) : since > GOAL_MS - 380 ? (GOAL_MS - since) / 380 : 1;
        const inward = fx.splatY === 0 ? 8 : -8;
        const X = projX(fx.splatX, fx.splatY + inward); const Y = projY(fx.splatX, fx.splatY + inward);
        const hh = sp.half * Math.max(0.01, grow);
        c.globalAlpha = 0.95 * fade; c.drawImage(sp.cv, X - hh, Y - hh, hh * 2, hh * 2); c.globalAlpha = 1;
      }
      // rally counter (4+), a sticker at 8+
      if (rally >= 4 && phase === 'play') {
        const big = rally >= 8;
        const pop = reduced ? 1 : 1 + 0.35 * Math.max(0, 1 - (now - rallyAt) / 200);
        const copies = sideways() ? [[me, view === 'side' ? 12 : W - 12, H / 2]] : local && view === 'up' ? [['a', W - 17, H / 2], ['b', 17, H / 2]] : [[me, W - 17, H / 2]];
        for (const [w, x, y] of copies) {
          const [rx, ry] = toPx(x, y);
          sticker(c, big ? `RALLY ${rally}!` : `RALLY ${rally}`, rx, ry, (big ? 4.6 : 3.4) * s * pop, big ? T.hl : T.card, readRot(w) + (big ? -0.06 : 0), 30 * s);
        }
      }
      // shot clock rings
      for (let i = 0; i < table.pucks; i++) {
        const sk = host ? PK[i].sk : G[i].sk;
        const on = host ? PK[i].on : G[i].on;
        if (!on || !sk || phase !== 'play') continue;
        const pp = host ? PK[i] : G[i];
        const px0 = projX(pp.rx, pp.ry); const py0 = projY(pp.rx, pp.ry);
        const frac = Math.max(0, Math.min(1, sk / (HOG_WARN * 1000)));
        const rr = RP * s * 2.6;
        c.strokeStyle = T.bad; c.lineWidth = Math.max(2, s * 0.9); c.lineCap = 'round';
        c.beginPath(); c.arc(px0, py0, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); c.stroke();
        c.lineWidth = Math.max(1, s * 0.3); c.strokeStyle = T.ink; c.globalAlpha = 0.5; disc(c, px0, py0, rr + s * 0.9, null, T.ink, Math.max(1, s * 0.3)); c.globalAlpha = 1;
        const half = pp.ry >= H / 2 ? 'a' : 'b';
        const [nx, ny] = toPx(W / 2, half === 'a' ? H / 2 + 30 : H / 2 - 30);
        c.globalAlpha = 0.9;
        text(c, String(Math.max(1, Math.ceil(sk / 1000))), nx, ny + (i ? s * 12 : 0), 15 * s, T.bad, readRot(half), T.ink);
        c.globalAlpha = 1;
      }
      // trails and speed lines, then mallets, then the pucks on top
      for (let i = 0; i < table.pucks; i++) {
        const pk = host ? PK[i] : G[i];
        const tr = trails[i];
        if (!pk.on) { tr.n = 0; continue; }
        if (phase === 'play') {
          if (tr.n < 5) { tr.x[tr.n] = pk.rx; tr.y[tr.n] = pk.ry; tr.n++; } else { for (let k = 0; k < 4; k++) { tr.x[k] = tr.x[k + 1]; tr.y[k] = tr.y[k + 1]; } tr.x[4] = pk.rx; tr.y[4] = pk.ry; }
        } else if (phase !== 'paused') tr.n = 0;
        pk.show = (phase !== 'goal' || since < 120) && (phase === 'play' || phase === 'count' || phase === 'setup' || (pk.ry > 0 && pk.ry < H)) && phase !== 'wait';
        const heat = env.power && phase === 'play' ? heatOf(rally) : 0;
        if (pk.show && tr.n > 3) speedLines(c, pk, tr, heat, now);
      }
      drawMallet('b', now); drawMallet('a', now);
      for (let i = 0; i < table.pucks; i++) {
        const pk = host ? PK[i] : G[i];
        if (!pk.on || !pk.show) continue;
        drawPuck(i, pk, env.power && phase === 'play' ? heatOf(rally) : 0, now);
        pk.show = false;
      }
      // The middle of the table is one shared lane: the 3-2-1, the goal stamp, event stamps and the
      // table / match-point banners stack there, each in its own slot, instead of landing on top of
      // each other (or on the puck parked in the centre).
      const readers = local && view === 'up' ? RD2 : RD1;
      const dual = !(local && view === 'up'); // one reader may use both sides of the puck; on a shared phone each keeps to their own half
      const left = phase === 'count' ? (host ? phaseEnd - now : HS ? HS.cd - (now - HS.recv) : 1e9) : 1e9;
      for (let i = stamps.length - 1; i >= 0; i--) if (now - stamps[i].t0 > stamps[i].dur) stamps.splice(i, 1);
      const items = laneItems; items.length = 0;
      const ssince = Math.max(0, now - fx.stampAt);
      if (fx.stampWho && ssince < GOAL_MS) {
        items.push({ name: 'goal', t: -8.5, b: 14.5, pref: 1, draw(x, y, rot, dn) {
          const sc = reduced ? 1 : 1 + 0.35 * Math.max(0, 1 - ssince / 160);
          c.globalAlpha = ssince > GOAL_MS - 200 ? (GOAL_MS - ssince) / 200 : 1;
          misOn = true;
          text(c, 'GOAL', x, y, 17 * s * sc, T[fx.stampWho], rot - 0.08, T.ink);
          misOn = false;
          text(c, api.name(fx.stampWho), x, y + dn * 12 * s, 5 * s, T.ink, rot - 0.08, T.card, 900);
          c.globalAlpha = 1;
        } });
      }
      if (phase === 'count' && left > 0 && left <= COUNT_MS) {
        const n = Math.max(1, Math.ceil(left / (COUNT_MS / 3)));
        const frac = 1 - ((left % (COUNT_MS / 3)) + COUNT_MS / 3) % (COUNT_MS / 3) / (COUNT_MS / 3);
        const pop = reduced ? 1 : 1 + 0.25 * Math.max(0, 1 - frac * 4);
        items.push({ name: 'digit', t: -8.5, b: 8.5, pref: 1, draw(x, y, rot) { misOn = true; text(c, String(Math.min(3, n)), x, y, 22 * s * pop, T.hl, rot, T.ink); misOn = false; } });
      }
      stamps.forEach((st, k) => {
        if (!st.both) return;
        const age = now - st.t0; const z = st.size;
        items.push({ name: st.text, t: -0.6 * z, b: (st.sub ? 0.86 : 0.6) * z, pref: k % 2 ? -1 : 1, draw(x, y, rot, dn) {
          const pop = reduced ? 1 : 1 + 0.4 * Math.max(0, 1 - age / 150); const sz = z * s * pop;
          c.globalAlpha = age > st.dur - 250 ? (st.dur - age) / 250 : 1;
          sticker(c, st.text, x, y, sz, colOf(st.col), rot - 0.07, 62 * s);
          if (st.sub) text(c, st.sub, x, y + dn * sz * 0.66, Math.max(9, sz * 0.3), T.ink, rot - 0.07, T.card, 900, T.fontBody, 62 * s);
          c.globalAlpha = 1;
        } });
      });
      // the table's name (first countdown of a match) and the match-point banner, once the countdown proper is running
      if (phase === 'count' && left <= COUNT_MS + 400) {
        const first = !(host ? goals : HS ? HS.g || 0 : 0) && now - tableAt < 2600;
        if (first && table.id !== 'classic') {
          items.push({ name: 'intro', t: -4, b: 9, pref: -1, draw(x, y, rot, dn) {
            sticker(c, table.name.toUpperCase(), x, y, 7 * s, T.hl, rot - 0.04, 60 * s);
            text(c, table.blurb, x, y + dn * 6.6 * s, 2.6 * s, T.ink, rot - 0.04, T.card, 900, T.fontBody, 60 * s);
          } });
        }
        if (mp.length) {
          const both = mp.length === 2;
          items.push({ name: 'matchpoint', t: -4, b: both ? 4 : 9, pref: -1, draw(x, y, rot, dn) {
            sticker(c, both ? 'DOUBLE MATCH POINT' : 'MATCH POINT', x, y, 7 * s, both ? T.hl : T[mp[0]], rot + 0.03, 62 * s);
            if (!both) text(c, api.name(mp[0]), x, y + dn * 6.2 * s, 3 * s, T.ink, rot + 0.03, T.card, 900, T.fontBody, 60 * s);
          } });
        }
      }
      // slots: from 8 u off the centre spot outward (near = toward the reader), alternating sides when there is room
      let eN = 8; let eF = 8;
      for (const it of items) {
        let side = it.pref;
        if (!dual) side = 1; else if ((side === 1 ? eN : eF) > (side === 1 ? eF : eN) + 10) side = -side;
        const hgt = it.b - it.t;
        if (side === 1) { it.o = eN - it.t; eN += hgt + 2; } else { it.o = -eF - it.b; eF += hgt + 2; }
      }
      for (const it of items) {
        for (const w of readers) {
          const rot = readRot(w); const dn = rot ? -1 : 1;
          it.draw(ccx, ccy + it.o * s * (sideways() ? -1 : 1) * dn, rot, dn);
        }
      }
      // other stamps (POST!) sit where they happened
      for (const st of stamps) {
        if (st.both) continue;
        const age = now - st.t0;
        const pop = reduced ? 1 : 1 + 0.4 * Math.max(0, 1 - age / 150);
        c.globalAlpha = age > st.dur - 250 ? (st.dur - age) / 250 : 1;
        const [sx, sy] = toPx(st.x, st.y); const sz = st.size * s * pop;
        sticker(c, st.text, sx, sy, sz, colOf(st.col), st.rot - 0.07, 62 * s);
        if (st.sub) text(c, st.sub, sx, sy + (st.rot ? -1 : 1) * sz * 0.66, Math.max(9, sz * 0.3), T.ink, st.rot - 0.07, T.card, 900, T.fontBody, 62 * s);
        c.globalAlpha = 1;
      }
      centreNow.length = 0; for (const it of items) centreNow.push(it.name);
      let centreBusy = items.length > 0 || stamps.length > 0;
      if (!centreBusy) for (let i = 0; i < table.pucks; i++) if (host ? PK[i].on && PK[i].sk : G[i].on && G[i].sk) { centreBusy = true; break; }
      // match-point slow motion: a printed frame closes in (a DOM border; only its opacity moves)
      const slowO = ts < 0.98 && !reduced ? 0.22 * Math.min(1, (1 - ts) * 2.2) : 0;
      if (Math.abs(slowO - slowShown) > 0.004) { slowShown = slowO; slowEl.style.opacity = String(Math.round(slowO * 1000) / 1000); }
      // hints stay until the first touch (or key press)
      if (!setupOn && phase !== 'over') {
        hintK += ((centreBusy ? 0 : 1) - hintK) * (1 - Math.exp(-dtR / (centreBusy ? 0.05 : 0.18)));
        const hintA = Math.min(1, (now - t0) / 500) * hintK;
        if (!coarse && local) {
          for (const w of RD2) {
            if (ctl[w].used) continue;
            const below = cssH - (fy0 + fh) - RAIL * s > 92;
            let x; let y;
            if (view === 'side') { [x] = toPx(W / 2, w === 'a' ? H - 30 : 30); y = below ? fy0 + fh + RAIL * s + 52 : fy0 + fh - 46; }
            else { [x, y] = toPx(W / 2, w === 'a' ? H - 40 : 40); }
            legend(c, w, x, y, hintA * 0.95);
          }
        } else {
          for (const w of local ? RD2 : RD1) {
            if (ctl[w].used) continue;
            const [x, y] = toPx(W / 2, sideways() ? (w === 'a' ? H - 46 : 46) : w === 'a' ? H - 42 : 42);
            c.globalAlpha = hintA * (reduced ? 1 : 0.65 + 0.35 * Math.sin(now / 420));
            text(c, coarse ? 'Drag your mallet' : 'Move your mouse', x, y, Math.max(13, 4.4 * s), T.ink, readRot(w), T.card, 800, T.fontBody);
            c.globalAlpha = 1;
          }
        }
      }
      if (phase === 'paused' || (!host && hostAway)) {
        c.globalAlpha = 0.86; c.fillStyle = T.card; c.fillRect(fx0, fy0, fw, fh); c.globalAlpha = 1;
        for (const w of readers) text(c, 'Paused', ccx, ccy + (readRot(w) ? -1 : 1) * 10 * s, 9 * s, T.ink, readRot(w), null, 900);
      }
      // screen shake (on the whole rig, compositor-only): a decaying wobble, a few px, never longer than a quarter second
      const sk = Math.max(0, now - shakeAt);
      if (!reduced && sk < shakeDur) {
        const a = shakeAmp * (1 - sk / shakeDur) * (1 - sk / shakeDur);
        shakeX = Math.round(Math.sin(sk * 0.11 + 1.3) * a * 10) / 10; shakeY = Math.round(Math.cos(sk * 0.09) * a * 10) / 10;
        rig.style.transform = `translate(${shakeX}px, ${shakeY}px)`;
      } else if (shakeX || shakeY) { shakeX = 0; shakeY = 0; rig.style.transform = ''; }
      // the picker follows the phase
      if (phase !== 'setup' && phase !== 'wait' && setup.visible) setup.hide();
      else if (phase === 'setup' && !setup.visible) setup.show();
    }

    // ── loop ──
    let raf = 0;
    let last = 0;               // the previous frame's timestamp (0 = none yet)
    let dead = false;
    let rethemeQ = false;
    // Dynamic resolution: if the frame time stays high (and jittery: a steady 33 ms is a 30 Hz cap such as Low Power Mode, not load),
    // the canvases step down to fewer pixels. Never back up, so it can't oscillate.
    let wN = 0; let wSum = 0; let wMax = 0; let qAt = 0;
    function watch(raw, now) {
      if (document.hidden || raw > 400) { wN = 0; wSum = 0; wMax = 0; return; }
      wN++; wSum += raw; if (raw > wMax) wMax = raw;
      if (wN < 40) return;
      const avg = wSum / wN; const mx = wMax;
      wN = 0; wSum = 0; wMax = 0;
      if (avg > 24 && mx > 42 && qi < QUALITY.length - 1 && now - qAt > 2000 && now - t0 > 1500) { qi++; qAt = now; layout(); }
    }
    const themeSig = (t) => `${t.ink}|${t.card}|${t.a}|${t.b}|${t.hl}|${t.bg}|${t.edge}|${t.aSoft}|${t.bSoft}|${t.line}|${t.dark}`;
    function applyTheme() {
      const nt = readTokens();
      if (themeSig(nt) === themeSig(T)) return;
      T = nt; hudV++; buildSprites(); drawTable();
    }
    function frame(t) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      const now = t || performance.now();
      if (!last) last = now;
      const raw = Math.max(0, now - last);
      last = now;
      const dt = Math.min(0.05, raw / 1000);       // the simulation never takes a step longer than 50 ms of catching up
      const dtm = Math.min(0.1, raw / 1000);       // ... but the mallets' speed is still distance over real time
      watch(raw, now);
      if (rethemeQ) { rethemeQ = false; applyTheme(); }
      keyDrive(dt);
      glideDrive(dt);
      if (host) {
        if (!local) remoteTarget(now, dt);
        simulate(dt, now, dtm);
        if (!local) lastHv = Math.max(lastHv * 0.9, 0);
      } else guestUpdate(dt, now, dtm);
      alpha = Math.min(1, acc / DT);
      render(now, dt);
      publish(now);
    }

    // ── wiring ──
    const offs = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); offs.push(() => t.removeEventListener(ev, fn, o)); };
    on(cv, 'pointerdown', onDown);
    on(cv, 'pointermove', onMove);
    on(cv, 'pointerup', onUp);
    on(cv, 'pointercancel', onUp);
    on(cv, 'lostpointercapture', onUp);
    on(rig, 'touchstart', stopTouch, { passive: false });
    on(rig, 'touchmove', stopTouch, { passive: false });
    on(root, 'contextmenu', stopTouch);
    on(window, 'keydown', onKey);
    on(window, 'keyup', onKey);
    on(window, 'blur', onBlur);
    on(document, 'visibilitychange', () => {
      last = 0;
      updatePause();
      if (document.hidden) {
        cancelAnimationFrame(raf); raf = 0;
        if (!local) api.setPresence(host ? { ...hostState(), n: ++myN, __t: Math.round(net.now()) } : { k: key, n: ++myN, __t: Math.round(net.now()), away: 1, m: [r1(M[me].x), r1(M[me].y)], ...keepState() });
      } else if (!raf && !dead) { raf = requestAnimationFrame(frame); publishSoon(); }
    });
    const retheme = () => { rethemeQ = true; };
    const mq = (q, fn) => { const f = () => fn(q.matches); if (q.addEventListener) { q.addEventListener('change', f); offs.push(() => q.removeEventListener('change', f)); } };
    mq(darkMQ, retheme);
    mq(motionMQ, (v) => { reduced = v; });
    mq(coarseMQ, (v) => { coarse = v; layout(); });
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    offs.push(() => mo.disconnect());
    const ro = new ResizeObserver(() => layout());
    ro.observe(root);
    offs.push(() => ro.disconnect());

    if (!local) {
      offs.push(api.onPartnerHere((here) => {
        partnerHere = here;
        if (host) updatePause();
        else hostAway = !here;
      }));
      if (host) { adoptMatch(api.partnerState()); offs.push(api.onPartnerState(onGuestState)); }
      else {
        const s0 = api.partnerState();
        if (s0 && s0.res) staleKey = s0.k; // the last game's final state, still in presence
        else if (s0) onHostState(s0);
        offs.push(api.onPartnerState(onHostState));
      }
    }
    offs.push(api.onData(() => { if (setup.visible) setup.setRecords(recordsHTML()); }));
    api.setScore(score);
    layout();
    raf = requestAnimationFrame(frame);
    if (host) publishSoon();

    // Test hook (only on a dev/test server, never in the artifact).
    if (location.port) {
      window.__hockeyTest = {
        state: () => ({
          phase, score: { ...score }, hits: { ...hits }, view, coarse, host, me, table: table.id, sel, rally, ts,
          pucks: pucksOn().map((p, i) => (host ? { x: p.x, y: p.y, vx: p.vx, vy: p.vy, on: p.on, sk: p.sk, stall: p.stall, slow: p.slow, sand: p.sand } : { x: G[i].dp.x + G[i].ox, y: G[i].dp.y + G[i].oy, vx: G[i].dp.vx, vy: G[i].dp.vy, on: G[i].on, sk: G[i].sk })),
          puck: host ? { x: PK[0].x, y: PK[0].y, vx: PK[0].vx, vy: PK[0].vy } : { x: G[0].dp.x + G[0].ox, y: G[0].dp.y + G[0].oy, vx: G[0].dp.vx, vy: G[0].dp.vy },
          goals: { a: env.ghA, b: env.ghB }, post: env.post, setup: setup.visible,
          mallets: { a: { x: M.a.x, y: M.a.y }, b: { x: M.b.x, y: M.b.y } },
          targets: { a: { x: M.a.tx, y: M.a.ty }, b: { x: M.b.tx, y: M.b.ty } },
          centre: centreNow.slice(), hint: Math.round(hintK * 100) / 100, band: band ? band.kind : null, rtt: net ? net.rtt : 0, lag: Math.round(glag), override: G.some((g) => !!g.ov),
          // what is on screen (the blended step plus the guest's display correction), and the render settings
          render: {
            puck: host ? { x: PK[0].rx, y: PK[0].ry } : { x: G[0].rx, y: G[0].ry },
            pucks: ON.map((p, i) => (host ? { x: p.rx, y: p.ry } : { x: G[i].rx, y: G[i].ry })),
            mallets: { a: { x: M.a.rx, y: M.a.ry }, b: { x: M.b.rx, y: M.b.ry } },
            dpr, quality: qi, held: host ? performance.now() < stopUntil : performance.now() < gStop, hostFreezes, shake: Math.hypot(shakeX, shakeY),
          },
        }),
        start: (id = 'classic') => { if (host) startMatch(id); },
        pick: (id) => { if (host && phase === 'setup') { sel = id; if (TABLES[id]) applyTable(id); setup.select(id); publishSoon(); } },
        score: (w) => { if (host && phase !== 'over') scoreGoal(w, 'test'); },
        goals: () => goalLog.slice(),
        place: (x, y, vx = 0, vy = 0, i = 0) => { if (!host) return; Object.assign(PK[i], { x, y, px: x, py: y, vx, vy, on: true }); PK[i].ep++; phase = 'play'; publishSoon(); },
        setRally: (n, who = 'a') => { if (host) { rally = n; lastHitter = who; rallyAt = performance.now(); publishSoon(); } },
        toClient: (x, y) => { const r = cv.getBoundingClientRect(); const [px0, py0] = toPx(x, y); return [r.left + px0, r.top + py0]; },
        stamps: () => stamps.map((x) => x.text),
        events: () => evq.slice(),
        // juice: the hit-stop clock, the shake and the puck squash (for the flat-hockey test)
        hit: (imp = 200, i = 0) => { if (host) { hardHit(imp); squash(i, 0, 1, 1); } },
        shakeNow: () => ({ x: shakeX, y: shakeY }),
        quality: (q) => { qi = Math.max(0, Math.min(QUALITY.length - 1, q)); layout(); },
      };
    }

    return {
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        if (flashAnim) flashAnim.cancel();
        offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
        if (net) net.destroy();
        if (window.__hockeyTest) delete window.__hockeyTest;
      },
    };
  },
});
