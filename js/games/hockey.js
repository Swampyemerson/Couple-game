// Air Hockey: live, versus, first to 7.
//
// One phone: the table fills the stage and each player drags the mallet on their half (real
// multi-touch: every pointer belongs to the half it started in). One computer: W/A/S/D against
// the arrow keys, with the table turned sideways. Two devices: each sees its own goal at the
// bottom (or, on a computer, the mouse drives your mallet).
//
// Netcode. The host ('a') runs the only real simulation: 120 Hz fixed steps, the guest's mallet
// fed in from its presence samples (velocity estimated from successive samples). The host streams
// { puck, mallet, score, phase, hit counters } at ~25/s, stamped on the shared clock (net.js).
// The guest draws its own mallet straight from the finger and draws the puck *ahead* of the last
// host state by (state age + the measured guest->host lag): that is where the puck will be when
// the guest's mallet position reaches the host, so a hit the guest sees is a hit the host sees.
// The guest predicts its own hits locally and holds that prediction until the host's hit counter
// confirms it; every other correction is blended away over ~80 ms.
import { registerGame } from './core.js';
import { createNet } from './net.js';

const W = 100;          // table width, logical units
const H = 170;          // table length. 'a' defends y = H (bottom), 'b' defends y = 0 (top)
const RM = 7.5;         // mallet radius
const RP = 4.6;         // puck radius
const GH = 16;          // goal half-width
const RAIL = 5;         // rail thickness (drawn outside the play field)
const DT = 1 / 120;     // fixed physics step
const PUCK_MAX = 240;   // units/s
const MALLET_MAX = 900; // units/s
const WALL_E = 0.86;    // wall restitution
const MALLET_E = 0.8;   // mallet restitution
const FRICTION = 0.28;  // 1/s, exponential
const SERVE_V = 42;
const GOAL_MS = 1150;   // goal celebration before the countdown
const COUNT_MS = 1500;  // 3-2-1
const TO_WIN = 7;
const KEY_V = 150;      // keyboard mallet top speed
const KEY_ACC = 11;     // keyboard response (1/s): smooth acceleration and stop
const HIT_FX = 16;      // impact speed for a hit sound
const RATE = 25;        // network updates per second
const EDGE = 20;        // px: touches starting this close to the left edge are the iOS back swipe

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r1 = (v) => Math.round(v * 10) / 10;
const other = (w) => (w === 'a' ? 'b' : 'a');

// ── physics (shared by the host, one-device play and the guest's prediction) ──
function clampMallet(m) {
  m.x = clamp(m.x, RM, W - RM);
  m.y = m.who === 'a' ? clamp(m.y, H / 2 + RM, H - RM) : clamp(m.y, RM, H / 2 - RM);
}
function clampTarget(who, x, y) {
  return [clamp(x, RM, W - RM), who === 'a' ? clamp(y, H / 2 + RM, H - RM) : clamp(y, RM, H / 2 - RM)];
}
function bouncePoint(p, px, py) {
  const dx = p.x - px; const dy = p.y - py; const d2 = dx * dx + dy * dy;
  if (d2 >= RP * RP || d2 < 1e-9) return false;
  const d = Math.sqrt(d2); const nx = dx / d; const ny = dy / d;
  p.x = px + nx * RP; p.y = py + ny * RP;
  const vn = p.vx * nx + p.vy * ny;
  if (vn < 0) { p.vx -= (1 + WALL_E) * vn * nx; p.vy -= (1 + WALL_E) * vn * ny; return true; }
  return false;
}
/** Rails, goal posts and the goal pockets. Returns true on a bounce. */
function walls(p) {
  let hit = false;
  if (p.x < RP) { p.x = RP; if (p.vx < 0) { p.vx = -p.vx * WALL_E; p.vy *= 0.98; hit = true; } }
  else if (p.x > W - RP) { p.x = W - RP; if (p.vx > 0) { p.vx = -p.vx * WALL_E; p.vy *= 0.98; hit = true; } }
  if (Math.abs(p.x - W / 2) >= GH) {
    if (p.y < RP) { p.y = RP; if (p.vy < 0) { p.vy = -p.vy * WALL_E; p.vx *= 0.98; hit = true; } }
    else if (p.y > H - RP) { p.y = H - RP; if (p.vy > 0) { p.vy = -p.vy * WALL_E; p.vx *= 0.98; hit = true; } }
  } else if (p.y < RP || p.y > H - RP) {
    for (const py of [0, H]) for (const px of [W / 2 - GH, W / 2 + GH]) if (bouncePoint(p, px, py)) hit = true;
    if (p.y < 0 || p.y > H) p.x = clamp(p.x, W / 2 - GH + RP, W / 2 + GH - RP);
  }
  return hit;
}
/** Puck vs a kinematic mallet (infinite mass): the mallet's velocity transfers. Returns impact speed. */
function collideMallet(p, m) {
  const dx = p.x - m.x; const dy = p.y - m.y; const R = RM + RP;
  const d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return 0;
  const d = Math.sqrt(d2);
  let nx; let ny;
  if (d < 1e-6) { nx = 0; ny = m.who === 'a' ? -1 : 1; } else { nx = dx / d; ny = dy / d; }
  p.x = m.x + nx * R; p.y = m.y + ny * R;
  const vn = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  if (vn < 0) { p.vx -= (1 + MALLET_E) * vn * nx; p.vy -= (1 + MALLET_E) * vn * ny; return -vn; }
  return 0.001;
}
/** The puck is pinned against a rail: push the mallet back instead of through the puck. */
function unsqueeze(p, m) {
  const dx = m.x - p.x; const dy = m.y - p.y; const R = RM + RP; const d = Math.hypot(dx, dy);
  if (d >= R - 0.01) return;
  const nx = d > 1e-6 ? dx / d : 0; const ny = d > 1e-6 ? dy / d : m.who === 'a' ? 1 : -1;
  m.x = p.x + nx * R; m.y = p.y + ny * R;
  clampMallet(m);
}
/** One fixed step. Returns { wall, goal } where goal is the scorer ('a' scores in the top goal). */
function stepPuck(p, mallets, onHit, hold) {
  const f = Math.exp(-FRICTION * DT);
  p.vx *= f; p.vy *= f;
  p.x += p.vx * DT; p.y += p.vy * DT;
  const wall = walls(p);
  for (const m of mallets) {
    const imp = collideMallet(p, m);
    if (imp > 0) {
      if (onHit) onHit(m, imp);
      if (walls(p)) unsqueeze(p, m);
    }
  }
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > PUCK_MAX) { p.vx *= PUCK_MAX / sp; p.vy *= PUCK_MAX / sp; }
  let goal = p.y < -RP ? 'a' : p.y > H + RP ? 'b' : null;
  if (goal && hold) { p.y = goal === 'a' ? -RP : H + RP; p.vx = 0; p.vy = 0; goal = null; }
  return { wall, goal };
}

