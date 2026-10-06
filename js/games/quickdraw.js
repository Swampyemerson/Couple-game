// Quick Draw: a western standoff reaction duel, best of 5 rounds (first to 3).
//
// Each round: "Steady…", then after a random 1.5–4.5 s, "DRAW!". First to fire after DRAW
// takes the round; firing before it is a foul and loses the round.
//
// One phone: a big button at each end (the top one upside down) and one shared signal.
// One computer: player A fires with the A key, player B with L.
// Two devices: fairness can't rely on clocks or on which message arrives first. The host
// announces a round with its delay; each device shows DRAW when ITS delay runs out and times
// the player locally (performance.now() from the DRAW frame to the tap's event timestamp).
// Devices report { reaction } or { foul, early }; the host compares reaction times, so a slow
// network never decides a duel. Ties within 5 ms are replayed. If both jump the gun, whoever
// jumped earlier (relative to their own DRAW) loses, exactly as it would on one phone.
// Rounds, shots and verdicts go through net.js reliable events, mirrored in presence so a
// device that missed something can always catch up from the latest state.
import { registerGame } from './core.js';
import { createNet } from './net.js';

const WIN = 3;             // best of 5
const TIE_MS = 5;
const MIN_DELAY = 1500;
const MAX_DELAY = 4500;
const LATE_MS = 650;       // one device: time for the slower hand to register after the first shot
const SLOW_MS = 4000;      // no shot this long after DRAW: too slow
const RESULT_MS = 2700;    // verdict on screen before the next round
const INTRO_MS = 1800;
const FINALE_MS = 1500;
const TICK_MS = 600;

const other = (w) => (w === 'a' ? 'b' : 'a');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function star(cx, cy, r1, r2, n) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1; const a = (Math.PI * i) / n;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

// A cowboy facing right, feet at (0,0). The arm pivots at the shoulder.
const FIGURE = `
  <ellipse class="qd-shadow" cx="0" cy="1.5" rx="15" ry="2.8"/>
  <g class="qd-body">
    <path class="qd-c" d="M-9 0 L-5.5 -31 L5.5 -31 L9 0 L3.6 0 L0 -17 L-3.6 0 Z"/>
    <path class="qd-c" d="M-10.5 -27 L-8 -50 Q0 -54.5 8 -50 L10.5 -27 Q0 -24.5 -10.5 -27 Z"/>
    <path class="qd-belt" d="M-10.2 -30.5 Q0 -28.5 10.2 -30.5"/>
    <circle class="qd-head" cx="0" cy="-58.5" r="7"/>
    <g class="qd-hat"><path d="M-16 -63.5 Q0 -60 16 -63.5 L13.5 -60.2 Q0 -57.6 -13.5 -60.2 Z"/><path d="M-7.2 -62.5 L-6 -72.5 Q0 -75.8 6 -72.5 L7.2 -62.5 Z"/></g>
    <g transform="translate(5.5 -47.5)"><g class="qd-arm">
      <rect class="qd-c" x="-2.6" y="-2.7" width="17.5" height="5.4" rx="2.7"/>
      <path class="qd-gun" d="M13 -4.4 H27 V-0.6 H19.6 L18.6 4.8 H13.6 Z"/>
      <polygon class="qd-flash" points="${star(33.5, -2.5, 8.5, 3, 7)}"/>
      <g class="qd-puff"><circle cx="31" cy="-5.5" r="3.2"/><circle cx="35.8" cy="-1.8" r="2.5"/><circle cx="30.2" cy="1.2" r="2.1"/></g>
    </g></g>
  </g>`;

const SCENE = (left, right, tall) => `
  <svg class="qd-svg" viewBox="${tall ? '0 -44 320 168' : '0 0 320 124'}" role="img" aria-label="Two gunslingers face each other at high noon">
    ${tall ? '<path class="qd-bird" d="M120 -18 q5 -5 10 0 q5 -5 10 0 M196 -30 q4 -4 8 0 q4 -4 8 0"/>' : ''}
    <circle class="qd-sun" cx="160" cy="98" r="34"/>
    <path class="qd-ground" d="M0 104 H320 V124 H0 Z"/>
    <path class="qd-tufts" d="M28 112 l4 -4 M118 116 l3 -3 l3 3 M196 113 l4 -4 M292 117 l3 -3 l3 3 M74 119 h8 M236 120 h8"/>
    <g class="qd-cactus" transform="translate(30 104) scale(0.8)"><path d="M-3.5 0 V-30 Q0 -34 3.5 -30 V0 Z M-3.5 -14 H-8.5 Q-11 -14 -11 -17 V-23 Q-8.8 -25.6 -6.8 -23 V-19 H-3.5 Z M3.5 -18 H8 Q10.5 -18 10.5 -21 V-26 Q8.4 -28.4 6.4 -26 V-22.4 H3.5 Z"/></g>
    <g class="qd-cactus" transform="translate(292 104) scale(0.62)"><path d="M-3.5 0 V-30 Q0 -34 3.5 -30 V0 Z M-3.5 -14 H-8.5 Q-11 -14 -11 -17 V-23 Q-8.8 -25.6 -6.8 -23 V-19 H-3.5 Z M3.5 -18 H8 Q10.5 -18 10.5 -21 V-26 Q8.4 -28.4 6.4 -26 V-22.4 H3.5 Z"/></g>
    <path class="qd-horizon" d="M0 104 H320"/>
    <g class="qd-fig" data-w="${left}" transform="translate(86 104)">${FIGURE}</g>
    <g class="qd-fig" data-w="${right}" transform="translate(234 104) scale(-1 1)">${FIGURE}</g>
  </svg>`;

