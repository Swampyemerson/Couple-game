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
import { registerGame } from './core.js';
import { CSS } from './cycles/css.js';
import {
  DX, DY, DIR, LAYOUTS, ARENAS, BOOST_TICKS, tickMs, newSim, okTurn, step, enc, decode, rebuild, summary,
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
const OPP_LAG = 1.4; // guest: how far behind the confirmed tick the opponent is drawn (smooth between frames)
const BIAS = 0.4; // guest: its own clock runs this far ahead of the confirmed tick
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
    const reduce = mq('(prefers-reduced-motion: reduce)');
    // the grid that suits this screen: s square (computer), p portrait phone, l phone on its side
    const prefNow = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      return w >= 700 && w >= h * 1.05 ? (h <= 520 ? 'l' : 's') : 'p';
    };
    let pref = prefNow();
    const pickLayout = (x, y) => (x === 'p' || y === 'p' ? 'p' : x === 'l' || y === 'l' ? 'l' : 's');
    const offs = [];
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
    let tdisp = 0; // guest: the display clock, in ticks
    let seenTurns = 0;
    // presentation
    let evSeen = 0;
    const fx = []; // sparks and rings
    let lastShake = 0;
    let bgCan = null;
    let bgKey = '';
    let capText = '';
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
      bgKey = '';
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
    function teardownBoard() {
      if (ro) { ro.disconnect(); ro = null; }
      canvas = ctx = board = msgEl = rpEl = null;
      bgCan = null; bgKey = '';
    }
    function build() {
      teardownBoard();
      pickShown = false;
      const wide = layout !== 'p';
      const boardHTML = '<div class="cy-board"><canvas aria-label="Light Cycles grid" role="img"></canvas><div class="cy-rp"><span class="cy-rp-tag">REPLAY</span><span class="cy-rp-skip">tap to skip</span><span class="cy-rp-cap"></span></div><div class="cy-msg" aria-live="polite"></div></div>';
      const info = '<div class="cy-info"><span class="cy-pips p-a"></span><span class="cy-round"></span><span class="cy-pips p-b"></span></div>';
      let html;
      root.dataset.ui = local ? `local-${touch ? 'touch' : 'keys'}-${layout}` : touch ? 'live-touch' : 'live-keys';
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
      root.dataset.layout = layout;
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
      bgKey = '';
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
      } else guestTurn(d);
    }
    function guestTurn(d) {
      if (!hostMid || !sim[me].alive) return;
      const cur = pending.length ? pending[pending.length - 1].d : sim[me].d;
      if (!okTurn(cur, d)) return;
      const e = { seq: ++seq, r: round, d };
      pending.push(e);
      if (pending.length > 12) pending.shift();
      cue.turn();
      api.send('turn', { m: hostMid, g: gid, s: e.seq, r: e.r, d });
      publishGuest();
    }
    // screen direction -> world direction for a player (rot: that player's pad is upside down)
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
        if (endStage(perf()) === 'hit' || endStage(perf()) === 'replay') { skipReplay(); return; }
        const r = canvas.getBoundingClientRect();
        swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, top: e.clientY < r.top + r.height / 2, left: e.clientX < r.left + r.width / 2 };
        try { board.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      });
      board.addEventListener('pointermove', (e) => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (Math.hypot(dx, dy) < 18) return;
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
    function bump(patch, key, val, who, tag, label) {
      const d = api.data() || {};
      const prev = +d[key] || 0;
      if (val > prev) {
        patch[key] = val;
        if (who != null) patch[key.replace(/_n$/, '_who')] = who;
        if (prev > 0) { rc.push(tag); matchRecs.push(label); }
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
      if (s.mid !== hostMid) { hostMid = s.mid; seq = 0; pending = []; gRx = 0; gEntries = []; gRound = 0; lastPh = null; }
      if (s.md && CHOICES.concat(['rotate']).includes(s.md.ar)) md = { ar: s.md.ar, bo: !!s.md.bo };
      if (s.ph === 'pick') {
        phase = 'pick'; round = 0; paused = false;
        if (!pickShown) showPicker(); else paintPicker();
        lastPh = 'pick';
        return;
      }
      if (!s.cfg) return;
      const now = perf();
      if (s.r !== gRound) { gRound = s.r; gEntries = []; crashAt = 0; skipped = false; evSeen = 0; fx.length = 0; capText = ''; seenTurns = 0; tdisp = 0; pending = pending.filter((p) => p.r === s.r); }
      cfg = s.cfg;
      matchAr = md.ar;
      if (!canvas || layout !== cfg.L) { layout = cfg.L; build(); }
      const part = decode(s.lg);
      if (!s.lo) gEntries = part; else part.forEach((e, i) => { gEntries[s.lo + i] = e; });
      const prevT = sim ? sim.t : 0;
      if (s.ph === 'count' && s.cd !== cd && !s.pz) api.sfx('tick');
      if (s.ph === 'run' && lastPh !== 'run') { goAt = now; api.sfx('pop'); }
      phase = s.ph; round = s.r; cd = s.cd; rw = s.rw; paused = !!s.pz; pz = s.pz | 0; rc = Array.isArray(s.rc) ? s.rc : [];
      lastPh = s.ph;
      const sc = Array.isArray(s.sc) ? s.sc : [0, 0];
      const infoKey = `${round}|${phase}|${sc[0]}|${sc[1]}`;
      score = { a: sc[0] | 0, b: sc[1] | 0 };
      sim = rebuild(cfg, gEntries.filter(Boolean), s.t | 0);
      if (sim.t !== prevT || sim.t === 0) {
        const err = sim.t + BIAS - tdisp;
        tdisp = Math.abs(err) > 2.5 ? sim.t + BIAS : tdisp + err * 0.3;
      }
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
    function shake() {
      if (reduce || !board) return;
      const now = perf();
      if (now - lastShake < 400) return;
      lastShake = now;
      board.classList.remove('is-shake');
      void board.offsetWidth;
      board.classList.add('is-shake');
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
    function crashFocus() {
      const loser = rw === 'a' ? 'b' : rw === 'b' ? 'a' : 'a';
      const cr = sim[loser].crash || sim.a.crash || sim.b.crash || [0, 0];
      return [clamp(cr[0], 0, sim.W - 1), clamp(cr[1], 0, sim.H - 1)];
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
    /** The head drawn `ext` cells past the last confirmed cell, heading d (the predicted segment). */
    function extended(p, d, ext) {
      const c = sim[p];
      const base = pathAt(sim, p, sim.t);
      const n = Math.min(ext, aheadFree(base.x, base.y, d, c.boost > 0 ? 2 : 1));
      return { i: base.i, x: base.x + DX[d] * n, y: base.y + DY[d] * n, d };
    }
    function viewOf(p) {
      const c = sim[p];
      if (!c.alive || sim.done) return pathAt(sim, p, sim.t);
      const running = phase === 'run' && !paused;
      if (host) {
        const q = queues[p].find((e) => !e.stale && okTurn(c.d, e.d));
        const d = q ? q.d : c.d;
        const ext = running ? clamp(acc / tickMs(cfg, sim.t), 0, 1) * (c.boost > 0 ? 2 : 1) : 0;
        return extended(p, d, ext);
      }
      if (p === me) {
        const d = pending.length && okTurn(c.d, pending[pending.length - 1].d) ? pending[pending.length - 1].d : c.d;
        const ext = running ? clamp(tdisp - sim.t, 0, 1) * (c.boost > 0 ? 2 : 1) : 0;
        return extended(p, d, ext);
      }
      return running ? pathAt(sim, p, clamp(tdisp - OPP_LAG, 0, sim.t)) : pathAt(sim, p, sim.t);
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
      const sh = Math.max(1, c * 0.2) * (flip ? -1 : 1);
      g2.fillStyle = C.edge;
      g2.globalAlpha = C.dark ? 0.9 : 0.28;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (occ[y * W + x] === 3) g2.fillRect(x * c + sh, y * c + sh, c, c);
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
    function drawToken(t, now, idx) {
      const c = cell;
      const x = (t.x + 0.5) * c;
      const y = (t.y + 0.5) * c;
      const pulse = reduce ? 1 : 1 + 0.09 * Math.sin(now / 170 + idx);
      const R = Math.max(3.6, c * 0.82) * pulse;
      ctx.lineWidth = Math.max(1.2, c * 0.14);
      ctx.strokeStyle = C.ink;
      ctx.fillStyle = C.edge; ctx.globalAlpha = C.dark ? 0.9 : 0.28;
      ctx.beginPath(); ctx.arc(x + c * 0.15, y + c * 0.15, R, 0, 7); ctx.fill();
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
      const s = { alive: live, boost: sim[p].boost, jump: sim[p].jump };
      const c = cell;
      const ow = Math.max(1.2, c * 0.15);
      ctx.save();
      ctx.translate((v.x + 0.5) * c, (v.y + 0.5) * c);
      if (s.alive && !reduce) {
        // ink bleed: a flat halo of the rider's ink around the head
        ctx.globalAlpha = 0.26;
        ctx.fillStyle = C[p];
        ctx.beginPath(); ctx.arc(0, 0, c * (1.25 + 0.12 * Math.sin(now / 90 + (p === 'a' ? 0 : 2))), 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.rotate((v.d * Math.PI) / 2);
      const w = c * 1.05;
      const l = c * 1.5;
      if (s.alive && s.boost > 0) {
        // speed lines behind a boosted rider
        ctx.strokeStyle = C.hl; ctx.lineWidth = Math.max(1.2, c * 0.18); ctx.lineCap = 'round';
        ctx.beginPath();
        for (const sx of [-0.4, 0, 0.4]) { ctx.moveTo(sx * c, c * 0.9); ctx.lineTo(sx * c, c * (1.7 + 0.5 * Math.abs(sx * 2))); }
        ctx.stroke();
      }
      ctx.lineWidth = ow * 1.1;
      ctx.strokeStyle = C.ink;
      ctx.fillStyle = s.alive ? C.hl : C.card;
      rr(-w / 2, -l / 2 - c * 0.18, w, l, Math.min(w, l) * 0.32);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = C[p];
      rr(-w / 2 + ow * 0.6, l * 0.1 - c * 0.18, w - ow * 1.2, l * 0.26, 1);
      ctx.fill();
      if (s.alive && s.jump > 0) {
        // a held jump: a paper ring around the bike
        ctx.strokeStyle = C.ink; ctx.lineWidth = ow; ctx.setLineDash([c * 0.5, c * 0.4]);
        ctx.beginPath(); ctx.arc(0, 0, c * 1.35, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
    }
    function drawBurst(cr, k) {
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
    }
    const burstK = (age) => { if (reduce) return 1; const k0 = clamp(age / 380, 0, 1); return 1 + 2.2 * Math.pow(k0 - 1, 3) + 1.2 * Math.pow(k0 - 1, 2); };
    function drawFx(now) {
      const c = cell;
      const ow = Math.max(1.2, c * 0.15);
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        const age = now - f.t0;
        const life = f.k === 'spark' ? 420 : 520;
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
        } else {
          ctx.strokeStyle = f.tk === 1 ? C.hl : C.ink; ctx.lineWidth = ow * 1.6;
          ctx.beginPath(); ctx.arc(x, y, c * (1 + 2.6 * u), 0, 7); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    function draw(now) {
      if (!ctx || !layout || !cfg) return;
      const g = LAYOUTS[layout];
      const c = cell;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.card;
      ctx.fillRect(0, 0, cssW, cssH);
      if (!sim) return;
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
        const fv = pathAt(sim, rw === 'a' ? 'b' : 'a', T);
        const k = clamp((u - 0.6) / 0.2, 0, 1);
        fxy = [fv.x + (crashXY[0] - fv.x) * k, fv.y + (crashXY[1] - fv.y) * k];
      } else if (stage === 'banner' && !reduce) {
        const since = now - (skipped ? skipAt : crashAt + HOLD_MS + REPLAY_MS);
        if (since < 260 && !skipped) zoom = ZOOM - (ZOOM - 1) * (1 - Math.pow(1 - since / 260, 3));
        burstAge = 1e5;
      } else if (stage === 'banner') burstAge = 1e5;
      const zx = (fxy[0] + 0.5) * c;
      const zy = (fxy[1] + 0.5) * c;
      if (zoom !== 1) {
        const sx = flip ? cssW - zx : zx;
        const sy = flip ? cssH - zy : zy;
        const hw = cssW / (2 * zoom);
        const hh = cssH / (2 * zoom);
        ctx.translate(cssW / 2, cssH / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-clamp(sx, hw, cssW - hw), -clamp(sy, hh, cssH - hh));
      }
      if (flip) { ctx.translate(cssW, cssH); ctx.rotate(Math.PI); }
      // the board, cached unless zoomed (the cache is a raster)
      const key = `${layout}|${cell}|${dpr}|${cfg.sd}|${cfg.ar}|${C.ink}|${C.line}|${C.card}|${C.muted}|${flip}`;
      if (zoom === 1) {
        if (!bgCan || bgKey !== key) {
          bgCan = bgCan || document.createElement('canvas');
          bgCan.width = canvas.width; bgCan.height = canvas.height;
          const b = bgCan.getContext('2d');
          b.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawBgVector(b, c, g.W, g.H, sim);
          bgKey = key;
        }
        ctx.drawImage(bgCan, 0, 0, cssW, cssH);
      } else drawBgVector(ctx, c, g.W, g.H, sim);
      const tShow = T == null ? sim.t : T;
      // tokens still lying on the grid
      if (sim.tl.length) {
        sim.tl.forEach((t, i) => {
          const pk = sim.pk.get(t.y * sim.W + t.x);
          if (pk === undefined || pk > tShow) drawToken(t, now, i);
        });
      }
      const tw = Math.max(2.5, c * 0.6);
      const ow = Math.max(1.2, c * 0.15);
      const sh = Math.max(1, c * 0.2) * (flip ? -1 : 1);
      const views = {};
      for (const p of ['a', 'b']) views[p] = T == null ? viewOf(p) : pathAt(sim, p, T);
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'square';
      // hard offset shadow, then an ink outline, then each rider's ink
      ctx.save();
      ctx.translate(sh, sh);
      ctx.strokeStyle = C.edge;
      ctx.globalAlpha = C.dark ? 0.9 : 0.28;
      ctx.lineWidth = tw + ow * 2;
      for (const p of ['a', 'b']) { trace(sim[p], views[p]); ctx.stroke(); }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = tw + ow * 2;
      for (const p of ['a', 'b']) { trace(sim[p], views[p]); ctx.stroke(); }
      ctx.lineWidth = tw;
      for (const p of ['a', 'b']) { ctx.strokeStyle = C[p]; trace(sim[p], views[p]); ctx.stroke(); }
      // heads: a bright, outlined bike with a band of its rider's ink
      for (const p of ['a', 'b']) drawBike(p, views[p], now, sim[p].alive || (T != null && T < sim.t - 0.05));
      if (T == null) drawFx(now);
      // crash bursts
      if (sim.done && burstAge >= 0) {
        const seen = new Set();
        ctx.lineJoin = 'miter';
        for (const p of ['a', 'b']) {
          const s = sim[p];
          if (s.alive || !s.crash) continue;
          const kk = s.crash.join(',');
          if (seen.has(kk)) continue;
          seen.add(kk);
          drawBurst(s.crash, burstK(burstAge));
        }
      }
    }

    function syncMsg(now) {
      if (!msgEl) return;
      let html = '';
      let key = '';
      const stage = endStage(now);
      if (phase === 'pick') { key = ''; } else if (paused) {
        key = 'pz' + pz;
        const who = local ? '' : api.name(pz === 1 ? 'a' : 'b');
        html = `<span>${local || document.hidden && host && pz === 1 ? 'Paused' : `<b>${esc(who)}</b> stepped away`}</span>`;
      } else if (phase === 'count') { key = 'c' + cd + round; html = `<span class="is-num">${cd || 3}</span>`; } else if (phase === 'run' && now - goAt < 600) { key = 'go' + round; html = '<span class="is-num is-go">GO</span>'; } else if ((phase === 'end' || phase === 'over') && sim && stage === 'banner') {
        const shaves = sim.a.sh + sim.b.sh;
        const stamps = rc.map((x) => `<i class="cy-stamp">${x === 'long' ? 'LONGEST RIDE!' : 'MOST SHAVES!'}</i>`).join('');
        key = 'e' + round + rw + rc.join();
        const small = `<small>Close shaves: ${shaves}${modeLabel() ? ` · ${esc(modeLabel())}` : ''}</small>`;
        if (rw === 'a' || rw === 'b') html = `<span class="w-${rw}"><span class="cy-t"><b>${esc(api.name(rw))}</b> takes round ${round}</span>${small}${stamps}</span>`;
        else html = `<span class="w-d is-heat"><span class="cy-t">DEAD HEAT</span><small>${esc(captionOf())}. Close shaves: ${shaves}. Fresh start next round.</small>${stamps}</span>`;
      }
      if (rpEl) {
        const on = stage === 'replay';
        if (on !== rpEl.classList.contains('is-on')) {
          rpEl.classList.toggle('is-on', on);
          if (on) {
            const cap = rpEl.querySelector('.cy-rp-cap');
            capText = captionOf();
            cap.innerHTML = capText;
            cap.style.animation = 'none'; void cap.offsetWidth; cap.style.animation = '';
          }
        }
      }
      if (key === msgKey) return;
      msgKey = key;
      msgEl.innerHTML = html;
      msgEl.classList.toggle('is-up', key[0] === 'e');
      if (key[0] === 'e' && sim && cell) {
        // keep the banner off the crash: it sits in the half of the board the crash isn't in
        const f = crashFocus();
        const y = (f[1] + 0.5) / sim.H;
        msgEl.style.top = (flip ? 1 - y : y) < 0.5 ? '76%' : '24%';
      } else msgEl.style.top = '';
    }
    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(250, now - (lastNow || now));
      lastNow = now;
      if (host) hostUpdate(now, dt);
      if (!host && sim && phase === 'run' && !paused && !sim.done) tdisp = Math.min(sim.t + 1, tdisp + dt / tickMs(cfg, Math.floor(tdisp)));
      else if (!host && sim) tdisp = sim.t;
      syncMsg(now);
      if (canvas) draw(now);
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
    const onVis = () => { if (host) syncPause(); else publishGuest(); if (!document.hidden) lastNow = 0; };
    document.addEventListener('visibilitychange', onVis);
    offs.push(() => document.removeEventListener('visibilitychange', onVis));
    // a phone turned on its side: the next round gets the grid that fits (the host agrees it with the guest)
    let rsT = 0;
    const onResize = () => {
      clearTimeout(rsT);
      rsT = setTimeout(() => {
        timers.delete(rsT);
        const np = prefNow();
        if (np === pref) return;
        pref = np;
        if (phase === 'pick' && pickShown) showPicker();
        if (!host) publishGuest();
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
        cell, cssW, cssH, stage: endStage(perf()), skipped, rc: rc.slice(), caption: sim && sim.done ? captionOf() : '',
        shaves: sim ? sim.a.sh + sim.b.sh : 0, tdisp, tms: cfg && sim ? tickMs(cfg, sim.t) : 0, picker: pickShown,
      }),
      go: (o) => go(o),
      view: (p) => (sim && cfg ? viewOf(p) : null),
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
