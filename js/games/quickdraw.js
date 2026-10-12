// Quick Draw: a western standoff reaction duel. Docs: docs/games/quickdraw.md.
//
// Each round: "Steady…", then after a random wait, the signal (DRAW!). First to fire after it
// takes the round; firing before it is a foul. Under 100 ms is a guess, so it's a foul too.
//
// Duel packs: Classic · Decoys (fake DRAW words) · Colour (the lantern turns YELLOW) · Bell (it
// rings and swings, so a muted phone still sees it) · Mixed (a different pack every round).
// Series: best of 3 / 5 / 9, or Showdown (first to 5, win by 2). Tied at match point is a
// "Both barrels" decider: two real draws, fire on the second.
//
// One phone: a big button at each end (the top one upside down) and one shared signal.
// One computer: player A fires with the A key, player B with L.
// Two devices: the host (referee) announces each round with a SHARED-CLOCK start time `at`
// (net.now()), the delay and the cue list. Both devices run the same timeline against the shared
// clock, so Steady and the signal start at the same instant. A reaction is timed locally (from the
// painted signal frame to the tap's event timestamp), so latency never decides a duel; a foul
// carries `rel`, the tap's shared-clock time relative to the real signal. The host compares
// those: two fouls within 30 ms are a re-round, otherwise the earlier jump loses. Once one valid
// reaction R is in and the other player can't beat it any more, the host decides (about
// R + rtt + 250 ms) instead of waiting for the slow hand.
import { registerGame } from './core.js';
import { createNet } from './net.js';

const TIE_MS = 5;           // dead heat
const PHOTO_MS = 15;        // closer than this is a photo finish
const FALSE_START = 100;    // a "reaction" under this is a guess: a foul
const DOUBLE_MS = 30;       // two fouls this close are a re-round
const LATE_MS = 450;        // one phone: time for the slower hand to register after the first shot
const SLOW_MS = 4000;       // no shot this long after the signal: too slow
const RESULT_MS = 2600;     // verdict on screen before the next round
const INTRO_MS = 1600;
const FINALE_MS = 1500;
const DECOY_MS = 750;       // how long a decoy stays up
const SERIES = {
  '3': { win: 2, by: 1, name: 'Best of 3' },
  '5': { win: 3, by: 1, name: 'Best of 5' },
  '9': { win: 5, by: 1, name: 'Best of 9' },
  sd: { win: 5, by: 2, cap: 15, name: 'Showdown' },   // after `cap` decided rounds the next one is sudden death
};
const PACKS = {
  classic: { name: 'Classic', desc: 'Wait for DRAW. Fire first.' },
  decoys: { name: 'Decoys', desc: 'Fake words sneak in: BRAW, DRAWL, DREW. Only DRAW counts.' },
  colour: { name: 'Colour', desc: 'Fire when the lantern turns YELLOW. Other colours are bluffs.' },
  bell: { name: 'Bell', desc: 'Fire when the bell rings. It swings too, so muted is fine.' },
  mixed: { name: 'Mixed', desc: 'A different pack every round, announced at Steady.' },
  surprise: { name: 'Surprise me', desc: 'We pick a pack for you.' },
};
const PACK_ORDER = ['classic', 'decoys', 'colour', 'bell', 'mixed', 'surprise'];
const KIND_HINT = { classic: '', decoys: 'Only DRAW counts', colour: 'Fire on YELLOW', bell: 'Fire on the bell' };
const realWord = (kind) => (kind === 'colour' ? 'YELLOW!' : kind === 'bell' ? 'DING!' : 'DRAW!');
const KIND_SIGN = { classic: 'CLASSIC', decoys: 'DECOYS', colour: 'COLOUR', bell: 'BELL' };
const DECOY_WORDS = ['BRAW!', 'DRAWL', 'DREW', 'DRAW?', 'DRAMA'];
const DECOY_COLOURS = [['BLUE', '--p-a'], ['PINK', '--p-b'], ['GREEN', '--g-good']];

const other = (w) => (w === 'a' ? 'b' : 'a');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rnd = (a, b) => a + Math.random() * (b - a);
const pickOf = (arr) => arr[Math.floor(Math.random() * arr.length)];
const seriesOf = (cfg) => SERIES[cfg && cfg.s] || SERIES['5'];
const isWin = (t, cfg) => { const S = seriesOf(cfg); return (t.a >= S.win && t.a - t.b >= S.by) || (t.b >= S.win && t.b - t.a >= S.by); };
const winnerOf = (t) => (t.a > t.b ? 'a' : 'b');
/** Showdown only: the cap is reached without a winner, so the next round decides. */
const suddenOf = (t, cfg) => { const S = seriesOf(cfg); return !!S.cap && t.a + t.b >= S.cap && !isWin(t, cfg); };
/** The real signal's time (ms after the round's `at`). */
const drawAt = (rd) => rd.delay + (rd.gap || 0);
/** Everything that happens on screen after `at`, the same on both devices. */
function cuesOf(rd) {
  const out = [];
  (rd.decoys || []).forEach((t, i) => out.push({ t, k: 'decoy', i: (rd.dw && rd.dw[i]) | 0 }));
  if (rd.gap) out.push({ t: rd.delay, k: 'first' });
  out.push({ t: drawAt(rd), k: 'real' });
  return out.sort((x, y) => x.t - y.t);
}
function parseLast(s) {
  const [p, se] = String(s || '').split(':');
  return { p: PACKS[p] ? p : 'classic', s: SERIES[se] ? se : '5' };
}

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

const CACTUS = 'M-3.5 0 V-30 Q0 -34 3.5 -30 V0 Z M-3.5 -14 H-8.5 Q-11 -14 -11 -17 V-23 Q-8.8 -25.6 -6.8 -23 V-19 H-3.5 Z M3.5 -18 H8 Q10.5 -18 10.5 -21 V-26 Q8.4 -28.4 6.4 -26 V-22.4 H3.5 Z';
const SCENE = (left, right) => `
  <svg class="qd-svg" viewBox="0 -8 320 132" preserveAspectRatio="xMidYMax meet" role="img" aria-label="Two gunslingers face each other at high noon">
    <circle class="qd-sun" cx="160" cy="98" r="34"/>
    <path class="qd-ground" d="M-400 104 H720 V500 H-400 Z"/>
    <path class="qd-tufts" d="M28 112 l4 -4 M118 116 l3 -3 l3 3 M196 113 l4 -4 M292 117 l3 -3 l3 3 M74 119 h8 M236 120 h8"/>
    <g class="qd-cactus" transform="translate(30 104) scale(0.8)"><path d="${CACTUS}"/></g>
    <g class="qd-cactus" transform="translate(292 104) scale(0.62)"><path d="${CACTUS}"/></g>
    <path class="qd-horizon" d="M-400 104 H720"/>
    <g class="qd-lantern" transform="translate(160 0)"><path class="qd-cord" d="M0 -400 V14"/><g class="qd-lamp"><path class="qd-capp" d="M-7 15 H7 L4 11 H-4 Z"/><rect class="qd-glass" x="-9" y="15" width="18" height="24" rx="4"/><path class="qd-capp" d="M-8 39 H8 V43 H-8 Z"/></g></g>
    <g class="qd-bellg" transform="translate(160 0)"><path class="qd-cord" d="M0 -400 V12"/><g class="qd-bell"><path class="qd-bellb" d="M-11 40 Q-10 22 0 20 Q10 22 11 40 Z M-13 40 H13"/><circle class="qd-bellb" cx="0" cy="18" r="2.6"/><circle class="qd-bellb" cx="0" cy="43.4" r="2.8"/></g></g>
    <g class="qd-fig" data-w="${left}" transform="translate(86 104)">${FIGURE}</g>
    <g class="qd-fig" data-w="${right}" transform="translate(234 104) scale(-1 1)">${FIGURE}</g>
  </svg>`;