const notches = (w) => `<span class="qd-notches" data-w="${w}" aria-hidden="true">${'<i></i>'.repeat(WIN)}</span>`;

registerGame({
  id: 'quickdraw',
  title: 'Quick Draw',
  blurb: 'Wait for it. DRAW! Fastest hand wins.',
  kind: 'live',
  team: false,
  tags: ['silly', 'quick'],
  platforms: ['phone', 'computer'],
  minutes: 2,
  howTo: [
    'Hands off the trigger while it says Steady.',
    'When it says DRAW, fire: tap your button (computer: A or L, or Space when live).',
    'Fire too soon and you lose the round.',
    'First to 3 rounds wins.',
  ],
  css: `
    .g-qd { --qd-gap: 10px; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--qd-gap); padding: 2px 0 4px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; font-family: var(--g-font-body); color: var(--g-ink); }
    .g-qd.is-live { touch-action: manipulation; cursor: crosshair; }
    .g-qd .qd-mid { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
    .g-qd .qd-scene { position: relative; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow); overflow: hidden; transition: background-color 0.06s; }
    .g-qd[data-phase="draw"] .qd-scene { background: var(--g-hl); }
    .g-qd .qd-svg { display: block; width: 100%; height: auto; max-height: 34vh; margin: 0 auto; overflow: visible; }
    .g-qd .qd-bird { fill: none; stroke: var(--g-ink); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .g-qd .qd-sun { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 2.5; }
    .g-qd[data-phase="draw"] .qd-sun { fill: var(--g-card); }
    .g-qd .qd-ground { fill: var(--g-hl-soft, var(--g-bg)); }
    .g-qd .qd-horizon { stroke: var(--g-ink); stroke-width: 2.5; }
    .g-qd .qd-tufts { stroke: var(--g-ink); stroke-width: 1.6; fill: none; stroke-linecap: round; opacity: 0.55; }
    .g-qd .qd-cactus path { fill: var(--g-line); stroke: var(--g-ink); stroke-width: 1.8; stroke-linejoin: round; }
    .g-qd .qd-fig[data-w="a"] { --c: var(--p-a); }
    .g-qd .qd-fig[data-w="b"] { --c: var(--p-b); }
    .g-qd .qd-fig .qd-c { fill: var(--c); stroke: var(--g-ink); stroke-width: 2; stroke-linejoin: round; }
    .g-qd .qd-fig .qd-head { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 2; }
    .g-qd .qd-fig .qd-belt { fill: none; stroke: var(--g-ink); stroke-width: 2.4; }
    .g-qd .qd-fig .qd-hat path, .g-qd .qd-fig .qd-gun { fill: var(--g-ink); stroke: var(--g-ink); stroke-width: 1.4; stroke-linejoin: round; }
    .g-qd .qd-shadow { fill: var(--g-edge, var(--g-ink)); opacity: 0.22; }
    .g-qd .qd-flash { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 1.6; stroke-linejoin: round; display: none; }
    .g-qd .qd-puff circle { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 1.4; }
    .g-qd .qd-puff { display: none; }
    .g-qd .qd-fig.is-flash .qd-flash, .g-qd .qd-fig.is-puff .qd-puff { display: inline; }
    .g-qd .qd-arm, .g-qd .qd-body { transform-box: view-box; transform-origin: 0 0; }
    .g-qd .qd-arm { transform: rotate(76deg); transition: transform 0.09s cubic-bezier(0.3, 1.5, 0.5, 1); }
    .g-qd .qd-fig.is-up .qd-arm { transform: rotate(-4deg); }
    .g-qd .qd-body { transition: transform 0.5s cubic-bezier(0.55, 0, 0.75, 0.45); }
    .g-qd .qd-fig.is-down .qd-body { transform: rotate(-80deg); }
    .g-qd .qd-hat { transform-box: fill-box; transform-origin: 50% 80%; transition: transform 0.55s cubic-bezier(0.2, 0.7, 0.4, 1), opacity 0.55s; }
    .g-qd .qd-fig.is-hatless .qd-hat { transform: translate(-16px, -34px) rotate(-75deg); opacity: 0; }

    .g-qd .qd-sig { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 5.6rem; justify-content: center; }
    .g-qd .qd-word { font-family: var(--g-font-display); font-weight: 900; font-size: clamp(1.9rem, 9.5vw, 3rem); line-height: 1.05; letter-spacing: 0.01em; padding: 2px 12px; border: 3px solid transparent; border-radius: 10px; }
    .g-qd .qd-sig.is-steady .qd-word { color: var(--g-muted); animation: qd-breathe 1.2s ease-in-out infinite; }
    .g-qd .qd-sig.is-draw .qd-word { background: var(--g-hl); color: var(--g-on-ink); border-color: var(--g-ink); box-shadow: var(--g-shadow-lg, var(--g-shadow)); transform: rotate(-3deg); font-size: clamp(2.4rem, 13vw, 3.8rem); animation: qd-pop 0.16s cubic-bezier(0.2, 1.6, 0.4, 1) both; }
    .g-qd .qd-sig.is-foul .qd-word { color: var(--g-bad); }
    .g-qd .qd-sig.is-bang .qd-word { color: var(--qd-win); text-shadow: 3px 3px 0 var(--g-edge, var(--g-ink)); transform: rotate(-4deg); animation: qd-pop 0.22s cubic-bezier(0.2, 1.6, 0.4, 1) both; }
    .g-qd .qd-sig.is-bang.p-a { --qd-win: var(--p-a); } .g-qd .qd-sig.is-bang.p-b { --qd-win: var(--p-b); }
    .g-qd .qd-line { font-weight: 800; font-size: 0.98rem; min-height: 1.3em; }
    .g-qd .qd-times { font-weight: 700; font-size: 0.95rem; color: var(--g-ink); min-height: 1.3em; font-variant-numeric: tabular-nums; }
    .g-qd .qd-times b.t-a { color: var(--p-a-text, var(--p-a)); } .g-qd .qd-times b.t-b { color: var(--p-b-text, var(--p-b)); }
    .g-qd .qd-times .qd-sep { color: var(--g-muted); margin: 0 4px; }

    .g-qd .qd-tally { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 800; }
    .g-qd .qd-who { display: inline-flex; align-items: center; gap: 8px; }
    .g-qd .qd-who.t-a { color: var(--p-a-text, var(--p-a)); } .g-qd .qd-who.t-b { color: var(--p-b-text, var(--p-b)); }
    .g-qd .qd-to { font-size: 0.8rem; color: var(--g-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    .g-qd .qd-notches { display: inline-flex; gap: 5px; }
    .g-qd .qd-notches i { width: 10px; height: 22px; border: 2px solid var(--g-ink); border-radius: 2px; background: var(--g-card); transform: skewX(-14deg); }
    .g-qd .qd-notches[data-w="a"] i.on { background: var(--p-a); }
    .g-qd .qd-notches[data-w="b"] i.on { background: var(--p-b); }
    .g-qd .qd-notches i.on.new { animation: qd-pop 0.3s cubic-bezier(0.2, 1.6, 0.4, 1) both; }

    .g-qd .qd-pads { display: flex; gap: 12px; flex: 1; min-height: 0; }
    .g-qd .qd-pad { flex: 1; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 104px; padding: 10px; border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: var(--g-shadow-lg, var(--g-shadow)); color: var(--g-on-ink); font-family: var(--g-font-body); touch-action: manipulation; transition: transform 0.06s, box-shadow 0.06s, opacity 0.2s; }
    .g-qd .qd-pad[data-w="a"] { background: var(--p-a); } .g-qd .qd-pad[data-w="b"] { background: var(--p-b); }
    .g-qd .qd-pad.is-press { transform: translate(4px, 4px); box-shadow: 0 0 0 var(--g-edge, var(--g-ink)); }
    .g-qd .qd-pad.is-idle { background: var(--g-card); color: var(--g-muted); }
    .g-qd .qd-pad.is-idle .qd-pad-name { color: var(--g-ink); }
    .g-qd .qd-pad-cta { font-family: var(--g-font-display); font-weight: 900; font-size: clamp(1.5rem, 7vw, 2.1rem); line-height: 1; letter-spacing: 0.04em; }
    .g-qd .qd-pad-name { font-weight: 900; font-size: 1rem; }
    .g-qd .qd-pad-hint { font-weight: 800; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px; }
    .g-qd .qd-pad .qd-notches i { border-color: var(--g-ink); }
    .g-qd .qd-pad .qd-notches[data-w] i { background: var(--g-card); }
    .g-qd .qd-pad .qd-notches[data-w] i.on { background: var(--g-ink); }
    .g-qd kbd { display: inline-grid; place-items: center; min-width: 30px; height: 30px; padding: 0 7px; font: 900 1rem/1 var(--g-font-body); color: var(--g-ink); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 7px; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }

    .g-qd.is-phone { display: grid; grid-template-rows: minmax(92px, 1fr) auto minmax(92px, 1fr); }
    .g-qd.is-phone .qd-pad { min-height: 0; }
    .g-qd.is-phone .qd-top { transform: rotate(180deg); }
    .g-qd.is-phone .qd-pad.qd-top { box-shadow: -6px -6px 0 var(--g-edge, var(--g-ink)); }
    .g-qd.is-phone .qd-pad.qd-top.is-press { transform: rotate(180deg) translate(-4px, -4px); box-shadow: none; }
    .g-qd.is-phone .qd-sig { min-height: 4.4rem; }
    .g-qd.is-phone .qd-word { font-size: clamp(1.6rem, 8vw, 2.4rem); }
    .g-qd.is-phone .qd-sig.is-draw .qd-word { font-size: clamp(2rem, 10vw, 2.9rem); }
    .g-qd.is-phone .qd-line, .g-qd.is-phone .qd-times { font-size: 0.86rem; }
    .g-qd.is-phone .qd-svg { max-height: 19vh; }
    .g-qd.is-desk { max-width: 620px; width: 100%; margin: 0 auto; }
    .g-qd.is-desk .qd-pads { flex: 0 0 auto; }
    .g-qd.is-desk .qd-pad { min-height: 150px; }
    .g-qd.is-live .qd-mid, .g-qd.is-desk .qd-mid { flex: 1; justify-content: center; }
    .g-qd.is-live .qd-pads { flex: 0 0 auto; height: clamp(116px, 25vh, 210px); max-width: 520px; width: 100%; margin: 0 auto; }

    @keyframes qd-pop { from { transform: scale(1.5) rotate(-3deg); opacity: 0; } to { opacity: 1; } }
    @keyframes qd-breathe { 50% { opacity: 0.55; } }
    @media (prefers-reduced-motion: reduce) {
      .g-qd *, .g-qd *::before { animation: none !important; transition: none !important; }
    }
  `,
  mount(el, api) {
    const local = api.mode === 'local';
    const coarse = matchMedia('(pointer: coarse)').matches;
    const layout = local ? (coarse ? 'phone' : 'desk') : 'live';
    const ref = local || api.isHost;            // the referee decides rounds
    const me = local ? null : api.me;
    const sides = local ? ['a', 'b'] : [me];    // whose trigger this device holds
    const net = local ? null : createNet(api);
    const key = Math.random().toString(36).slice(2, 9);
    const left = local ? 'a' : me;              // who stands on the left of the scene
    const right = other(left);
    const N = (w) => esc(api.name(w));

    // ── DOM ──
    const pad = (w, top) => `<button type="button" class="qd-pad${top ? ' qd-top' : ''}" data-w="${w}" aria-label="${N(w)}: fire">
        ${local ? `<span class="qd-pad-name">${N(w)}</span>${notches(w)}` : ''}
        <span class="qd-pad-cta">FIRE</span>
        ${layout === 'desk' ? `<span class="qd-pad-hint"><kbd>${w === 'a' ? 'A' : 'L'}</kbd> key</span>` : ''}
        ${layout === 'live' && !coarse ? '<span class="qd-pad-hint"><kbd>Space</kbd> or click</span>' : ''}
      </button>`;
    const sig = (flip) => `<div class="qd-sig${flip ? ' qd-top' : ''}" aria-live="${flip ? 'off' : 'assertive'}"><div class="qd-word"></div><div class="qd-line"></div><div class="qd-times"></div></div>`;
    const scene = `<div class="qd-scene">${SCENE(left, right, layout !== 'phone')}</div>`;
    if (layout === 'phone') {
      el.innerHTML = `<div class="g-qd is-phone" data-phase="intro">${pad('b', true)}<div class="qd-mid">${sig(true)}${scene}${sig(false)}</div>${pad('a', false)}</div>`;
    } else if (layout === 'desk') {
      el.innerHTML = `<div class="g-qd is-desk" data-phase="intro"><div class="qd-mid">${scene}${sig(false)}</div><div class="qd-pads">${pad('a')}${pad('b')}</div></div>`;
    } else {
      el.innerHTML = `<div class="g-qd is-live" data-phase="intro"><div class="qd-mid">
        <div class="qd-tally"><span class="qd-who t-${left}">${N(left)} ${notches(left)}</span><span class="qd-to">first to ${WIN}</span><span class="qd-who t-${right}">${notches(right)} ${N(right)}</span></div>
        ${scene}${sig(false)}</div><div class="qd-pads">${pad(me)}</div></div>`;
    }
    const root = el.querySelector('.g-qd');
    const $$ = (s) => [...root.querySelectorAll(s)];
    const figs = { a: root.querySelector('.qd-fig[data-w="a"]'), b: root.querySelector('.qd-fig[data-w="b"]') };

    // ── timers (all tracked, all cleared in destroy) ──
    let dead = false;
    const timers = new Set();
    const rafs = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms); timers.add(id); return id; };
    const cancel = (id) => { if (id) { clearTimeout(id); timers.delete(id); } };
    const onFrame = (fn) => { const id = requestAnimationFrame((t) => { rafs.delete(id); if (!dead) fn(t); }); rafs.add(id); return id; };

    // ── state ──
    let phase = 'intro';       // intro | steady | draw | wait | result | paused | over
    let tally = { a: 0, b: 0 };
    let cur = null;            // this device's round: { r, delay, startedAt, t0, res: {a, b}, ids: [] }
    let lastR = 0;             // newest round started here
    let verdict = null;
    let hostKey = ref ? key : null;
    let staleKey = null;
    let paused = false;
    let finishT = 0;

    // ── one round, on this device ──
    function endRound() {
      if (cur) cur.ids.forEach(cancel);
    }
    function beginRound(r, delay) {
      endRound();
      cur = { r, delay, startedAt: performance.now(), t0: null, res: {}, ids: [] };
      lastR = Math.max(lastR, r);
      phase = 'steady';
      pose({});
      paint();
      // A steady clock tick, independent of the delay, so it gives nothing away.
      const tick = () => { if (cur && cur.r === r && phase === 'steady') { api.sfx('tick'); cur.ids.push(later(tick, TICK_MS)); } };
      cur.ids.push(later(tick, TICK_MS / 2));
      cur.ids.push(later(() => onFrame(() => showDraw(r)), Math.max(0, delay)));
    }
    function showDraw(r) {
      if (!cur || cur.r !== r || phase !== 'steady') return;
      cur.t0 = performance.now(); // this frame paints DRAW
      phase = 'draw';
      paint();
      api.sfx('hit');
      cur.ids.push(later(() => tooSlow(r), SLOW_MS));
    }
    function tooSlow(r) {
      if (!cur || cur.r !== r) return;
      for (const w of sides) if (!cur.res[w] && (phase === 'draw' || phase === 'wait')) record(w, { slow: true });
    }
    const stamp = (e) => {
      const n = performance.now(); const t = e && e.timeStamp;
      return t > 0 && t <= n + 1 && n - t < 1000 ? t : n;
    };
    function fire(w, ts) {
      if (dead || paused || !cur || !sides.includes(w) || cur.res[w]) return;
      if (phase === 'steady') {
        api.sfx('bad');
        record(w, { foul: true, early: Math.max(1, Math.round(cur.delay - (ts - cur.startedAt))) });
      } else if (phase === 'draw') {
        api.sfx('pop');
        api.haptic(20);
        record(w, { reaction: Math.max(0, Math.round((ts - cur.t0) * 10) / 10) });
      }
    }
    function record(w, res) {
      cur.res[w] = res;
      const f = figs[w];
      if (f) { f.classList.add('is-up'); f.classList.toggle('is-flash', !!res.reaction || res.reaction === 0); f.classList.toggle('is-puff', !!res.foul); }
      if (!local) { phase = 'wait'; paint(); }
      if (ref) refReceive(w, cur.r, res);
      else {
        const shot = { hk: hostKey, r: cur.r, ...res };
        net.send('shot', shot);
        myShot = shot;
        publish();
      }
    }

    // ── referee (host, or the one device) ──
    let R = null;              // { r, delay, res: {a, b}, decided, grace, late, safety }
    let seq = 0;
    let nextT = 0;
    function refStart() {
      nextT = 0;
      if (dead || paused || phase === 'over') return;
      const r = ++seq;
      const delay = Math.round(MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY));
      R = { r, delay, res: { a: null, b: null }, decided: false, at: performance.now() };
      if (!local) {
        net.send('round', { hk: key, r, delay });
        // a guest that never reports (gone, or its shot lost) can't stall the duel
        R.safety = later(() => refDecide(r), delay + SLOW_MS + 4000);
      }
      beginRound(r, delay);
      publish();
    }
    const recvLog = []; // arrival order at the referee (tests check it never decides a duel)
    function refReceive(w, r, res) {
      if (!R || R.r !== r || R.decided || R.res[w]) return;
      R.res[w] = res;
      recvLog.push({ w, r, at: Math.round(performance.now()) });
      if (recvLog.length > 40) recvLog.shift();
      if (R.res.a && R.res.b) { refDecide(r); return; }
      if (local) {
        if (res.foul) refDecide(r);
        else if (!R.late) R.late = later(() => refDecide(r), LATE_MS);
      } else if (res.foul && !R.grace) {
        // the other player may have jumped too, a moment earlier, with the news still in flight
        R.grace = later(() => refDecide(r), Math.max(220, net.rtt + 150));
      }
    }
    function refDecide(r) {
      if (!R || R.r !== r || R.decided) return;
      R.decided = true;
      cancel(R.grace); cancel(R.late); cancel(R.safety);
      const A = R.res.a; const B = R.res.b;
      const rt = (x) => (x && Number.isFinite(x.reaction) ? x.reaction : null);
      let w = null; let why;
      if (A && A.foul && B && B.foul) { why = 'fouls'; w = A.early === B.early ? null : A.early > B.early ? 'b' : 'a'; }
      else if (A && A.foul) { why = 'foul'; w = 'b'; }
      else if (B && B.foul) { why = 'foul'; w = 'a'; }
      else {
        const ra = rt(A); const rb = rt(B);
        if (ra == null && rb == null) why = 'none';
        else if (ra == null) { why = 'time'; w = 'b'; }
        else if (rb == null) { why = 'time'; w = 'a'; }
        else if (Math.abs(ra - rb) <= TIE_MS) why = 'tie';
        else { why = 'time'; w = ra < rb ? 'a' : 'b'; }
      }
      if (w) tally[w]++;
      const v = { hk: key, r, w, why, a: A, b: B, tally: { ...tally } };
      if (tally.a >= WIN || tally.b >= WIN) v.res = finalResult(v);
      if (!local) net.send('verdict', v);
      applyVerdict(v);
      publish();
      if (v.res) finishT = later(() => api.finish(v.res), FINALE_MS);
      else nextT = later(refStart, RESULT_MS);
    }
    const bests = { a: null, b: null };
    function finalResult(v) {
      const w = v.tally.a >= WIN ? 'a' : 'b';
      const fast = ['a', 'b'].filter((x) => bests[x] != null).sort((x, y) => bests[x] - bests[y])[0];
      return { winner: w, sub: `${v.tally[w]}–${v.tally[other(w)]}${fast ? ` · fastest draw ${Math.round(bests[fast])} ms (${api.name(fast)})` : ''}` };
    }

    // ── verdicts (both devices) ──
    function applyVerdict(v) {
      if (!v || (verdict && verdict.hk === v.hk && verdict.r >= v.r)) return;
      for (const x of ['a', 'b']) { const rr = v[x] && v[x].reaction; if (Number.isFinite(rr) && (bests[x] == null || rr < bests[x])) bests[x] = rr; }
      const prev = tally;
      verdict = v;
      tally = { ...v.tally };
      endRound();
      phase = v.res ? 'over' : 'result';
      const P = {};
      for (const x of ['a', 'b']) {
        const res = v[x];
        P[x] = { up: !!res && !res.slow, flash: !!res && Number.isFinite(res.reaction), puff: !!res && !!res.foul };
      }
      if (v.w) {
        const l = other(v.w);
        P[v.w].up = true; P[v.w].flash = true; P[v.w].puff = false;
        if (v.why === 'time') { P[l].down = true; P[l].flash = false; } else P[l].hatless = true;
      }
      pose(P);
      api.setScore(tally);
      paint(prev);
      if (!v.res) api.sfx(v.w ? (local || v.w === me ? 'win' : 'lose') : 'flip');
      else api.sfx('pop');
      if (!ref && v.res && !finishT) finishT = later(() => api.finish(v.res), FINALE_MS + 400); // if the engine's own finish message is lost
    }
    function pose(P) {
      for (const x of ['a', 'b']) {
        const f = figs[x]; const p = P[x] || {};
        f.classList.toggle('is-up', !!p.up);
        f.classList.toggle('is-flash', !!p.flash);
        f.classList.toggle('is-puff', !!p.puff);
        f.classList.toggle('is-down', !!p.down);
        f.classList.toggle('is-hatless', !!p.hatless);
      }
    }

    // ── pausing ──
    function pause() {
      if (paused || phase === 'over') return;
      paused = true;
      endRound(); cur = null;
      if (ref) { if (R && !R.decided) { cancel(R.grace); cancel(R.late); cancel(R.safety); R = null; } cancel(nextT); nextT = 0; }
      phase = 'paused';
      pose({});
      paint();
      publish();
    }
    function resume() {
      if (!paused) return;
      paused = false;
      phase = verdict && verdict.res ? 'over' : 'intro';
      paint();
      if (ref && phase !== 'over') nextT = later(refStart, 1400);
      publish();
    }
    let partnerHere = local || api.partnerHere;
    let partnerAway = false;
    const shouldPause = () => document.hidden || (!local && (!partnerHere || partnerAway));
    const checkPause = () => { if (shouldPause()) pause(); else resume(); };

    // ── network ──
    let myShot = null;
    let n = 0;
    function publish() {
      if (local) return;
      if (ref) {
        api.setPresence({
          k: key, n: ++n, r: R ? R.r : seq, ph: paused ? 'paused' : R && !R.decided ? 'steady' : phase === 'over' ? 'over' : 'result',
          delay: R ? R.delay : 0, el: R ? Math.round(performance.now() - R.at) : 0, tally, v: verdict, away: document.hidden ? 1 : 0,
        });
      } else {
        api.setPresence({ k: key, n: ++n, hk: hostKey, r: myShot ? myShot.r : 0, res: myShot, away: document.hidden ? 1 : 0 });
      }
    }
    function adoptHost(k) {
      if (!k || k === staleKey) return false;
      if (k === hostKey) return true;
      // a new host game (first contact, or the host came back with a fresh mount)
      hostKey = k; lastR = 0; verdict = null; tally = { a: 0, b: 0 }; myShot = null;
      endRound(); cur = null;
      if (!paused) { phase = 'intro'; pose({}); }
      api.setScore(tally); paint();
      return true;
    }
    function onHostState(S) {
      if (!S || !S.k || S.k === staleKey) return;
      if (!adoptHost(S.k)) return;
      const away = !!S.away;
      if (away !== partnerAway) { partnerAway = away; checkPause(); }
      if (S.v && S.v.hk === hostKey) applyVerdict(S.v);
      if (S.ph === 'steady' && S.r > lastR && !paused) beginRound(S.r, Math.max(400, S.delay - S.el - 40));
    }
    function onGuestState(st) {
      if (!st) return;
      const away = !!st.away;
      if (away !== partnerAway) { partnerAway = away; checkPause(); }
      if (st.hk === key && st.res && R) refReceive('b', st.r, stripShot(st.res));
    }
    const stripShot = (s) => {
      const out = {};
      if (s.foul) { out.foul = true; out.early = Number(s.early) || 1; } else if (s.slow) out.slow = true;
      else if (Number.isFinite(s.reaction)) out.reaction = s.reaction;
      return out;
    };

    // ── paint ──
    const fmt = (res) => (!res ? '—' : res.foul ? 'jumped early' : res.slow ? 'too slow' : `${Math.round(res.reaction)} ms`);
    function timesHTML(v) {
      const order = v.w ? [v.w, other(v.w)] : ['a', 'b'];
      return order.map((x) => `<b class="t-${x}">${N(x)}</b> ${fmt(v[x])}`).join('<span class="qd-sep">·</span>');
    }
    function sigState() {
      const round = `Round ${Math.min(tally.a + tally.b + 1, WIN * 2 - 1)}`;
      switch (phase) {
        case 'intro': return { word: 'Ready', line: `First to ${WIN}. Fire on DRAW.`, cls: '' };
        case 'steady': return { word: 'Steady…', line: round, cls: 'is-steady' };
        case 'draw': return { word: 'DRAW!', line: '', cls: 'is-draw' };
        case 'wait': {
          const mine = cur && cur.res[me];
          if (mine && mine.foul) return { word: 'Too early!', line: `Waiting for ${N(other(me))}…`, cls: 'is-foul' };
          if (mine && mine.slow) return { word: 'Too slow', line: `Waiting for ${N(other(me))}…`, cls: 'is-foul' };
          return { word: mine ? `${Math.round(mine.reaction)} ms` : '…', line: `Waiting for ${N(other(me))}…`, cls: '' };
        }
        case 'paused': return { word: 'Paused', line: local ? 'Back in a moment' : `Waiting for ${N(other(me))}…`, cls: '' };
        default: {
          const v = verdict;
          if (!v) return { word: '', line: '', cls: '' };
          const l = v.w && other(v.w);
          let line;
          if (v.why === 'tie') line = 'Dead heat. Go again.';
          else if (v.why === 'none') line = 'Nobody fired. Again.';
          else if (v.why === 'fouls') line = v.w ? `Both jumped. ${N(l)} jumped first.` : 'Both jumped. Again.';
          else if (v.why === 'foul') line = `${N(l)} fired early. ${N(v.w)} takes it.`;
          else line = `${N(v.w)} takes the round.`;
          if (v.res) line = `${N(v.w)} wins the duel!`;
          const word = v.w ? 'BANG!' : v.why === 'tie' ? 'Dead heat' : 'Again';
          return { word, line, cls: v.w ? `is-bang p-${v.w}` : '', times: v.why === 'none' ? '' : timesHTML(v) };
        }
      }
    }
    function paint(prevTally) {
      root.dataset.phase = phase;
      const st = sigState();
      for (const s of $$('.qd-sig')) {
        s.className = `qd-sig${s.classList.contains('qd-top') ? ' qd-top' : ''}${st.cls ? ` ${st.cls}` : ''}`;
        s.querySelector('.qd-word').textContent = st.word;
        s.querySelector('.qd-line').innerHTML = st.line;
        s.querySelector('.qd-times').innerHTML = st.times || '';
      }
      for (const nEl of $$('.qd-notches')) {
        const w = nEl.dataset.w;
        [...nEl.children].forEach((i, k) => {
          i.classList.toggle('on', k < tally[w]);
          i.classList.toggle('new', !!prevTally && k < tally[w] && k >= prevTally[w]);
        });
      }
      for (const p of $$('.qd-pad')) {
        const w = p.dataset.w;
        const armed = (phase === 'steady' || phase === 'draw') && cur && !cur.res[w];
        p.classList.toggle('is-idle', !armed);
      }
    }

    // ── input ──
    const offs = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); offs.push(() => t.removeEventListener(ev, fn, o)); };
    const press = (w) => {
      const p = root.querySelector(`.qd-pad[data-w="${w}"]`);
      if (!p) return;
      p.classList.add('is-press');
      later(() => p.classList.remove('is-press'), 110);
    };
    on(root, 'pointerdown', (e) => {
      if (e.button > 0) return;
      const p = e.target.closest('.qd-pad');
      let w = p ? p.dataset.w : null;
      if (!w && layout === 'live') w = me; // live: anywhere on the duel fires
      if (!w) return;
      if (e.pointerType !== 'mouse' && e.clientX < 20) return; // iOS back-swipe zone
      e.preventDefault();
      press(w);
      fire(w, stamp(e));
    });
    on(root, 'touchstart', (e) => { if (e.cancelable && e.target.closest('.qd-pad, .qd-scene, .qd-sig')) e.preventDefault(); }, { passive: false });
    on(root, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      let w = null;
      if (local) w = e.code === 'KeyA' || e.key === 'a' || e.key === 'A' ? 'a' : e.code === 'KeyL' || e.key === 'l' || e.key === 'L' ? 'b' : null;
      else if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') w = me;
      if (!w) return;
      if (t && t.closest && t.closest('button, a, [tabindex]') && !t.closest('.g-qd')) return; // e.g. Space on the end card's buttons
      e.preventDefault();
      press(w);
      fire(w, stamp(e));
    });
    on(document, 'visibilitychange', () => { publish(); checkPause(); });

    if (!local) {
      offs.push(api.onPartnerHere((here) => { partnerHere = here; if (!here) partnerAway = false; checkPause(); }));
      if (ref) {
        offs.push(net.on('shot', (d) => { if (d && d.hk === key) refReceive('b', d.r, stripShot(d)); }));
        offs.push(api.onPartnerState(onGuestState));
      } else {
        offs.push(net.on('round', (d) => {
          if (!d || !adoptHost(d.hk) || paused) return;
          if (d.r > lastR && !(verdict && verdict.hk === d.hk && verdict.r >= d.r)) beginRound(d.r, d.delay);
        }));
        offs.push(net.on('verdict', (v) => { if (v && adoptHost(v.hk)) applyVerdict(v); }));
        const s0 = api.partnerState();
        if (s0 && s0.ph === 'over') staleKey = s0.k; // the last duel's final state, still in presence
        else if (s0) onHostState(s0);
        offs.push(api.onPartnerState(onHostState));
      }
    }

    api.setScore(tally);
    paint();
    if (ref) nextT = later(refStart, INTRO_MS);
    publish();
    if (document.hidden) checkPause();

    if (location.port) {
      window.__qdTest = {
        state: () => ({ phase, tally: { ...tally }, verdict, r: cur ? cur.r : 0, layout, coarse, paused, res: cur ? { ...cur.res } : null }),
        timers: () => timers.size + rafs.size,
        recv: () => recvLog.slice(),
      };
    }

    return {
      destroy() {
        dead = true;
        timers.forEach((id) => clearTimeout(id)); timers.clear();
        rafs.forEach((id) => cancelAnimationFrame(id)); rafs.clear();
        offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
        if (net) net.destroy();
        if (window.__qdTest) delete window.__qdTest;
      },
    };
  },
});