registerGame({
  id: 'hockey',
  title: 'Air Hockey',
  blurb: 'Fast hands, flat puck. First to 7.',
  kind: 'live',
  team: false,
  tags: ['silly'],
  platforms: ['phone', 'computer'],
  best: 'phone',
  immersive: true,
  minutes: 4,
  howTo: [
    'Drag your mallet on your half of the table. On a computer: W A S D or the arrow keys.',
    'Hit the puck into the slot at the far end.',
    'After a goal the puck is served to whoever let it in.',
    'First to 7 wins.',
  ],
  css: `
    .g-hockey { position: absolute; inset: 0; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
    .g-hockey .hk-rig { position: absolute; inset: 0; will-change: transform; }
    .gm.is-immersive .g-hockey .hk-rig { top: calc(60px + env(safe-area-inset-top, 0px)); bottom: calc(4px + env(safe-area-inset-bottom, 0px)); left: env(safe-area-inset-left, 0px); right: env(safe-area-inset-right, 0px); }
    .g-hockey .hk-slab { position: absolute; background: var(--g-card); box-shadow: var(--g-shadow-lg, var(--g-shadow)); }
    .g-hockey canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: none; }
    .g-hockey.is-local canvas { cursor: grab; }
  `,
  mount(el, api) {
    const local = api.mode === 'local';
    const host = local || api.isHost;           // runs the simulation
    const mine = local ? ['a', 'b'] : [api.me];  // mallets this device controls
    const me = local ? 'a' : api.me;
    const net = local ? null : createNet(api);
    const key = Math.random().toString(36).slice(2, 9); // this mount, so rematches don't mix states
    const coarseMQ = matchMedia('(pointer: coarse)');
    const motionMQ = matchMedia('(prefers-reduced-motion: reduce)');
    const darkMQ = matchMedia('(prefers-color-scheme: dark)');
    let coarse = coarseMQ.matches;
    let reduced = motionMQ.matches;

    el.innerHTML = `<div class="g-hockey ${local ? 'is-local' : ''}"><div class="hk-rig"><div class="hk-slab"></div><canvas aria-label="Air hockey table"></canvas></div></div>`;
    const root = el.querySelector('.g-hockey');
    const rig = root.querySelector('.hk-rig');
    const slab = root.querySelector('.hk-slab');
    const cv = root.querySelector('canvas');
    const cx = cv.getContext('2d');
    const layer = document.createElement('canvas'); // the printed table, redrawn on resize/theme
    const readTokens = () => {
      const cs = getComputedStyle(document.documentElement);
      const t = api.tokens();
      return { ...t, edge: cs.getPropertyValue('--g-edge').trim() || t.ink, aText: cs.getPropertyValue('--p-a-text').trim() || t.a, bText: cs.getPropertyValue('--p-b-text').trim() || t.b };
    };
    let T = readTokens();

    // ── world ──
    const P = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    const M = {
      a: { who: 'a', x: W / 2, y: H - 22, vx: 0, vy: 0, tx: W / 2, ty: H - 22 },
      b: { who: 'b', x: W / 2, y: 22, vx: 0, vy: 0, tx: W / 2, ty: 22 },
    };
    const score = { a: 0, b: 0 };
    const hits = { a: 0, b: 0 };
    let phase = host ? 'count' : 'wait'; // count | play | goal | paused | over (guest: 'wait' until the host speaks)
    let phaseEnd = performance.now() + COUNT_MS + 600;
    let serveTo = Math.random() < 0.5 ? 'a' : 'b';
    let resumeSlow = false;
    let goals = 0;
    let lastScorer = null;
    let winner = null;
    let result = null;
    let acc = 0;
    let pausedFor = null;       // why the host paused: 'away' (partner gone) | 'hidden'
    const lastHitAt = { a: 0, b: 0 };

    // ── input ──
    const ctl = {
      a: { ptr: null, keys: new Set(), kvx: 0, kvy: 0, used: false },
      b: { ptr: null, keys: new Set(), kvx: 0, kvy: 0, used: false },
    };
    const ptrs = new Map(); // pointerId -> who

    // ── effects ──
    const fx = { flashWho: null, flashAt: -1e9, shakeAt: -1e9, stampAt: -1e9, stampWho: null };
    const trail = [];
    const t0 = performance.now();

    // ── layout ──
    let cssW = 0; let cssH = 0; let dpr = 1; let s = 1; let ox = 0; let oy = 0; let view = 'up';
    const toPx = (x, y) => (view === 'up' ? [ox + x * s, oy + y * s] : view === 'down' ? [ox + (W - x) * s, oy + (H - y) * s] : [ox + (H - y) * s, oy + x * s]);
    const fromPx = (px, py) => {
      const u = (px - ox) / s; const v = (py - oy) / s;
      return view === 'up' ? [u, v] : view === 'down' ? [W - u, H - v] : [v, H - u];
    };
    // Screen direction -> table direction (for the keyboard).
    const screenToTable = (su, sv) => (view === 'up' ? [su, sv] : view === 'down' ? [-su, -sv] : [sv, -su]);
    // Text near player w is read by w on a shared phone (top player reads upside down).
    const readRot = (w) => (local && view === 'up' && w === 'b' ? Math.PI : 0);

    function layout() {
      const r = rig.getBoundingClientRect();
      cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
      dpr = Math.min(3, window.devicePixelRatio || 1);
      if (local) view = !coarse && cssW >= cssH * 0.9 ? 'side' : 'up';
      else view = api.me === 'b' ? 'down' : 'up';
      const VW = view === 'side' ? H : W; const VH = view === 'side' ? W : H;
      const m = RAIL + 2;
      s = Math.min((cssW - 6) / (VW + m * 2), (cssH - 6) / (VH + m * 2), view === 'side' ? 5 : 4.6);
      s = Math.max(s, 0.5);
      ox = Math.round((cssW - VW * s) / 2); oy = Math.round((cssH - VH * s) / 2);
      cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
      layer.width = cv.width; layer.height = cv.height;
      const rp = RAIL * s;
      Object.assign(slab.style, { left: `${ox - rp}px`, top: `${oy - rp}px`, width: `${VW * s + rp * 2}px`, height: `${VH * s + rp * 2}px`, borderRadius: `${Math.round(rp * 1.6)}px` });
      drawTable();
    }

    // ── the printed table (static layer) ──
    function drawTable() {
      const c = layer.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, layer.width, layer.height);
      const k = dpr * s;
      if (view === 'up') c.setTransform(k, 0, 0, k, dpr * ox, dpr * oy);
      else if (view === 'down') c.setTransform(-k, 0, 0, -k, dpr * (ox + W * s), dpr * (oy + H * s));
      else c.setTransform(0, k, -k, 0, dpr * (ox + H * s), dpr * oy);
      const px = (n) => n / s; // css px -> table units
      const inkW = px(2.5);
      // rail
      roundRect(c, -RAIL, -RAIL, W + RAIL * 2, H + RAIL * 2, RAIL * 1.6);
      c.fillStyle = T.card; c.fill();
      // halves, tinted with each player's soft ink
      c.fillStyle = T.bSoft || T.line; c.fillRect(0, 0, W, H / 2);
      c.fillStyle = T.aSoft || T.line; c.fillRect(0, H / 2, W, H / 2);
      // halftone fade toward each goal end
      for (const [w, y0, dir] of [['b', 0, 1], ['a', H, -1]]) {
        c.fillStyle = T[w]; c.globalAlpha = 0.22;
        for (let d = 2; d < 36; d += 3.2) {
          const rr = 0.85 * (1 - d / 36);
          const off = (Math.round(d / 3.2) % 2) * 1.6;
          for (let x = 2 + off; x < W - 1; x += 3.2) { c.beginPath(); c.arc(x, y0 + dir * d, rr, 0, Math.PI * 2); c.fill(); }
        }
        c.globalAlpha = 1;
      }
      // markings
      c.lineWidth = px(2);
      c.strokeStyle = T.ink;
      c.setLineDash([px(7), px(5)]);
      line(c, 0, H / 2, W, H / 2);
      c.setLineDash([]);
      c.beginPath(); c.arc(W / 2, H / 2, 14, 0, Math.PI * 2); c.stroke();
      c.fillStyle = T.ink; c.beginPath(); c.arc(W / 2, H / 2, 1.3, 0, Math.PI * 2); c.fill();
      for (const [w, y0, a0, a1] of [['b', 0, 0, Math.PI], ['a', H, Math.PI, Math.PI * 2]]) {
        // goal crease
        c.strokeStyle = T[w]; c.lineWidth = px(3);
        c.beginPath(); c.arc(W / 2, y0, 22, a0, a1); c.stroke();
        // face-off spots
        c.fillStyle = T[w];
        const fy = y0 === 0 ? 34 : H - 34;
        for (const fx0 of [W * 0.22, W * 0.78]) { c.beginPath(); c.arc(fx0, fy, 1.6, 0, Math.PI * 2); c.fill(); c.strokeStyle = T.ink; c.lineWidth = px(1.5); c.beginPath(); c.arc(fx0, fy, 4.2, 0, Math.PI * 2); c.stroke(); }
      }
      // play field outline
      c.strokeStyle = T.ink; c.lineWidth = inkW;
      c.strokeRect(0, 0, W, H);
      // goal slots cut through the rail
      for (const [w, y0, y1] of [['b', -RAIL - 0.5, 0], ['a', H, H + RAIL + 0.5]]) {
        c.fillStyle = T.ink; c.fillRect(W / 2 - GH, y0, GH * 2, y1 - y0);
        c.fillStyle = T[w]; c.fillRect(W / 2 - GH, w === 'b' ? -px(4) : H, GH * 2, px(4));
      }
      // posts
      c.fillStyle = T.card; c.strokeStyle = T.ink; c.lineWidth = px(2);
      for (const y0 of [0, H]) for (const x0 of [W / 2 - GH, W / 2 + GH]) { c.beginPath(); c.arc(x0, y0, 1.6, 0, Math.PI * 2); c.fill(); c.stroke(); }
      // rail outline
      c.lineWidth = inkW;
      roundRect(c, -RAIL, -RAIL, W + RAIL * 2, H + RAIL * 2, RAIL * 1.6);
      c.stroke();
      // each player's name printed on the rail beside their goal
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const fs = Math.max(8, Math.min(13, RAIL * s * 0.62));
      for (const w of ['a', 'b']) {
        const [x, y] = toPx(w === 'a' ? W / 2 + GH + 17 : W / 2 - GH - 17, w === 'a' ? H + RAIL / 2 : -RAIL / 2);
        const rot = view === 'side' ? (w === 'a' ? -Math.PI / 2 : Math.PI / 2) : readRot(w);
        label(c, api.name(w).toUpperCase(), x, y, fs, T[w + 'Text'], rot);
      }
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
    function goalFx(scorer) {
      fx.flashWho = scorer; fx.flashAt = performance.now(); fx.shakeAt = fx.flashAt;
      fx.stampWho = scorer; fx.stampAt = fx.flashAt;
      trail.length = 0;
      api.sfx(local || scorer === me ? 'good' : 'bad');
      api.haptic(40);
    }

    // ── host / one-device simulation ──
    function onHit(m, imp) {
      const now = performance.now();
      lastHv = Math.max(lastHv, imp); // rides along so the guest can play the host's hit sounds
      if (now - lastHitAt[m.who] > 80) { lastHitAt[m.who] = now; hits[m.who]++; hitFx(imp); }
    }
    function startCount(serve) {
      phase = 'count';
      phaseEnd = performance.now() + COUNT_MS;
      serveTo = serve;
      if (serve) { P.x = W / 2; P.y = H / 2; P.vx = 0; P.vy = 0; trail.length = 0; }
      publishSoon();
    }
    function scoreGoal(w) {
      if (phase === 'over' || winner) return;
      score[w]++; goals++; lastScorer = w;
      phase = 'goal'; phaseEnd = performance.now() + GOAL_MS;
      if (score[w] >= TO_WIN) winner = w;
      api.setScore(score);
      goalFx(w);
      publishSoon();
    }
    function simulate(dt, now) {
      if (phase === 'goal' && now >= phaseEnd) {
        if (winner) {
          phase = 'over';
          result = { winner, sub: `${score[winner]} – ${score[other(winner)]}` };
          publishSoon();
          api.finish(result);
        } else startCount(other(lastScorer));
      }
      if (phase === 'count' && now >= phaseEnd) {
        phase = 'play';
        if (serveTo) {
          const th = (Math.random() - 0.5) * 0.7;
          const dir = serveTo === 'a' ? 1 : -1;
          P.vx = Math.sin(th) * SERVE_V; P.vy = Math.cos(th) * SERVE_V * dir;
        } else if (resumeSlow) { P.vx *= 0.5; P.vy *= 0.5; }
        resumeSlow = false;
        publishSoon();
      }
      acc += dt;
      let n = Math.floor(acc / DT);
      if (n > 14) { n = 14; acc = 0; } else acc -= n * DT;
      if (!n) return;
      const ms = [M.a, M.b];
      const frozen = phase === 'paused' || phase === 'over';
      for (const m of ms) {
        m.sx = m.x; m.sy = m.y;
        let dx = frozen ? 0 : m.tx - m.x; let dy = frozen ? 0 : m.ty - m.y;
        const maxd = MALLET_MAX * n * DT; const d = Math.hypot(dx, dy);
        if (d > maxd) { dx *= maxd / d; dy *= maxd / d; }
        m.dx = dx; m.dy = dy;
      }
      for (let i = 1; i <= n; i++) {
        for (const m of ms) {
          const nx = m.sx + (m.dx * i) / n; const ny = m.sy + (m.dy * i) / n;
          m.vx = (nx - m.x) / DT; m.vy = (ny - m.y) / DT; m.x = nx; m.y = ny;
          if (phase !== 'play') unsqueeze(P, m); // keep mallets off the parked puck
        }
        if (phase === 'play') {
          const r = stepPuck(P, ms, onHit, false);
          if (r.goal) { scoreGoal(r.goal); break; }
        }
      }
    }

    // ── guest: prediction ──
    let HS = null;              // latest host state
    let staleKey = null;        // a finished game's host state still in presence after a rematch
    let lastN = -1;
    const DP = { x: W / 2, y: H / 2, vx: 0, vy: 0 }; // displayed (predicted) puck
    const off = { x: 0, y: 0 };                      // display correction, decays to 0
    let override = null;        // { hb, until }: our predicted hit, awaiting the host's confirmation
    const hostM = { who: 'a', x: W / 2, y: H - 22, vx: 0, vy: 0 };
    let finAt = 0;
    let hostAway = false;

    function hostAge(S, now) {
      return net && net.synced ? net.now() - S.__t : now - S.recv + 40;
    }
    function extrapolate(S, now) {
      const p = { x: S.p[0], y: S.p[1], vx: S.p[2], vy: S.p[3] };
      const lead = clamp(S.gl || 60, 15, 160);
      const steps = Math.round(clamp(hostAge(S, now) + lead, 0, 280) / (DT * 1000));
      const ms = [{ ...M[me] }, { ...hostM }];
      for (let i = 0; i < steps; i++) stepPuck(p, ms, guestHit, true);
      return p;
    }
    function guestHit(m, imp) {
      if (m.who !== me) return;
      const now = performance.now();
      if (!HS || now - lastHitAt[me] < 90) return;
      lastHitAt[me] = now;
      override = { hb: HS.h[1], until: now + clamp((net ? net.rtt : 80) + 160, 200, 450) };
      hitFx(imp);
    }
    function onHostState(S) {
      if (!S || !Array.isArray(S.p) || S.k === staleKey) return;
      if (HS && S.k === HS.k && S.n <= lastN) return;
      const now = performance.now();
      const prev = HS && HS.k === S.k ? HS : null;
      lastN = S.n;
      HS = { ...S, recv: now };
      if (prev) {
        if (S.g > prev.g && S.sc) goalFx(S.sc);
        if (S.h[0] > prev.h[0] && (S.hv || 0) >= HIT_FX) api.sfx('hit');
      }
      score.a = S.s[0]; score.b = S.s[1];
      api.setScore(score);
      phase = S.ph;
      if (S.ph === 'play') {
        if (override && S.h[1] <= override.hb && now < override.until) return; // keep our predicted hit
        override = null;
        const sx = DP.x + off.x; const sy = DP.y + off.y;
        const ext = extrapolate(S, now);
        const ex = sx - ext.x; const ey = sy - ext.y;
        Object.assign(DP, ext);
        if (prev && prev.ph === 'play' && Math.hypot(ex, ey) < 30) { off.x = ex; off.y = ey; } else { off.x = 0; off.y = 0; trail.length = 0; }
      } else {
        Object.assign(DP, { x: S.p[0], y: S.p[1], vx: 0, vy: 0 });
        off.x = 0; off.y = 0; override = null;
        if (S.ph === 'over' && S.res && !finAt) finAt = now + 700; // in case the engine's finish message drops
      }
    }
    function guestUpdate(dt, now) {
      const S = HS;
      // the host's mallet: extrapolate its last sample a little, then ease toward it
      if (S) {
        const age = clamp(hostAge(S, now), 0, 70) / 1000;
        const tx = S.m[0] + S.m[2] * age; const ty = S.m[1] + S.m[3] * age;
        const k = 1 - Math.exp(-dt / 0.045);
        const nx = hostM.x + (tx - hostM.x) * k; const ny = hostM.y + (ty - hostM.y) * k;
        hostM.vx = S.m[2]; hostM.vy = S.m[3]; hostM.x = nx; hostM.y = ny;
        clampMallet(hostM);
        M.a.x = hostM.x; M.a.y = hostM.y;
      }
      acc += dt;
      let n = Math.floor(acc / DT);
      if (n > 14) { n = 14; acc = 0; } else acc -= n * DT;
      const m = M[me];
      const live = S && S.ph === 'play' && !hostAway;
      if (n) {
        m.sx = m.x; m.sy = m.y;
        let dx = m.tx - m.x; let dy = m.ty - m.y;
        const maxd = MALLET_MAX * n * DT; const d = Math.hypot(dx, dy);
        if (d > maxd) { dx *= maxd / d; dy *= maxd / d; }
        for (let i = 1; i <= n; i++) {
          const nx = m.sx + (dx * i) / n; const ny = m.sy + (dy * i) / n;
          m.vx = (nx - m.x) / DT; m.vy = (ny - m.y) / DT; m.x = nx; m.y = ny;
          if (live) stepPuck(DP, [m, hostM], guestHit, true);
        }
      }
      const k = Math.exp(-dt / 0.08);
      off.x *= k; off.y *= k;
      if (finAt && now >= finAt) { finAt = 0; if (HS && HS.res) api.finish(HS.res); }
    }

    // ── network ──
    let lastPub = 0;
    let pubSoon = false;
    let lastHv = 0;
    let gs = null;              // guest mallet sample on the host { x, y, t, at }
    let gv = { x: 0, y: 0 };
    let gk = null; let gn = -1;
    let glag = 0;
    let partnerAway = false;    // partner's tab is hidden
    let myN = 0;
    function publishSoon() { pubSoon = true; }
    function hostState() {
      return {
        k: key, n: ++myN, __t: Math.round(net.now()), ph: phase,
        cd: phase === 'count' || phase === 'goal' ? Math.max(0, Math.round(phaseEnd - performance.now())) : 0,
        p: [r1(P.x), r1(P.y), r1(P.vx), r1(P.vy)],
        m: [r1(M.a.x), r1(M.a.y), r1(M.a.vx), r1(M.a.vy)],
        s: [score.a, score.b], g: goals, sc: lastScorer, h: [hits.a, hits.b], hv: Math.round(lastHv),
        gl: Math.round(glag), res: result, away: document.hidden ? 1 : 0,
      };
    }
    let lastSent = '';
    function publish(now) {
      if (local) return;
      const due = now - lastPub >= 1000 / RATE - 2;
      if (!due && !(pubSoon && now - lastPub > 15)) return;
      if (host) {
        api.setPresence(hostState());
      } else {
        const m = M[me];
        const body = `${r1(m.x)},${r1(m.y)}`;
        if (body === lastSent && now - lastPub < 400 && !pubSoon) return;
        lastSent = body;
        api.setPresence({ k: key, n: ++myN, __t: Math.round(net.now()), sy: net.synced ? 1 : 0, m: [r1(m.x), r1(m.y)], away: document.hidden ? 1 : 0 });
      }
      lastPub = now; pubSoon = false;
    }
    function onGuestState(st) {
      if (!st) return;
      if (st.k === gk && st.n <= gn) return;
      const fresh = st.k !== gk;
      gk = st.k; gn = st.n;
      const away = !!st.away;
      if (away !== partnerAway) { partnerAway = away; updatePause(); }
      if (!Array.isArray(st.m)) return;
      const now = performance.now();
      const [x, y] = clampTarget('b', st.m[0], st.m[1]);
      if (gs && !fresh && st.__t > gs.t) {
        const dts = clamp((st.__t - gs.t) / 1000, 0.012, 0.25);
        const vx = (x - gs.x) / dts; const vy = (y - gs.y) / dts;
        gv = { x: gv.x * 0.35 + vx * 0.65, y: gv.y * 0.35 + vy * 0.65 };
      } else gv = { x: 0, y: 0 };
      if (st.sy) { const lag = net.now() - st.__t; if (lag >= 0 && lag < 1000) glag = glag ? glag * 0.85 + lag * 0.15 : lag; }
      gs = { x, y, t: st.__t, at: now };
    }
    function remoteTarget(now) {
      if (!gs) return;
      const age = (now - gs.at) / 1000;
      if (age > 0.25) { gv.x *= 0.8; gv.y *= 0.8; }
      const e = Math.min(age, 0.05);
      const [x, y] = clampTarget('b', gs.x + gv.x * e, gs.y + gv.y * e);
      M.b.tx = x; M.b.ty = y;
    }

    // ── pausing: partner gone, partner's tab hidden, or ours hidden ──
    let partnerHere = local || api.partnerHere;
    function updatePause() {
      if (!host || phase === 'over') return;
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

    // ── input handlers ──
    function canonFromEvent(e) {
      const r = cv.getBoundingClientRect();
      return fromPx(e.clientX - r.left, e.clientY - r.top);
    }
    function aim(who, e) {
      const [x, y] = canonFromEvent(e);
      const [tx, ty] = clampTarget(who, x, y);
      const m = M[who];
      m.tx = tx; m.ty = ty;
      ctl[who].kvx = 0; ctl[who].kvy = 0; ctl[who].used = true;
    }
    function onDown(e) {
      if (e.pointerType !== 'mouse' && e.clientX < EDGE) return; // iOS back-swipe zone
      e.preventDefault();
      let who;
      if (local) { const [, y] = canonFromEvent(e); who = y >= H / 2 ? 'a' : 'b'; } else who = me;
      ptrs.set(e.pointerId, who);
      ctl[who].ptr = e.pointerId;
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic pointers can't be captured */ }
      aim(who, e);
      api.sfx('tap');
    }
    function onMove(e) {
      const who = ptrs.get(e.pointerId);
      if (who) { if (ctl[who].ptr === e.pointerId) aim(who, e); return; }
      if (!local && e.pointerType === 'mouse') aim(me, e); // on a computer the mouse just drives your mallet
    }
    function onUp(e) {
      const who = ptrs.get(e.pointerId);
      if (!who) return;
      ptrs.delete(e.pointerId);
      if (ctl[who].ptr === e.pointerId) ctl[who].ptr = null;
      try { cv.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
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
      const k = keyOf(e);
      if (!k) return;
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
        const [tx, ty] = clampTarget(w, m.tx + c.kvx * dt, m.ty + c.kvy * dt);
        if (tx !== m.tx + c.kvx * dt) c.kvx = 0;
        if (ty !== m.ty + c.kvy * dt) c.kvy = 0;
        m.tx = tx; m.ty = ty;
      }
    }

    // ── drawing ──
    function disc(c, x, y, r, fill, stroke, lw) {
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
    }
    function drawMallet(c, w, x, y) {
      const [px, py] = toPx(x, y); const r = RM * s; const lw = Math.max(1.5, s * 0.55);
      const sh = Math.max(2, s * 0.9);
      disc(c, px + sh, py + sh * 1.2, r, T.edge);
      disc(c, px, py, r, T[w], T.ink, lw);
      c.globalAlpha = 0.28; disc(c, px, py, r * 0.68, T.card); c.globalAlpha = 1;
      disc(c, px, py, r * 0.68, null, T.ink, lw * 0.7);
      disc(c, px + sh * 0.35, py + sh * 0.45, r * 0.4, T.edge);
      disc(c, px, py, r * 0.4, T[w], T.ink, lw);
      c.globalAlpha = 0.55; c.beginPath(); c.arc(px, py, r * 0.25, Math.PI * 1.05, Math.PI * 1.6); c.strokeStyle = T.card; c.lineWidth = lw; c.stroke(); c.globalAlpha = 1;
    }
    function drawPuck(c, x, y) {
      const [px, py] = toPx(x, y); const r = RP * s; const lw = Math.max(1.5, s * 0.5);
      const sh = Math.max(1.5, s * 0.6);
      disc(c, px + sh, py + sh * 1.2, r, T.edge);
      disc(c, px, py, r, T.ink, T.ink, lw);
      disc(c, px, py, r * 0.62, null, T.card, Math.max(1, lw * 0.6));
      disc(c, px, py, r * 0.16, T.card);
    }
    function text(c, str, x, y, size, fill, rot = 0, stroke = null, weight = 900) {
      c.save(); c.translate(x, y); c.rotate(rot);
      c.font = `${weight} ${size}px ${T.fontDisplay || 'system-ui'}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (stroke) { c.lineJoin = 'round'; c.lineWidth = Math.max(2, size * 0.09); c.strokeStyle = stroke; c.strokeText(str, 0, 0); }
      c.fillStyle = fill; c.fillText(str, 0, 0);
      c.restore();
    }
    function keycap(c, x, y, sz, glyph) {
      const r = sz * 0.2;
      c.fillStyle = T.ink; roundRect(c, x - sz / 2 + 2, y - sz / 2 + 2, sz, sz, r); c.fill();
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
      text(c, api.name(w), x, y - sz * 1.55, 12, T[w], 0, null, 900);
      keycap(c, x, y - (sz + g) / 2, sz, keys[0]);
      for (let i = 0; i < 3; i++) keycap(c, x + (i - 1) * (sz + g), y + (sz + g) / 2, sz, keys[i + 1]);
      c.globalAlpha = 1;
    }

    // Comic-book speed lines behind a fast puck: crisp ink strokes, no blur.
    function speedLines(c, pp) {
      const [hx, hy] = toPx(pp.x, pp.y);
      const [ox0, oy0] = toPx(trail[0][0], trail[0][1]);
      let dx = hx - ox0; let dy = hy - oy0;
      const len = Math.hypot(dx, dy);
      if (len < RP * s * 0.9) return;
      dx /= len; dy /= len;
      const nx = -dy; const ny = dx; const r = RP * s;
      const L = Math.min(len * 1.3, r * 4.5);
      c.strokeStyle = T.ink; c.lineCap = 'round'; c.lineWidth = Math.max(1.5, s * 0.45);
      for (const [o, f] of [[-0.62, 0.6], [0, 1], [0.62, 0.75]]) {
        const sx = hx - dx * r * 1.25 + nx * o * r; const sy = hy - dy * r * 1.25 + ny * o * r;
        c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx - dx * L * f, sy - dy * L * f); c.stroke();
      }
    }

    function render(now) {
      const c = cx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cv.width, cv.height);
      c.drawImage(layer, 0, 0);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const [fx0, fy0] = toPx(0, 0); const [fx1, fy1] = toPx(W, H);
      const field = [Math.min(fx0, fx1), Math.min(fy0, fy1), Math.abs(fx1 - fx0), Math.abs(fy1 - fy0)];
      const [ccx, ccy] = toPx(W / 2, H / 2);
      // scores, printed on each half
      const ss = Math.min(64, 15 * s);
      for (const w of ['a', 'b']) {
        const [x, y] = toPx(w === 'a' ? W - 14 : 14, w === 'a' ? H / 2 + 18 : H / 2 - 18);
        c.globalAlpha = 0.9;
        text(c, String(score[w]), x, y, ss, T[w], readRot(w), T.ink);
        c.globalAlpha = 1;
      }
      // goal flash in the scorer's ink
      const since = now - fx.flashAt;
      if (!reduced && fx.flashWho && since < 650) {
        c.globalAlpha = 0.5 * (1 - since / 650);
        c.fillStyle = T[fx.flashWho]; c.fillRect(...field);
        c.globalAlpha = 1;
      }
      // puck + trail
      const showPuck = phase !== 'goal' || since < 120;
      const pp = host ? P : { x: DP.x + off.x, y: DP.y + off.y };
      if (phase === 'play') { trail.push([pp.x, pp.y]); if (trail.length > 5) trail.shift(); } else if (phase !== 'paused') trail.length = 0;
      if (showPuck && trail.length > 3) speedLines(c, pp);
      // mallets under the puck's shadow side, puck on top
      for (const w of ['b', 'a']) drawMallet(c, w, M[w].x, M[w].y);
      if (showPuck) drawPuck(c, pp.x, pp.y);
      // countdown, readable from each player's side
      const readers = local && view === 'up' ? ['a', 'b'] : [me];
      if (phase === 'count' && (host || HS)) {
        const left = host ? phaseEnd - now : HS.cd - (now - HS.recv);
        const n = Math.max(1, Math.ceil(left / (COUNT_MS / 3)));
        const frac = 1 - ((left % (COUNT_MS / 3)) + COUNT_MS / 3) % (COUNT_MS / 3) / (COUNT_MS / 3);
        const pop = reduced ? 1 : 1 + 0.25 * Math.max(0, 1 - frac * 4);
        if (left > 0 && left <= COUNT_MS) {
          for (const w of readers) {
            const rot = readRot(w);
            const y = ccy + (view === 'side' ? -26 : 26) * s * (rot ? -1 : 1);
            text(c, String(Math.min(3, n)), ccx, y, 22 * s * pop, T.hl, rot, T.ink);
          }
        }
      }
      // goal stamp
      const ssince = now - fx.stampAt;
      if (fx.stampWho && ssince < GOAL_MS) {
        const sc = reduced ? 1 : 1 + 0.35 * Math.max(0, 1 - ssince / 160);
        c.globalAlpha = ssince > GOAL_MS - 200 ? (GOAL_MS - ssince) / 200 : 1;
        for (const w of readers) {
          const rot = readRot(w);
          const d = 26 * s * (rot ? -1 : 1);
          const y = view === 'side' ? ccy : ccy + d;
          text(c, 'GOAL', ccx, y, 17 * s * sc, T[fx.stampWho], rot - 0.08, T.ink);
          text(c, api.name(fx.stampWho), ccx, y + (rot ? -1 : 1) * 12 * s, 5 * s, T.ink, rot - 0.08, T.card, 900);
        }
        c.globalAlpha = 1;
      }
      // first-time hints
      const hintA = Math.max(0, Math.min(1, (7000 - (now - t0)) / 600));
      if (hintA > 0) {
        if (!coarse && local) {
          for (const w of ['a', 'b']) {
            if (ctl[w].used) continue;
            const below = cssH - (field[1] + field[3]) - RAIL * s > 92;
            let x; let y;
            if (view === 'side') { [x] = toPx(W / 2, w === 'a' ? H - 30 : 30); y = below ? field[1] + field[3] + RAIL * s + 52 : field[1] + field[3] - 46; }
            else { [x, y] = toPx(W / 2, w === 'a' ? H - 40 : 40); }
            legend(c, w, x, y, hintA * 0.95);
          }
        } else {
          for (const w of local ? ['a', 'b'] : [me]) {
            if (ctl[w].used) continue;
            const [x, y] = toPx(W / 2, w === 'a' ? H - 42 : 42);
            c.globalAlpha = hintA;
            text(c, coarse ? 'Drag your mallet' : 'Move your mouse', x, y, Math.max(12, 4.2 * s), T.ink, readRot(w), T.card, 800);
            c.globalAlpha = 1;
          }
        }
      }
      if (phase === 'paused' || (!host && hostAway)) {
        c.globalAlpha = 0.86; c.fillStyle = T.card; c.fillRect(...field); c.globalAlpha = 1;
        for (const w of readers) text(c, 'Paused', ccx, ccy + (readRot(w) ? -1 : 1) * 10 * s, 9 * s, T.ink, readRot(w), null, 900);
      }
      // screen shake (on the whole rig, compositor-only)
      const sk = now - fx.shakeAt;
      if (!reduced && sk < 380) {
        const a = 7 * (1 - sk / 380);
        rig.style.transform = `translate(${(Math.random() - 0.5) * a * 2}px, ${(Math.random() - 0.5) * a * 2}px)`;
      } else if (rig.style.transform) rig.style.transform = '';
    }

    // ── loop ──
    let raf = 0;
    let last = performance.now();
    let dead = false;
    function frame() {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      keyDrive(dt);
      if (host) {
        if (!local) remoteTarget(now);
        simulate(dt, now);
        if (!local) lastHv = Math.max(lastHv * 0.9, 0);
      } else guestUpdate(dt, now);
      render(now);
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
    on(root, 'touchstart', stopTouch, { passive: false });
    on(root, 'touchmove', stopTouch, { passive: false });
    on(root, 'contextmenu', stopTouch);
    on(window, 'keydown', onKey);
    on(window, 'keyup', onKey);
    on(window, 'blur', onBlur);
    on(document, 'visibilitychange', () => {
      last = performance.now();
      updatePause();
      if (document.hidden) {
        cancelAnimationFrame(raf); raf = 0;
        if (!local) api.setPresence(host ? hostState() : { k: key, n: ++myN, __t: Math.round(net.now()), away: 1, m: [r1(M[me].x), r1(M[me].y)] });
      } else if (!raf && !dead) { raf = requestAnimationFrame(frame); publishSoon(); }
    });
    const retheme = () => { T = readTokens(); drawTable(); };
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
      if (host) offs.push(api.onPartnerState(onGuestState));
      else {
        const s0 = api.partnerState();
        if (s0 && s0.res) staleKey = s0.k; // the last game's final state, still in presence
        else if (s0) onHostState(s0);
        offs.push(api.onPartnerState(onHostState));
      }
    }
    api.setScore(score);
    layout();
    raf = requestAnimationFrame(frame);
    if (host) publishSoon();

    // Test hook (only on a dev/test server, never in the artifact).
    if (location.port) {
      window.__hockeyTest = {
        state: () => ({
          phase, score: { ...score }, hits: { ...hits }, view, coarse, host, me,
          puck: host ? { ...P } : { x: DP.x + off.x, y: DP.y + off.y, vx: DP.vx, vy: DP.vy },
          mallets: { a: { x: M.a.x, y: M.a.y }, b: { x: M.b.x, y: M.b.y } },
          rtt: net ? net.rtt : 0, lag: Math.round(glag), override: !!override,
        }),
        score: (w) => { if (host && phase !== 'over') scoreGoal(w); },
        place: (x, y, vx = 0, vy = 0) => { if (!host) return; Object.assign(P, { x, y, vx, vy }); phase = 'play'; publishSoon(); },
        toClient: (x, y) => { const r = cv.getBoundingClientRect(); const [px, py] = toPx(x, y); return [r.left + px, r.top + py]; },
      };
    }

    return {
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
        if (net) net.destroy();
        if (window.__hockeyTest) delete window.__hockeyTest;
      },
    };
  },
});