registerGame({
  id: 'quickdraw',
  title: 'Quick Draw',
  blurb: 'Wait for it. DRAW! Fastest hand wins.',
  kind: 'live',
  team: false,
  tags: ['silly', 'quick'],
  platforms: ['phone', 'computer'],
  minutes: 3,
  howTo: [
    'Pick a duel pack and a series, then GO.',
    'Hands off while it says Steady. Fire on the signal: tap your button (computer: A or L, or Space when live).',
    'Too early, or faster than 100 ms (a guess), loses the round.',
    'Tied at match point? Both barrels: fire on the second draw.',
  ],

  css: `
    .g-qd { --qd-gap: 8px; position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--qd-gap); padding: 2px 0 4px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; font-family: var(--g-font-body); color: var(--g-ink); }
    .g-qd.is-live { touch-action: manipulation; cursor: crosshair; }
    .g-qd .qd-dim { position: absolute; inset: -8px; background: var(--g-edge, var(--g-ink)); opacity: 0; pointer-events: none; z-index: 3; }
    .g-qd .qd-mid { position: relative; flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
    .g-qd .qd-scene { position: relative; flex: 1 1 0; min-height: 0; max-height: 260px; display: flex; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow); overflow: hidden; transition: background-color 0.06s; }
    .g-qd[data-kind="classic"][data-phase="draw"] .qd-scene, .g-qd[data-kind="classic"][data-cue="first"] .qd-scene { background: var(--g-hl); }
    .g-qd .qd-svg { display: block; flex: 1 1 0; min-height: 0; width: 100%; height: 100%; margin: 0 auto; overflow: visible; }
    .g-qd .qd-sun { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 2.5; }
    .g-qd[data-kind="classic"][data-phase="draw"] .qd-sun, .g-qd[data-kind="classic"][data-cue="first"] .qd-sun { fill: var(--g-card); }
    .g-qd .qd-ground { fill: var(--g-hl-soft, var(--g-bg)); }
    .g-qd .qd-horizon { stroke: var(--g-ink); stroke-width: 2.5; }
    .g-qd .qd-tufts { stroke: var(--g-ink); stroke-width: 1.6; fill: none; stroke-linecap: round; opacity: 0.55; }
    .g-qd .qd-cactus path { fill: var(--g-line); stroke: var(--g-ink); stroke-width: 1.8; stroke-linejoin: round; }
    .g-qd .qd-lantern, .g-qd .qd-bellg { display: none; }
    .g-qd[data-kind="colour"] .qd-lantern, .g-qd[data-kind="bell"] .qd-bellg { display: inline; }
    .g-qd .qd-cord { stroke: var(--g-ink); stroke-width: 2; fill: none; }
    .g-qd .qd-glass { fill: var(--lc, var(--g-card)); stroke: var(--g-ink); stroke-width: 2.4; transition: fill 0.05s; }
    .g-qd .qd-capp { fill: var(--g-ink); stroke: var(--g-ink); stroke-width: 1.6; stroke-linejoin: round; }
    .g-qd .qd-bellb { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 2.2; stroke-linejoin: round; }
    .g-qd .qd-bell { transform-box: fill-box; transform-origin: 50% 0; }
    .g-qd .qd-bell.is-ring { animation: qd-swing 0.7s ease-out both; }
    .g-qd .qd-bell.is-tink { animation: qd-tink 0.35s ease-out both; }
    .g-qd .qd-fig[data-w="a"] { --c: var(--p-a); }
    .g-qd .qd-fig[data-w="b"] { --c: var(--p-b); }
    .g-qd .qd-fig .qd-c { fill: var(--c); stroke: var(--g-ink); stroke-width: 2; stroke-linejoin: round; }
    .g-qd .qd-fig .qd-head { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 2; }
    .g-qd .qd-fig .qd-belt { fill: none; stroke: var(--g-ink); stroke-width: 2.4; }
    .g-qd .qd-fig .qd-hat path, .g-qd .qd-fig .qd-gun { fill: var(--g-ink); stroke: var(--g-ink); stroke-width: 1.4; stroke-linejoin: round; }
    .g-qd .qd-shadow { fill: var(--g-edge, var(--g-ink)); opacity: 0.22; }
    .g-qd .qd-flash { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 1.6; stroke-linejoin: round; display: none; }
    .g-qd .qd-puff circle { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 1.4; }
    .g-qd .qd-puff { display: none; transform-box: fill-box; transform-origin: 20% 60%; }
    .g-qd .qd-fig.is-flash .qd-flash { display: inline; animation: qd-muzzle 0.22s ease-out both; }
    .g-qd .qd-fig.is-flash .qd-puff, .g-qd .qd-fig.is-puff .qd-puff { display: inline; animation: qd-smoke 0.9s ease-out both; }
    .g-qd .qd-arm, .g-qd .qd-body { transform-box: view-box; transform-origin: 0 0; }
    .g-qd .qd-arm { transform: rotate(76deg); transition: transform 0.09s cubic-bezier(0.3, 1.5, 0.5, 1); }
    .g-qd .qd-fig.is-up .qd-arm { transform: rotate(-4deg); }
    .g-qd .qd-body { transition: transform 0.5s cubic-bezier(0.55, 0, 0.75, 0.45); }
    .g-qd .qd-fig.is-down .qd-body { transform: rotate(-80deg); }
    .g-qd .qd-hat { transform-box: fill-box; transform-origin: 50% 80%; transition: transform 0.55s cubic-bezier(0.2, 0.7, 0.4, 1), opacity 0.55s; }
    .g-qd .qd-fig.is-hatless .qd-hat { transform: translate(-16px, -34px) rotate(-75deg); opacity: 0; }
    .g-qd .qd-kind { position: absolute; left: 6px; top: 5px; z-index: 2; padding: 1px 6px 0; font: 900 0.62rem/1.5 var(--g-font-body); letter-spacing: 0.1em; color: var(--g-on-ink); background: var(--g-hl); border: 2px solid var(--g-ink); border-radius: 4px; transform: rotate(-2deg); }
    .g-qd .qd-kind.qd-top { left: auto; top: auto; right: 6px; bottom: 5px; transform: rotate(178deg); }
    .g-qd .qd-kind[hidden] { display: none; }
    .g-qd .qd-flashout { position: absolute; inset: 0; z-index: 2; background: var(--g-white, #fff); opacity: 0; pointer-events: none; }
    .g-qd .qd-flashout.go { animation: qd-hitstop 0.2s ease-out both; }
    .g-qd .qd-stamp { --sr: -7deg; position: absolute; left: 50%; z-index: 4; margin: 0; padding: 4px 12px 2px; white-space: nowrap; font-family: var(--g-font-display); font-weight: 900; font-size: clamp(1.05rem, 5.4vw, 1.7rem); line-height: 1.2; letter-spacing: 0.03em; color: var(--g-on-ink); background: var(--g-hl); border: 3px solid var(--g-ink); border-radius: 8px; box-shadow: var(--g-shadow); pointer-events: none; opacity: 0; transform: translate(-50%, -50%) rotate(var(--sr)); }
    .g-qd .qd-stamp.qd-top { --sr: 173deg; }
    .g-qd .qd-stamp.is-bad { background: var(--g-bad); color: var(--g-white, #fff); }
    .g-qd .qd-stamp.is-good { background: var(--g-good); color: var(--g-white, #fff); }
    .g-qd .qd-stamp.is-a { background: var(--p-a); } .g-qd .qd-stamp.is-b { background: var(--p-b); }
    .g-qd .qd-stamp.go { animation: qd-stamp 1s cubic-bezier(0.2, 1.4, 0.4, 1) both; }

    .g-qd .qd-sig { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 2px; justify-content: center; flex: 0 0 auto; }
    .g-qd .qd-word { font-family: var(--g-font-display); font-weight: 900; font-size: clamp(1.7rem, 8.5vw, 2.7rem); line-height: 1.1; letter-spacing: 0.01em; padding: 0 12px; border: 3px solid transparent; border-radius: 10px; min-height: 1.15em; }
    .g-qd .qd-sig.is-steady .qd-word { color: var(--g-muted); animation: qd-breathe 1.2s ease-in-out infinite; }
    .g-qd .qd-sig.is-cue .qd-word { color: var(--g-muted); animation: none; }
    .g-qd .qd-sig.is-draw .qd-word { background: var(--g-hl); color: var(--g-on-ink); border-color: var(--g-ink); box-shadow: var(--g-shadow-lg, var(--g-shadow)); transform: rotate(-3deg); margin-bottom: 4px; font-size: clamp(2.1rem, 11.5vw, 3.4rem); animation: qd-pop 0.16s cubic-bezier(0.2, 1.6, 0.4, 1) both; }
    .g-qd .qd-sig.is-foul .qd-word { color: var(--g-bad); }
    .g-qd .qd-sig.is-bang .qd-word { color: var(--qd-win); text-shadow: 3px 3px 0 var(--g-edge, var(--g-ink)); transform: rotate(-4deg); animation: qd-pop 0.22s cubic-bezier(0.2, 1.6, 0.4, 1) both; }
    .g-qd .qd-sig.is-bang.p-a { --qd-win: var(--p-a); } .g-qd .qd-sig.is-bang.p-b { --qd-win: var(--p-b); }
    .g-qd .qd-line { font-weight: 800; font-size: 0.95rem; line-height: 1.25; min-height: 1.25em; }
    .g-qd .qd-times { font-weight: 700; font-size: 0.92rem; line-height: 1.25; color: var(--g-ink); min-height: 1.25em; font-variant-numeric: tabular-nums; }
    .g-qd .qd-times b.t-a { color: var(--p-a-text, var(--p-a)); } .g-qd .qd-times b.t-b { color: var(--p-b-text, var(--p-b)); }
    .g-qd .qd-times .qd-sep { color: var(--g-muted); margin: 0 4px; }
    .g-qd .qd-bars { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 1px 6px; width: 250px; max-width: 80vw; margin: 0 auto; font-size: 0.74rem; line-height: 1.15; }
    .g-qd .qd-bars i { display: block; height: 9px; border: 2px solid var(--g-ink); border-radius: 3px; background: var(--c); width: var(--w); }
    .g-qd .qd-bars .t-a { --c: var(--p-a); } .g-qd .qd-bars .t-b { --c: var(--p-b); }
    .g-qd .qd-bars span { text-align: left; } .g-qd .qd-bars em { font-style: normal; text-align: right; }

    .g-qd .qd-tally { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 800; flex: 0 0 auto; }
    .g-qd .qd-who { display: inline-flex; align-items: center; gap: 8px; }
    .g-qd .qd-who.t-a { color: var(--p-a-text, var(--p-a)); } .g-qd .qd-who.t-b { color: var(--p-b-text, var(--p-b)); }
    .g-qd .qd-to { font-size: 0.74rem; color: var(--g-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; text-align: center; }
    .g-qd .qd-notches { display: inline-flex; gap: 5px; }
    .g-qd .qd-notches i { width: 10px; height: 22px; border: 2px solid var(--g-ink); border-radius: 2px; background: var(--g-card); transform: skewX(-14deg); }
    .g-qd .qd-notches[data-w="a"] i.on { background: var(--p-a); }
    .g-qd .qd-notches[data-w="b"] i.on { background: var(--p-b); }
    .g-qd .qd-notches.num { font-weight: 900; font-size: 1.25rem; line-height: 1; font-variant-numeric: tabular-nums; }
    .g-qd .qd-notches i.on.new { animation: qd-pop 0.3s cubic-bezier(0.2, 1.6, 0.4, 1) both; }

    .g-qd .qd-pads { display: flex; gap: 12px; flex: 1 1 0; min-height: 0; }
    .g-qd .qd-pad { flex: 1; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 52px; padding: 6px 10px; border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: var(--g-shadow-lg, var(--g-shadow)); color: var(--g-on-ink); font-family: var(--g-font-body); touch-action: manipulation; transition: transform 0.06s, box-shadow 0.06s, opacity 0.2s; overflow: hidden; }
    .g-qd .qd-pad[data-w="a"] { background: var(--p-a); } .g-qd .qd-pad[data-w="b"] { background: var(--p-b); }
    .g-qd .qd-pad.is-press { transform: translate(4px, 4px); box-shadow: 0 0 0 var(--g-edge, var(--g-ink)); }
    .g-qd .qd-pad.is-idle { background: var(--g-card); color: var(--g-muted); }
    .g-qd .qd-pad.is-idle .qd-pad-name { color: var(--g-ink); }
    .g-qd .qd-pad-cta { font-family: var(--g-font-display); font-weight: 900; font-size: clamp(1.4rem, 6.5vw, 2.1rem); line-height: 1; letter-spacing: 0.04em; }
    .g-qd .qd-pad-name { font-weight: 900; font-size: 0.95rem; line-height: 1.1; }
    .g-qd .qd-pad-hint { font-weight: 800; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px; }
    .g-qd .qd-pad .qd-notches i { border-color: var(--g-ink); height: 18px; }
    .g-qd .qd-pad .qd-notches[data-w] i { background: var(--g-card); }
    .g-qd .qd-pad .qd-notches[data-w] i.on { background: var(--g-ink); }
    .g-qd kbd { display: inline-grid; place-items: center; min-width: 30px; height: 30px; padding: 0 7px; font: 900 1rem/1 var(--g-font-body); color: var(--g-ink); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 7px; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }

    /* one phone: a pad at each end, the duel between them */
    .g-qd.is-phone { display: grid; grid-template-rows: minmax(56px, 0.8fr) minmax(0, 2fr) minmax(56px, 0.8fr); }
    .g-qd.is-phone .qd-pad.qd-top { transform: rotate(180deg); box-shadow: -6px -6px 0 var(--g-edge, var(--g-ink)); }
    .g-qd.is-phone .qd-pad.qd-top.is-press { transform: rotate(180deg) translate(-4px, -4px); box-shadow: none; }
    .g-qd.is-phone .qd-sig.qd-top { transform: rotate(180deg); }
    .g-qd.is-phone .qd-word { font-size: clamp(1.4rem, 7vw, 2.1rem); }
    .g-qd.is-phone .qd-sig.is-draw .qd-word { font-size: clamp(1.8rem, 9vw, 2.6rem); }
    .g-qd.is-phone .qd-line, .g-qd.is-phone .qd-times { font-size: 0.8rem; }
    .g-qd.is-phone .qd-pad { flex-direction: row; gap: 10px; flex-wrap: wrap; align-content: center; }
    .g-qd.is-desk { max-width: 620px; width: 100%; margin: 0 auto; }
    .g-qd.is-desk .qd-pads { flex: 0 0 auto; height: clamp(76px, 24vh, 150px); }
    .g-qd.is-live .qd-pads { flex: 0 0 auto; height: clamp(88px, 22vh, 210px); max-width: 520px; width: 100%; margin: 0 auto; }
    .g-qd.is-live .qd-mid, .g-qd.is-desk .qd-mid { flex: 1 1 0; }

    /* a phone on its side: one pad at each end, the duel in between */
    @media (orientation: landscape) and (max-height: 520px) {
      .g-qd { --qd-gap: 6px; }
      .g-qd.is-phone { grid-template-rows: minmax(0, 1fr); grid-template-columns: minmax(84px, 1fr) minmax(0, 1.7fr) minmax(84px, 1fr); }
      .g-qd.is-phone .qd-pad[data-w="a"] { grid-area: 1 / 1; } .g-qd.is-phone .qd-mid { grid-area: 1 / 2; justify-content: center; } .g-qd.is-phone .qd-pad[data-w="b"] { grid-area: 1 / 3; }
      .g-qd.is-phone .qd-pad { flex-direction: column; flex-wrap: nowrap; }
      .g-qd.is-phone .qd-pad.qd-top { transform: none; box-shadow: var(--g-shadow-lg, var(--g-shadow)); }
      .g-qd.is-phone .qd-pad.qd-top.is-press { transform: translate(4px, 4px); box-shadow: 0 0 0 var(--g-edge, var(--g-ink)); }
      .g-qd.is-phone .qd-sig.qd-top, .g-qd .qd-stamp.qd-top, .g-qd .qd-kind.qd-top { display: none; }
      .g-qd.is-live { flex-direction: row; align-items: stretch; }
      .g-qd.is-live .qd-mid { flex: 1.6; min-width: 0; }
      .g-qd.is-live .qd-pads { flex: 1; height: auto; max-width: none; margin: 0; }
      .g-qd.is-desk .qd-pads { height: clamp(64px, 24vh, 150px); }
      .g-qd .qd-word { font-size: clamp(1.3rem, 6vh, 2.1rem); }
      .g-qd .qd-sig.is-draw .qd-word { font-size: clamp(1.6rem, 8vh, 2.6rem); }
      .g-qd .qd-line, .g-qd .qd-times { font-size: 0.78rem; }
      .g-qd .qd-notches i { height: 16px; }
      .g-qd .qd-pad-cta { font-size: clamp(1.2rem, 8vh, 1.8rem); }
    }

    /* the pre-duel picker */
    .g-qd .qd-setup { position: absolute; inset: 0; z-index: 6; display: flex; align-items: center; justify-content: center; background: var(--g-bg); overflow: auto; }
    .g-qd .qd-setup[hidden] { display: none; }
    .g-qd[data-phase="setup"] > :not(.qd-setup), .g-qd.is-setup > :not(.qd-setup) { visibility: hidden; }
    .g-qd .qd-setup-card { width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 8px; padding: 10px; margin: auto; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: var(--g-shadow); }
    .g-qd .qd-setup-head { margin: 0; font-family: var(--g-font-display); font-weight: 900; font-size: 1.15rem; line-height: 1.15; }
    .g-qd .qd-opts { display: grid; gap: 6px; }
    .g-qd .qd-packs { grid-template-columns: repeat(3, 1fr); }
    .g-qd .qd-series { grid-template-columns: repeat(4, 1fr); }
    .g-qd .qd-opt { min-height: 46px; padding: 4px 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; font-family: var(--g-font-body); color: var(--g-ink); background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 10px; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); touch-action: manipulation; text-align: center; }
    .g-qd .qd-opt b { font-weight: 900; font-size: 0.86rem; line-height: 1.1; }
    .g-qd .qd-opt small { font-weight: 700; font-size: 0.66rem; line-height: 1.1; color: var(--g-muted); }
    .g-qd .qd-opt[aria-pressed="true"] { background: var(--g-hl); transform: translate(2px, 2px); box-shadow: none; }
    .g-qd .qd-opt[aria-pressed="true"] small { color: var(--g-on-ink); }
    .g-qd .qd-opt[aria-pressed="true"] b { color: var(--g-on-ink); }
    .g-qd .qd-opt:active { transform: translate(2px, 2px); box-shadow: none; }
    .g-qd .qd-setup.is-locked .qd-opt { cursor: default; }
    .g-qd .qd-setup.is-locked .qd-opt:active { transform: none; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
    .g-qd .qd-setup.is-locked .qd-opt[aria-pressed="true"]:active { transform: translate(2px, 2px); box-shadow: none; }
    .g-qd .qd-pack-desc { margin: 0; font-weight: 700; font-size: 0.82rem; line-height: 1.25; color: var(--g-ink); min-height: 2.5em; }
    .g-qd .qd-setup-note { margin: 0; font-weight: 700; font-size: 0.72rem; line-height: 1.25; color: var(--g-muted); }
    .g-qd .qd-gorow { display: flex; gap: 8px; align-items: stretch; }
    .g-qd .qd-gorow .qd-go { flex: 1 1 0; min-height: 54px; }
    .g-qd .qd-gorow .qd-again { flex: 0 0 auto; min-height: 54px; padding: 0 14px; }
    .g-qd .qd-go[hidden], .g-qd .qd-again[hidden] { display: none; }
    @media (orientation: landscape) and (max-height: 520px) {
      .g-qd .qd-setup-card { max-width: none; display: grid; grid-template-columns: 1.55fr 1fr; grid-template-areas: "packs series" "head go"; column-gap: 10px; row-gap: 4px; padding: 4px 8px; }
      .g-qd .qd-setup-head { grid-area: head; font-size: 0.95rem; align-self: center; }
      .g-qd .qd-opts { gap: 4px; }
      .g-qd .qd-packs { grid-area: packs; } .g-qd .qd-series { grid-area: series; grid-template-columns: repeat(2, 1fr); }
      .g-qd .qd-pack-desc, .g-qd .qd-setup-note { display: none; } .g-qd .qd-gorow { grid-area: go; } .g-qd .qd-gorow .qd-go, .g-qd .qd-gorow .qd-again { min-height: 44px; height: 44px; }
      .g-qd .qd-opt { min-height: 44px; } .g-qd .qd-opt small { display: none; }
    }
    @keyframes qd-pop { from { transform: scale(1.5) rotate(-3deg); opacity: 0; } to { opacity: 1; } }
    @keyframes qd-breathe { 50% { opacity: 0.55; } }
    @keyframes qd-stamp { 0% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--sr)) scale(1.9); } 14% { opacity: 1; transform: translate(-50%, -50%) rotate(var(--sr)) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -62%) rotate(var(--sr)) scale(1); } }
    @keyframes qd-hitstop { 0% { opacity: 0.85; } 100% { opacity: 0; } }
    @keyframes qd-muzzle { 0% { transform: scale(0.4); opacity: 1; } 40% { transform: scale(1.15); opacity: 1; } 100% { opacity: 0; } }
    @keyframes qd-smoke { 0% { opacity: 0; transform: translate(-3px, 2px) scale(0.5); } 25% { opacity: 1; } 100% { opacity: 0; transform: translate(7px, -9px) scale(1.5); } }
    @keyframes qd-swing { 0% { transform: rotate(0); } 12% { transform: rotate(26deg); } 30% { transform: rotate(-20deg); } 50% { transform: rotate(13deg); } 70% { transform: rotate(-7deg); } 100% { transform: rotate(0); } }
    @keyframes qd-tink { 0% { transform: rotate(0); } 30% { transform: rotate(5deg); } 65% { transform: rotate(-4deg); } 100% { transform: rotate(0); } }
    @media (prefers-reduced-motion: reduce) {
      .g-qd *, .g-qd *::before { animation: none !important; transition: none !important; }
      .g-qd .qd-stamp.go { opacity: 1; }
    }
  `,
  mount(el, api) {
    const local = api.mode === 'local';
    const coarse = matchMedia('(pointer: coarse)').matches;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const layout = local ? (coarse ? 'phone' : 'desk') : 'live';
    const ref = local || api.isHost;            // the referee decides rounds
    const me = local ? null : api.me;
    const sides = local ? ['a', 'b'] : [me];    // whose trigger this device holds
    const net = createNet(api);
    const key = Math.random().toString(36).slice(2, 9);
    const N = (w) => esc(api.name(w));
    const dataOf = () => (typeof api.data === 'function' ? api.data() || {} : {});
    const saveData = (patch) => { if (typeof api.setData === 'function' && Object.keys(patch).length) api.setData(patch); };

    // ── DOM ──
    const pad = (w, top) => `<button type="button" class="qd-pad${top ? ' qd-top' : ''}" data-w="${w}" aria-label="${N(w)}: fire">
        ${local ? `<span class="qd-pad-name">${N(w)}</span><span class="qd-notches" data-w="${w}" aria-hidden="true"></span>` : ''}
        <span class="qd-pad-cta">FIRE</span>
        ${layout === 'desk' ? `<span class="qd-pad-hint"><kbd>${w === 'a' ? 'A' : 'L'}</kbd> key</span>` : ''}
        ${layout === 'live' && !coarse ? '<span class="qd-pad-hint"><kbd>Space</kbd> or click</span>' : ''}
      </button>`;
    const sig = (flip) => `<div class="qd-sig${flip ? ' qd-top' : ''}" aria-live="${flip ? 'off' : 'assertive'}"><div class="qd-word"></div><div class="qd-line"></div><div class="qd-times"></div></div>`;
    const scene = `<div class="qd-scene"><span class="qd-kind" hidden></span>${layout === 'phone' ? '<span class="qd-kind qd-top" hidden></span>' : ''}${SCENE('a', 'b')}<div class="qd-flashout"></div></div>`;
    const tally = `<div class="qd-tally"><span class="qd-who t-a">${N('a')} <span class="qd-notches" data-w="a" aria-hidden="true"></span></span><span class="qd-to"></span><span class="qd-who t-b"><span class="qd-notches" data-w="b" aria-hidden="true"></span> ${N('b')}</span></div>`;
    // one phone: the stamp is printed twice, the second upside down for the player at the top
    const stampEl = `<p class="qd-stamp" aria-hidden="true"></p>${layout === 'phone' ? '<p class="qd-stamp qd-top" aria-hidden="true"></p>' : ''}`;
    const setupEl = `<div class="qd-setup" role="group" aria-label="Duel setup"><div class="qd-setup-card">
        <p class="qd-setup-head"></p>
        <div class="qd-opts qd-packs" role="group" aria-label="Duel pack">${PACK_ORDER.map((p) => `<button type="button" class="qd-opt" data-pack="${p}" aria-pressed="false"><b>${PACKS[p].name}</b></button>`).join('')}</div>
        <p class="qd-pack-desc"></p>
        <div class="qd-opts qd-series" role="group" aria-label="Series">${Object.keys(SERIES).map((s) => `<button type="button" class="qd-opt" data-series="${s}" aria-pressed="false"><b>${s === 'sd' ? 'Showdown' : `Best of ${s}`}</b>${s === 'sd' ? '<small>first to 5, by 2</small>' : `<small>first to ${SERIES[s].win}</small>`}</button>`).join('')}</div>
        <p class="qd-setup-note">Tied at match point? Both barrels: two draws, fire on the second.</p>
        <div class="qd-gorow"><button type="button" class="gm-btn qd-again" hidden>Pick again</button><button type="button" class="gm-btn gm-btn-big qd-go">GO</button></div>
      </div></div>`;
    if (layout === 'phone') {
      el.innerHTML = `<div class="g-qd is-phone" data-phase="setup" data-kind="classic" data-cue=""><div class="qd-dim"></div>${pad('b', true)}<div class="qd-mid">${sig(true)}${scene}${sig(false)}${stampEl}</div>${pad('a', false)}${setupEl}</div>`;
    } else if (layout === 'desk') {
      el.innerHTML = `<div class="g-qd is-desk" data-phase="setup" data-kind="classic" data-cue=""><div class="qd-dim"></div><div class="qd-mid">${scene}${sig(false)}${stampEl}</div><div class="qd-pads">${pad('a')}${pad('b')}</div>${setupEl}</div>`;
    } else {
      el.innerHTML = `<div class="g-qd is-live" data-phase="setup" data-kind="classic" data-cue=""><div class="qd-dim"></div><div class="qd-mid">${tally}${scene}${sig(false)}${stampEl}</div><div class="qd-pads">${pad(me)}</div>${setupEl}</div>`;
    }
    const root = el.querySelector('.g-qd');
    const $$ = (s) => [...root.querySelectorAll(s)];
    const $1 = (s) => root.querySelector(s);
    const figs = { a: $1('.qd-fig[data-w="a"]'), b: $1('.qd-fig[data-w="b"]') };
    const dim = $1('.qd-dim');
    const lantern = $1('.qd-lantern');
    const bellEl = $1('.qd-bell');
    const sceneEl = $1('.qd-scene');
    const stampNodes = $$('.qd-stamp');
    const setup = $1('.qd-setup');

    // ── timers (all tracked, all cleared in destroy) ──
    let dead = false;
    const timers = new Set();
    const rafs = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, Math.max(0, ms)); timers.add(id); return id; };
    const cancel = (id) => { if (id) { clearTimeout(id); timers.delete(id); } };
    const onFrame = (fn) => { const id = requestAnimationFrame((t) => { rafs.delete(id); if (!dead) fn(t); }); rafs.add(id); return id; };

    // ── sound: small synths (the shared kit's sfx for the rest) ──
    function tone(f, d, { type = 'sine', vol = 0.1, at = 0, slide = 0 } = {}) {
      if (api.muted && api.muted()) return;
      try {
        const ac = api.audio(); if (!ac) return;
        const t = ac.currentTime + 0.005 + at;
        const o = ac.createOscillator(); const g = ac.createGain();
        o.type = type; o.frequency.setValueAtTime(f, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + d);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d + 0.03);
      } catch { /* no audio */ }
    }
    const ring = () => { tone(880, 1.1, { vol: 0.1 }); tone(1320, 0.8, { vol: 0.06 }); tone(1760, 0.5, { vol: 0.04 }); };
    const tink = () => tone(2100, 0.12, { vol: 0.035 });
    const fanfare = () => { [660, 880, 1100, 1320].forEach((f, i) => tone(f, 0.16, { vol: 0.08, at: i * 0.07, type: 'triangle' })); };

    // ── state ──
    let phase = 'setup';       // setup | intro | steady | draw | wait | result | paused | over
    let tl = { a: 0, b: 0 };   // the duel tally
    let cfg = parseLast(dataOf().qd_last);   // { p: pack, s: series } of the running duel
    let pick = { ...cfg };     // the host's choice in the picker
    let started = false;       // the duel left the picker
    let cur = null;            // this device's round: { rd, r, D, t0, res, ids, cue, cueI }
    let lastR = 0;             // newest round started here
    let verdict = null;
    let hostKey = ref ? key : null;
    let staleKey = null;
    let paused = false;
    let forced = null;         // test hook: overrides the next round
    const duel = { best: { a: null, b: null }, pb: { a: null, b: null } };

    // ── stamps ──
    const stamps = [];
    let stamping = false;
    function nextStamp() {
      if (!stamps.length) { stamping = false; stampNodes.forEach((n) => n.classList.remove('go')); return; }
      stamping = true;
      const s = stamps.shift();
      const two = stampNodes.length > 1 && getComputedStyle(stampNodes[1]).display !== 'none'; // one phone, portrait: one for each player
      stampNodes.forEach((n, i) => {
        n.textContent = s.text;
        n.className = `qd-stamp${i ? ' qd-top' : ''}${s.cls ? ` ${s.cls}` : ''}`;
        n.style.top = `${sceneEl.offsetTop + sceneEl.offsetHeight * (two ? (i ? 0.3 : 0.7) : 0.5)}px`;
      });
      void stampNodes[0].offsetWidth;
      stampNodes.forEach((n) => n.classList.add('go'));
      if (s.snd) s.snd();
      later(nextStamp, s.ms || 950);
    }
    function stamp(text, cls, snd, ms) {
      if (stamps.length > 3) return;
      stamps.push({ text, cls, snd, ms });
      if (!stamping) nextStamp();
    }

    // ── one round, on this device ──
    function endRound() { if (cur) cur.ids.forEach(cancel); }
    function dimTo(op, ms) {
      dim.style.transition = ms ? `opacity ${ms}ms linear` : 'none';
      dim.style.opacity = String(op);
    }
    function beginRound(rd) {
      if (!net.synced) { net.ready.then(() => { if (!dead && rd.r > lastR && !paused) beginRound(rd); }); return; } // the shared clock first
      endRound();
      const D = rd.at + drawAt(rd);
      cur = { rd, r: rd.r, D, t0: null, res: {}, ids: [], cue: 'none', cueI: 0 };
      lastR = Math.max(lastR, rd.r);
      if (rd.cfg) cfg = rd.cfg;
      phase = 'intro'; // "Ready" until the shared start time
      pose({});
      lantern.style.removeProperty('--lc');
      root.dataset.kind = rd.kind;
      root.dataset.cue = '';
      paint();
      if (!local && D - net.now() < 150) { // this device is too late for a fair duel: re-round
        cur.void = true;
        sendShot({ void: true });
        return;
      }
      cur.ids.push(later(() => enterSteady(rd.r), rd.at - net.now()));
    }
    function enterSteady(r) {
      if (!cur || cur.r !== r || phase !== 'intro') return;
      const rd = cur.rd;
      phase = 'steady';
      cur.tStart = performance.now();
      paint();
      if (rd.both) stamp('BOTH BARRELS', 'is-bad', () => api.sfx('flip'), 1300);
      else if (rd.sd) stamp('SUDDEN DEATH', 'is-bad', () => api.sfx('flip'), 1300);
      // the tension builds: the room darkens a little and the clock gets quieter
      const total = Math.max(300, cur.D - net.now());
      dimTo(0, 0); void dim.offsetWidth; dimTo(0.2, total);
      let tickN = 0;
      const tick = () => {
        if (!cur || cur.r !== r || phase !== 'steady') return;
        const k = Math.min(1, (net.now() - rd.at) / Math.max(1, drawAt(rd)));
        tone(1400, 0.025, { type: 'square', vol: 0.05 * (1 - 0.75 * k) });
        tickN++;
        cur.ids.push(later(tick, 600 * rnd(0.82, 1.2) + (tickN % 5 === 0 ? 90 : 0)));
      };
      cur.ids.push(later(tick, 250));
      for (const cue of cuesOf(rd)) {
        cur.ids.push(later(() => onFrame(() => showCue(r, cue)), rd.at + cue.t - net.now()));
      }
    }
    function showCue(r, cue) {
      if (!cur || cur.r !== r || (phase !== 'steady' && phase !== 'draw')) return;
      if (cue.k === 'real') { showDraw(r); return; }
      const kind = cur.rd.kind;
      cur.cue = cue.k; cur.cueI = cue.i;
      root.dataset.cue = cue.k;
      const first = cue.k === 'first';
      if (first) { if (kind === 'bell') ring(); else api.sfx('hit'); }
      else if (kind === 'decoys') { api.sfx('hit'); }
      else if (kind === 'bell') { tink(); }
      if (kind === 'colour') lantern.style.setProperty('--lc', first ? 'var(--g-hl)' : `var(${DECOY_COLOURS[cue.i % 3][1]})`);
      if (kind === 'bell') { bellEl.classList.remove('is-ring', 'is-tink'); void bellEl.getBoundingClientRect(); bellEl.classList.add(first ? 'is-ring' : 'is-tink'); }
      paint();
      cur.ids.push(later(() => {
        if (!cur || cur.r !== r || phase !== 'steady') return;
        cur.cue = 'none'; root.dataset.cue = '';
        if (kind === 'colour') lantern.style.removeProperty('--lc');
        paint();
      }, cue.k === 'first' ? 480 : DECOY_MS));
    }
    function showDraw(r) {
      if (!cur || cur.r !== r || phase !== 'steady') return;
      const kind = cur.rd.kind;
      cur.t0 = performance.now(); // this frame paints the signal
      cur.cue = 'real';
      phase = 'draw';
      root.dataset.cue = 'real';
      dimTo(0, 80);
      if (kind === 'colour') lantern.style.setProperty('--lc', 'var(--g-hl)');
      if (kind === 'bell') { bellEl.classList.remove('is-ring', 'is-tink'); void bellEl.getBoundingClientRect(); bellEl.classList.add('is-ring'); ring(); } else api.sfx('hit');
      if (R && R.r === r) R.tDraw = cur.t0;
      paint();
      cur.ids.push(later(() => tooSlow(r), SLOW_MS));
    }
    function tooSlow(r) {
      if (!cur || cur.r !== r) return;
      for (const w of sides) if (!cur.res[w] && (phase === 'draw' || phase === 'wait')) record(w, { slow: true });
    }
    const stampTs = (e) => {
      const n = performance.now(); const t = e && e.timeStamp;
      return t > 0 && t <= n + 1 && n - t < 1000 ? t : n;
    };
    function fire(w, e) {
      if (dead || paused || !cur || cur.void || !sides.includes(w) || cur.res[w]) return;
      const ts = stampTs(e);
      if (phase === 'steady') {
        const rel = Math.round((net.now() - (performance.now() - ts) - cur.D) * 10) / 10; // shared clock: negative = before the signal
        api.sfx('bad');
        record(w, { foul: true, rel, early: Math.max(1, Math.round(-rel)) });
      } else if (phase === 'draw') {
        const reaction = Math.max(0, Math.round((ts - cur.t0) * 10) / 10);
        if (reaction < FALSE_START) { api.sfx('bad'); record(w, { foul: true, jump: true, rel: reaction, early: 0 }); } else {
          api.sfx('pop');
          api.haptic(20);
          record(w, { reaction });
        }
      }
    }
    function sendShot(res) {
      const shot = { hk: hostKey, r: cur ? cur.r : lastR, ...res };
      net.send('shot', shot);
      myShot = shot;
      publish();
    }
    function record(w, res) {
      cur.res[w] = res;
      const f = figs[w];
      if (f) { f.classList.add('is-up'); f.classList.toggle('is-flash', Number.isFinite(res.reaction)); f.classList.toggle('is-puff', !!res.foul); }
      if (!local) { phase = 'wait'; paint(); countUp(); } else paint();
      if (ref) refReceive(w, cur.r, res);
      else sendShot(res);
    }

    // ── referee (host, or the one device) ──
    let R = null;              // { r, rd, res: {a, b}, decided, tDraw, armed, safety }
    let seq = 0;
    let nextT = 0;
    const mixedKinds = ['classic', 'decoys', 'colour', 'bell'];
    function planRound(r) {
      const S = seriesOf(cfg);
      let kind = cfg.p === 'mixed' ? pickOf(mixedKinds) : cfg.p;
      if (!KIND_SIGN[kind]) kind = 'classic';
      const both = S.by === 1 && S.win > 1 && tl.a === tl.b && tl.a === S.win - 1;
      // a mixture, so DRAW can't be learned: mostly short, often middling, now and then long
      const u = Math.random();
      let delay = u < 0.5 ? rnd(1200, 2000) : u < 0.85 ? rnd(2000, 3600) : rnd(3600, 6000);
      const decoys = []; const dw = [];
      if (kind !== 'classic' && !both) {
        delay = Math.max(delay, rnd(2500, 3300));
        const n = Math.random() < 0.8 ? (delay > 4200 ? 2 : 1) : 0;
        const lo = 700; const hi = delay - DECOY_MS - 650;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? rnd(lo, hi) : lo + ((hi - lo) / 2) * i + rnd(0, Math.max(0, (hi - lo) / 2 - DECOY_MS - 250));
          decoys.push(Math.round(t));
          dw.push(kind === 'decoys' ? Math.floor(Math.random() * DECOY_WORDS.length) : Math.floor(Math.random() * 3));
        }
      }
      const lead = local ? 700 : Math.min(1600, Math.max(900, net.rtt * 1.5 + 600));
      const rd = { hk: key, r, at: Math.round(net.now() + lead), delay: Math.round(delay), gap: both ? Math.round(rnd(700, 1400)) : 0, both: both ? 1 : 0, sd: suddenOf(tl, cfg) ? 1 : 0, kind, decoys, dw, cfg, t: tl, mp: matchPointOf(tl) };
      if (forced) { Object.assign(rd, forced); forced = null; }
      return rd;
    }
    /** Whoever would win the duel by taking this round. */
    function matchPointOf(t) {
      if (suddenOf(t, cfg)) return 'ab';
      return ['a', 'b'].filter((x) => isWin({ ...t, [x]: t[x] + 1 }, cfg)).join('');
    }
    function refStart() {
      nextT = 0;
      if (dead || paused || phase === 'over' || phase === 'setup') return;
      const r = ++seq;
      const rd = planRound(r);
      R = { r, rd, res: { a: null, b: null }, decided: false, tDraw: null };
      if (!local) {
        net.send('round', rd);
        // a guest that never reports (gone, or its shot lost) can't stall the duel
        R.safety = later(() => refDecide(r), rd.at - net.now() + drawAt(rd) + SLOW_MS + 3500);
      }
      beginRound(rd);
      publish();
    }
    const recvLog = []; // arrival order at the referee (tests check it never decides a duel)
    function refReceive(w, r, res) {
      if (!R || R.r !== r || R.decided || R.res[w]) return;
      R.res[w] = res;
      recvLog.push({ w, r, at: Math.round(performance.now()) });
      if (recvLog.length > 40) recvLog.shift();
      arm(r);
    }
    /** Decide as soon as the outstanding player can't change the result any more. */
    function arm(r) {
      if (!R || R.r !== r || R.decided) return;
      const A = R.res.a; const B = R.res.b;
      if (A && B) { refDecide(r); return; }
      const got = A || B; const w = A ? 'a' : 'b';
      if (got.void) { refDecide(r); return; }
      if (R.armed) return;
      if (got.foul) {
        // the other player may have jumped too, a moment earlier, with the news still in flight
        R.armed = later(() => refDecide(r), local ? DOUBLE_MS + 10 : Math.max(220, net.rtt + 150));
      } else if (Number.isFinite(got.reaction)) {
        const base = R.tDraw != null ? R.tDraw : performance.now() - got.reaction;
        // the host sees its own taps at once; the guest's arrive about rtt/2 late
        const extra = local ? LATE_MS : w === 'b' ? TIE_MS : Math.max(net.rtt, 40) + 250;
        R.armed = later(() => refDecide(r), base + got.reaction + extra - performance.now());
      }
    }
    function refDecide(r) {
      if (!R || R.r !== r || R.decided) return;
      R.decided = true;
      cancel(R.armed); cancel(R.safety);
      const A = R.res.a; const B = R.res.b;
      const rt = (x) => (x && Number.isFinite(x.reaction) ? x.reaction : null);
      let w = null; let why;
      if ((A && A.void) || (B && B.void)) why = 'void';
      else if (A && A.foul && B && B.foul) {
        const d = (A.rel ?? 0) - (B.rel ?? 0);
        if (Math.abs(d) < DOUBLE_MS) why = 'dfoul'; else { why = 'fouls'; w = d < 0 ? 'b' : 'a'; } // the earlier jump loses
      } else if (A && A.foul) { why = 'foul'; w = 'b'; } else if (B && B.foul) { why = 'foul'; w = 'a'; } else {
        const ra = rt(A); const rb = rt(B);
        if (ra == null && rb == null) why = 'none';
        else if (ra == null) { why = 'time'; w = 'b'; } else if (rb == null) { why = 'time'; w = 'a'; } else if (Math.abs(ra - rb) <= TIE_MS) why = 'tie';
        else { why = 'time'; w = ra < rb ? 'a' : 'b'; }
      }
      const ra = rt(A); const rb = rt(B);
      const v = { hk: key, r, w, why, a: A, b: B, kind: R.rd.kind, both: R.rd.both, tally: { ...tl }, pb: [] };
      if (why === 'time' && ra != null && rb != null) { v.diff = Math.round(Math.abs(ra - rb)); v.photo = v.diff < PHOTO_MS; }
      const sd = suddenOf(tl, cfg); // the Showdown cap: whoever takes this round takes the duel
      if (w) { v.tally[w]++; if (sd) v.tally[w] = Math.max(v.tally[w], v.tally[other(w)] + 1); }
      if (sd) v.sd = 1;
      recordRound(v, ra, rb);
      if (isWin(v.tally, cfg) || (sd && w)) v.res = finalResult(v);
      if (!local) net.send('verdict', v);
      applyVerdict(v);
      publish();
      if (v.res) later(() => api.finish(v.res), FINALE_MS); // the engine mirrors it to the guest
      else nextT = later(refStart, RESULT_MS);
    }
    /** Personal bests and the all-time fastest draw (host only: it decides the result). */
    function recordRound(v, ra, rb) {
      const d = dataOf(); const patch = {};
      for (const [x, rr] of [['a', ra], ['b', rb]]) {
        if (rr == null) continue;
        const k = `qd_pb_${x}_ms`; const prev = d[k];
        if (duel.best[x] == null || rr < duel.best[x]) duel.best[x] = rr;
        if (typeof prev !== 'number' || rr < prev) {
          patch[k] = Math.round(rr);
          if (typeof prev === 'number') { v.pb.push(x); duel.pb[x] = Math.round(rr); }
        }
        const best = typeof patch.qd_best_ms === 'number' ? patch.qd_best_ms : d.qd_best_ms;
        if (typeof best !== 'number' || rr < best) { patch.qd_best_ms = Math.round(rr); patch.qd_best_who = x; if (typeof best === 'number') v.rec = x; }
      }
      saveData(patch);
    }
    function finalResult(v) {
      const w = v.w; const l = other(w);
      const d = dataOf(); const patch = {};
      const prevWho = d.qd_streak_who; const prevN = Number(d.qd_streak_c) || 0;
      const bounty = prevWho === l && prevN >= 3;
      const c = prevWho === w ? prevN + 1 : 1;
      patch.qd_streak_who = w; patch.qd_streak_c = c;
      if (c > (Number(d.qd_streak_best) || 0)) { patch.qd_streak_best = c; patch.qd_streak_best_who = w; }
      saveData(patch);
      const parts = [`${v.tally[w]}–${v.tally[l]}`];
      if (v.sd) parts.push('won in sudden death');
      if (bounty) parts.push(`Bounty claimed! ${api.name(l)}'s ${prevN}-duel streak ends`);
      else if (c >= 2) parts.push(`${api.name(w)} on a ${c}-duel streak`);
      const pbs = ['a', 'b'].filter((x) => duel.pb[x] != null).sort((x, y) => duel.pb[x] - duel.pb[y]);
      const fast = ['a', 'b'].filter((x) => duel.best[x] != null).sort((x, y) => duel.best[x] - duel.best[y])[0];
      if (pbs.length) parts.push(`new PB ${duel.pb[pbs[0]]} ms (${api.name(pbs[0])})`);
      else if (fast) parts.push(`fastest draw ${Math.round(duel.best[fast])} ms (${api.name(fast)})`);
      return { winner: w, score: { a: v.tally.a, b: v.tally.b }, sub: parts.join(' · '), bounty };
    }

    // ── verdicts (both devices) ──
    function applyVerdict(v) {
      if (!v || (verdict && verdict.hk === v.hk && verdict.r >= v.r)) return;
      const prev = tl;
      verdict = v;
      tl = { ...v.tally };
      endRound();
      if (cur) cur.cue = 'none';
      phase = v.res ? 'over' : 'result';
      dimTo(0, 200);
      root.dataset.cue = '';
      const P = {};
      for (const x of ['a', 'b']) {
        const res = v[x];
        P[x] = { up: !!res && !res.slow, flash: !!res && Number.isFinite(res.reaction), puff: !!res && !!res.foul };
      }
      if (v.w) {
        const l = other(v.w);
        P[v.w].up = true; P[v.w].puff = false;
        if (v.why === 'time') { P[v.w].flash = true; P[l].down = true; P[l].flash = false; } else { P[l].hatless = true; P[v.w].flash = false; }
      }
      pose(P);
      api.setScore(tl);
      paint(prev);
      countUp();
      if (v.why === 'time') { const fl = $1('.qd-flashout'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go'); }
      if (!v.res) api.sfx(v.w ? (local || v.w === me ? 'win' : 'lose') : 'flip'); else api.sfx('pop');
      // stamps: the verdict's headline moments
      if ((v.a && v.a.foul) || (v.b && v.b.foul)) stamp('JUMPED THE GUN', 'is-bad', null, 1000);
      if (v.photo) stamp('PHOTO FINISH', '', () => api.sfx('flip'), 1000);
      for (const x of v.pb || []) stamp(`NEW PB ${Math.round(v[x].reaction)}`, `is-${x}`, fanfare, 1000);
      if (!(v.pb || []).length && v.rec) stamp('NEW RECORD', 'is-good', fanfare, 1000);
      if (!ref && v.res) later(() => api.finish(v.res), FINALE_MS + 2500); // the host left in the finale: finish it here
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
      cancel(autoT); autoT = 0; autoLeft = 0;
      if (ref) { if (R && !R.decided) { cancel(R.armed); cancel(R.safety); R = null; } cancel(nextT); nextT = 0; }
      phase = 'paused';
      dimTo(0, 0);
      pose({});
      paint();
      publish();
    }
    function resume() {
      if (!paused) return;
      paused = false;
      phase = verdict && verdict.res ? 'over' : started ? 'intro' : 'setup';
      paint();
      if (ref && phase === 'intro') nextT = later(refStart, 1400);
      if (ref && phase === 'setup') armAuto();
      publish();
    }
    let partnerHere = local || api.partnerHere;
    let partnerAway = false;
    const shouldPause = () => document.hidden || (!local && (!partnerHere || partnerAway));
    const checkPause = () => { if (shouldPause()) pause(); else resume(); };

    // ── the picker ──
    let autoT = 0; let autoLeft = 0;
    let heard = ref;           // the guest has seen the host's choice at least once
    const goBtn = $1('.qd-go');
    const againBtn = $1('.qd-again');
    function renderSetup() {
      setup.hidden = started;
      root.classList.toggle('is-setup', !started);
      setup.classList.toggle('is-locked', !ref);
      $1('.qd-setup-head').innerHTML = ref ? (autoLeft ? 'Same again?' : local ? 'Pick your duel' : 'Pick the duel') : autoLeft ? `Same again? Starting in ${autoLeft}…` : `${N(other(me))} is picking…`;
      for (const b of setup.querySelectorAll('[data-pack]')) { b.setAttribute('aria-pressed', String(heard && b.dataset.pack === pick.p)); b.setAttribute('aria-disabled', String(!ref)); }
      for (const b of setup.querySelectorAll('[data-series]')) { b.setAttribute('aria-pressed', String(heard && b.dataset.series === pick.s)); b.setAttribute('aria-disabled', String(!ref)); }
      $1('.qd-pack-desc').textContent = heard ? PACKS[pick.p].desc : '';
      goBtn.hidden = !ref;
      goBtn.textContent = autoLeft ? `GO · ${autoLeft}` : 'GO';
      againBtn.hidden = !(ref && autoLeft);
    }
    function setPick(patch) {
      if (!ref || started) return;
      cancel(autoT); autoT = 0; autoLeft = 0;
      pick = { ...pick, ...patch };
      renderSetup();
      publish();
    }
    /** "Pick again": stop the rematch countdown and keep the choice on screen. */
    function stopAuto() {
      if (!autoLeft) return;
      cancel(autoT); autoT = 0; autoLeft = 0;
      renderSetup();
      publish();
    }
    function startDuel(p = pick.p, s = pick.s) {
      if (!ref || started || dead) return;
      cancel(autoT); autoT = 0; autoLeft = 0;
      let pack = p;
      if (pack === 'surprise') pack = pickOf(['decoys', 'colour', 'bell', 'mixed']);
      cfg = { p: pack, s };
      pick = { p, s };
      started = true;
      saveData({ qd_last: `${p}:${s}` });
      phase = 'intro';
      if (!local) net.send('go', { hk: key, cfg });
      paint();
      publish();
      nextT = later(refStart, api.gen > 0 ? 900 : INTRO_MS);
    }
    /** A rematch preselects the last duel and starts it after a short countdown that any tap cancels. */
    function armAuto() {
      if (!ref || api.gen < 1 || started || paused || autoLeft || !dataOf().qd_last) return;
      autoLeft = 3;
      const step = () => {
        if (autoLeft <= 1) { autoLeft = 0; autoT = 0; startDuel(); return; }
        autoLeft--; renderSetup();
        publish();
        autoT = later(step, 1000);
      };
      renderSetup();
      publish();
      autoT = later(step, 1000);
    }

    // ── network ──
    let myShot = null;
    let n = 0;
    function publish() {
      if (local) return;
      if (ref) {
        api.setPresence({
          k: key, n: ++n, r: R ? R.r : seq, ph: paused ? 'paused' : !started ? 'setup' : R && !R.decided ? 'steady' : phase === 'over' ? 'over' : phase === 'intro' ? 'intro' : 'result',
          rd: R && !R.decided ? R.rd : null, tally: tl, v: verdict, cfg: started ? cfg : null, pk: started ? null : pick, ac: started ? 0 : autoLeft, away: document.hidden ? 1 : 0,
        });
      } else {
        // ht/hc: the host's duel as we know it, so a host that reloads or reopens picks it back up
        api.setPresence({ k: key, n: ++n, hk: hostKey, ht: hostKey ? tl : null, hc: hostKey && started ? cfg : null, r: myShot ? myShot.r : 0, res: myShot, away: document.hidden ? 1 : 0 });
      }
    }
    function adoptHost(k) {
      if (!k || k === staleKey) return false;
      if (k === hostKey) return true;
      // a new host game (first contact, or the host came back with a fresh mount)
      hostKey = k; lastR = 0; verdict = null; tl = { a: 0, b: 0 }; myShot = null; started = false;
      endRound(); cur = null;
      if (!paused) { phase = 'setup'; pose({}); }
      api.setScore(tl); paint();
      return true;
    }
    function leaveSetup(c) {
      if (c) cfg = c;
      if (started) return;
      started = true;
      if (!paused && phase === 'setup') phase = 'intro';
      paint();
    }
    /** A host that came back mid-duel carries on from the tally we had (no verdict of its own yet). */
    function takeTally(t) {
      if (!t || (verdict && verdict.hk === hostKey)) return;
      const a = t.a | 0; const b = t.b | 0;
      if (a === tl.a && b === tl.b) return;
      tl = { a, b }; api.setScore(tl); paint();
    }
    function onHostState(S) {
      if (!S || !S.k || S.k === staleKey) return;
      if (!adoptHost(S.k)) return;
      const away = !!S.away;
      if (away !== partnerAway) { partnerAway = away; checkPause(); }
      if (S.ph === 'setup' && S.pk && !started) { pick = { p: PACKS[S.pk.p] ? S.pk.p : 'classic', s: SERIES[S.pk.s] ? S.pk.s : '5' }; heard = true; autoLeft = S.ac | 0; renderSetup(); }
      if (S.cfg && !started) leaveSetup(S.cfg);
      if (S.v && S.v.hk === hostKey) applyVerdict(S.v);
      else takeTally(S.tally);
      if (S.ph === 'steady' && S.rd && S.rd.r > lastR && !paused) beginRound(S.rd);
    }
    // Host: we were reloaded or reopened mid-duel; the guest remembers our old tally and pack.
    let adopted = false;
    function adoptDuel(st) {
      if (adopted || !st || typeof st.hk !== 'string' || st.hk === key || !st.ht) return;
      adopted = true;
      const a = st.ht.a | 0; const b = st.ht.b | 0;
      if (verdict || isWin({ a, b }, st.hc || cfg) || !(a + b)) return;
      tl = { a, b };
      if (st.hc && PACKS[st.hc.p] && SERIES[st.hc.s]) cfg = st.hc;
      pick = { ...cfg };
      started = true; phase = 'intro';
      cancel(autoT); autoT = 0; autoLeft = 0;
      api.setScore(tl); paint(); publish();
      if (!nextT) nextT = later(refStart, INTRO_MS);
    }
    function onGuestState(st) {
      if (!st) return;
      adoptDuel(st);
      const away = !!st.away;
      if (away !== partnerAway) { partnerAway = away; checkPause(); }
      if (st.hk === key && st.res && R) refReceive('b', st.r, stripShot(st.res));
    }
    const stripShot = (s) => {
      const out = {};
      if (s.void) out.void = true;
      else if (s.foul) { out.foul = true; out.rel = Number(s.rel) || 0; out.early = Number(s.early) || 1; if (s.jump) out.jump = true; } else if (s.slow) out.slow = true;
      else if (Number.isFinite(s.reaction)) out.reaction = s.reaction;
      return out;
    };

    // ── paint ──
    function countUp() {
      if (reduce) return;
      for (const e of $$('.qd-ms')) {
        const v = Number(e.dataset.v); if (!Number.isFinite(v)) continue;
        const t0 = performance.now();
        const step = () => {
          const k = Math.min(1, (performance.now() - t0) / 340);
          e.textContent = String(Math.round(v * (1 - (1 - k) ** 3)));
          if (k < 1) onFrame(step);
        };
        e.textContent = '0';
        onFrame(step);
      }
    }
    const msHTML = (res) => (!res ? 'too slow' : res.foul ? 'jumped early' : res.slow ? 'too slow' : `<span class="qd-ms" data-v="${Math.round(res.reaction)}">${Math.round(res.reaction)}</span> ms`);
    function timesHTML(v) {
      if (v.photo && v.a && v.b) {
        const hi = Math.max(v.a.reaction, v.b.reaction);
        const row = (x) => `<b class="t-${x}">${N(x)}</b><i class="t-${x}" style="--w:${Math.round((v[x].reaction / hi) * 100)}%"></i><em><span class="qd-ms" data-v="${Math.round(v[x].reaction)}">${Math.round(v[x].reaction)}</span> ms</em>`;
        return `<div class="qd-bars">${row('a')}${row('b')}</div>`;
      }
      if (v.why === 'time') return ['a', 'b'].map((x) => `<b class="t-${x}">${N(x)}</b> ${msHTML(v[x])}`).join('<span class="qd-sep">·</span>');
      return '';
    }
    const roundNo = () => Math.min(tl.a + tl.b + 1, 99);
    function sigState() {
      const rd = cur && cur.rd;
      const S = seriesOf(cfg);
      switch (phase) {
        case 'setup': return { word: '', line: '', cls: '' };
        case 'intro': return { word: 'Ready', line: rd && rd.both ? 'BOTH BARRELS' : rd && rd.sd ? 'SUDDEN DEATH' : `${S.name} · ${PACKS[cfg.p].name}`, cls: '' };
        case 'steady': {
          const kind = rd.kind;
          const mp = rd.mp ? `MATCH POINT · ` : '';
          let line = rd.both ? 'Fire on the SECOND draw' : KIND_HINT[kind] || `Round ${roundNo()}`;
          if (rd.sd) line = `SUDDEN DEATH · ${KIND_HINT[kind] || 'next hit wins'}`;
          else if (mp) line = rd.both ? 'MATCH POINT · the SECOND draw' : `${mp}${KIND_HINT[kind] || `Round ${roundNo()}`}`;
          if (cur.cue === 'first') return { word: realWord(kind), line: 'One…', cls: 'is-draw' };
          if (cur.cue === 'decoy') {
            if (kind === 'decoys') return { word: DECOY_WORDS[cur.cueI % DECOY_WORDS.length], line, cls: 'is-draw' };
            if (kind === 'colour') return { word: DECOY_COLOURS[cur.cueI % 3][0], line, cls: 'is-cue' };
            if (kind === 'bell') return { word: 'tink', line, cls: 'is-cue' };
          }
          return { word: 'Steady…', line, cls: 'is-steady' };
        }
        case 'draw': {
          const kind = rd.kind;
          return { word: realWord(kind), line: rd.both ? 'Two! Fire!' : '', cls: 'is-draw' };
        }
        case 'wait': {
          const mine = cur && cur.res[me];
          if (mine && mine.foul) return { word: 'Too early!', line: `Waiting for ${N(other(me))}…`, cls: 'is-foul' };
          if (mine && mine.slow) return { word: 'Too slow', line: `Waiting for ${N(other(me))}…`, cls: 'is-foul' };
          return { word: mine ? `<span class="qd-ms" data-v="${Math.round(mine.reaction)}">${Math.round(mine.reaction)}</span> ms` : '…', line: `Waiting for ${N(other(me))}…`, cls: '', html: true };
        }
        case 'paused': return { word: 'Paused', line: local ? 'Back in a moment' : `${N(other(me))} stepped away`, cls: '' };
        default: {
          const v = verdict;
          if (!v) return { word: '', line: '', cls: '' };
          const l = v.w && other(v.w);
          const jumped = (x) => (v[x] && v[x].jump ? 'jumped the gun' : 'jumped early');
          let line;
          if (v.why === 'tie') line = 'Go again.';
          else if (v.why === 'none') line = 'Go again.';
          else if (v.why === 'void') line = 'The signal got lost. Go again.';
          else if (v.why === 'dfoul') line = 'Both jumped together. Go again.';
          else if (v.why === 'fouls') line = `Both jumped. ${N(l)} jumped first.`;
          else if (v.why === 'foul') line = `${N(l)} ${jumped(l)}`;
          else line = v.diff != null ? `${N(v.w)} by ${v.diff} ms` : `${N(v.w)} takes the round`;
          if (v.res) line = `${N(v.w)} wins the duel${v.sd ? ' in sudden death' : ''}!${v.why === 'time' && v.diff != null ? ` (by ${v.diff} ms)` : ''}`;
          const word = v.w ? 'BANG!' : v.why === 'tie' ? 'Dead heat' : v.why === 'none' ? 'Nobody fired' : v.why === 'dfoul' ? 'Double foul' : 'Again';
          return { word, line, cls: v.w ? `is-bang p-${v.w}` : '', times: timesHTML(v) };
        }
      }
    }
    function renderNotches() {
      const S = seriesOf(cfg);
      const count = Math.max(S.win, tl.a, tl.b);
      for (const nEl of $$('.qd-notches')) {
        const w = nEl.dataset.w;
        if (count > 6) { nEl.classList.add('num'); nEl.textContent = String(tl[w]); continue; } // a long Showdown: just the number
        nEl.classList.remove('num');
        if (nEl.children.length !== count) nEl.innerHTML = '<i></i>'.repeat(count);
        [...nEl.children].forEach((i, k) => i.classList.toggle('on', k < tl[w]));
      }
    }
    function paint(prevTally) {
      root.dataset.phase = phase;
      const st = sigState();
      for (const s of $$('.qd-sig')) {
        s.className = `qd-sig${s.classList.contains('qd-top') ? ' qd-top' : ''}${st.cls ? ` ${st.cls}` : ''}`;
        const w = s.querySelector('.qd-word');
        if (st.html) w.innerHTML = st.word; else w.textContent = st.word;
        s.querySelector('.qd-line').innerHTML = st.line;
        s.querySelector('.qd-times').innerHTML = st.times || '';
      }
      renderNotches();
      if (prevTally) for (const nEl of $$('.qd-notches:not(.num)')) { const w = nEl.dataset.w; [...nEl.children].forEach((i, k) => i.classList.toggle('new', k < tl[w] && k >= prevTally[w])); }
      const to = $1('.qd-to'); if (to) to.textContent = suddenOf(tl, cfg) ? 'sudden death' : seriesOf(cfg).by > 1 ? 'first to 5, by 2' : `first to ${seriesOf(cfg).win}`;
      const rd = cur && cur.rd;
      const showSign = rd && (phase === 'steady' || phase === 'draw') && (cfg.p !== 'classic' || rd.both || rd.sd);
      for (const kindEl of $$('.qd-kind')) {
        kindEl.hidden = !showSign;
        if (showSign) kindEl.textContent = rd.both ? 'BOTH BARRELS' : rd.sd ? 'SUDDEN DEATH' : `${cfg.p === 'mixed' ? 'MIXED · ' : ''}${KIND_SIGN[rd.kind]}`;
      }
      for (const p of $$('.qd-pad')) {
        const w = p.dataset.w;
        const armed = (phase === 'steady' || phase === 'draw') && cur && !cur.res[w];
        p.classList.toggle('is-idle', !armed);
      }
      renderSetup();
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
      if (e.button > 0 || phase === 'setup' || (e.target.closest && e.target.closest('.qd-setup'))) return;
      const p = e.target.closest('.qd-pad');
      let w = p ? p.dataset.w : null;
      if (!w && layout === 'live') w = me; // live: anywhere on the duel fires
      if (!w) return;
      if (e.pointerType !== 'mouse' && e.clientX < 20) return; // iOS back-swipe zone
      e.preventDefault();
      press(w);
      fire(w, e);
    });
    on(root, 'touchstart', (e) => { if (e.cancelable && e.target.closest('.qd-pad, .qd-scene, .qd-sig')) e.preventDefault(); }, { passive: false });
    on(root, 'contextmenu', (e) => e.preventDefault());
    on(setup, 'click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('qd-go')) { startDuel(); return; }
      if (b.classList.contains('qd-again')) { stopAuto(); return; }
      if (b.dataset.pack) setPick({ p: b.dataset.pack });
      else if (b.dataset.series) setPick({ s: b.dataset.series });
    });
    on(window, 'keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || phase === 'setup') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      let w = null;
      if (local) w = e.code === 'KeyA' || e.key === 'a' || e.key === 'A' ? 'a' : e.code === 'KeyL' || e.key === 'l' || e.key === 'L' ? 'b' : null;
      else if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') w = me;
      if (!w) return;
      if (t && t.closest && t.closest('button, a, [tabindex]') && !t.closest('.g-qd')) return; // e.g. Space on the end card's buttons
      e.preventDefault();
      press(w);
      fire(w, e);
    });
    on(document, 'visibilitychange', () => { publish(); checkPause(); });

    if (!local) {
      offs.push(api.onPartnerHere((here) => { partnerHere = here; if (!here) partnerAway = false; checkPause(); }));
      if (ref) {
        offs.push(net.on('shot', (d) => { if (d && d.hk === key) refReceive('b', d.r, stripShot(d)); }));
        adoptDuel(api.partnerState());
        offs.push(api.onPartnerState(onGuestState));
      } else {
        offs.push(net.on('go', (d) => { if (d && adoptHost(d.hk)) leaveSetup(d.cfg); }));
        offs.push(net.on('round', (d) => {
          if (!d || !adoptHost(d.hk) || paused) return;
          leaveSetup(d.cfg);
          takeTally(d.t);
          if (d.r > lastR && !(verdict && verdict.hk === d.hk && verdict.r >= d.r)) beginRound(d);
        }));
        offs.push(net.on('verdict', (v) => { if (v && adoptHost(v.hk)) applyVerdict(v); }));
        const s0 = api.partnerState();
        if (s0 && s0.ph === 'over') staleKey = s0.k; // the last duel's final state, still in presence
        else if (s0) onHostState(s0);
        offs.push(api.onPartnerState(onHostState));
      }
    }

    api.setScore(tl);
    if (layout === 'desk') api.setStatus('One keyboard: A against L');
    paint();
    publish();
    if (ref && !started) armAuto();
    if (document.hidden) checkPause();

    if (location.port) {
      window.__qdTest = {
        state: () => ({ phase, tally: { ...tl }, verdict, r: cur ? cur.r : 0, layout, coarse, paused, res: cur ? { ...cur.res } : null, cfg: { ...cfg }, pick: { ...pick }, started, kind: cur ? cur.rd.kind : null, cue: cur ? cur.cue : null, rd: cur ? cur.rd : null, rtt: net.rtt, now: net.now() }),
        timers: () => timers.size + rafs.size,
        recv: () => recvLog.slice(),
        /** Skip the picker: start a duel right away (host / one device). */
        start: (p = 'classic', s = '5', t = null) => { if (t && ref && !started) { tl = { a: t.a | 0, b: t.b | 0 }; api.setScore(tl); } startDuel(p, s); },
        /** Override the next round's plan (e.g. { kind: 'decoys', decoys: [900], dw: [0], delay: 2600 }). */
        force: (o) => { forced = o; },
      };
    }

    return {
      destroy() {
        dead = true;
        timers.forEach((id) => clearTimeout(id)); timers.clear();
        rafs.forEach((id) => cancelAnimationFrame(id)); rafs.clear();
        offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
        net.destroy();
        if (window.__qdTest) delete window.__qdTest;
      },
    };
  },
});
