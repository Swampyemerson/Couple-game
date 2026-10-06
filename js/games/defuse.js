// Defuse: asymmetric co-op for two devices. One player holds the bomb (best on a computer), the
// other reads the field guide (best on a phone), and they talk it through out loud.
//
// Netcode. In the lobby each device publishes its own role, a shared difficulty (last writer wins
// by a version counter, ties to 'b') and a start token. The bomb side is authoritative for a round:
// it picks a seed, draws the four modules from it, runs the clock and publishes
// { round id, ms left, clock rate, strikes, solved modules, paused, result } in presence; the
// manual side shows that live. The engine only records results sent by the host ('a'), so when the
// bomb is on 'b' it also sends a 'result' event and the manual side ('a') calls api.finish().
//
// The manual is fixed: every rule below is written once as { text, test } so the field guide
// shows exactly the rules the bomb checks. The test suite re-derives the answers from the manual's
// text and tables for many seeds.
import { registerGame, rng } from './core.js';

const DIFFS = {
  chill: { label: 'Chill', secs: 360, stages: 3 },
  normal: { label: 'Normal', secs: 300, stages: 4 },
  spicy: { label: 'Spicy', secs: 210, stages: 5 },
};
const MODS = ['wires', 'button', 'keypad', 'sequence'];
const MOD_NAME = { wires: 'Wires', button: 'Big Button', keypad: 'Glyph Keypad', sequence: 'Colour Sequence' };
const WIRE_COLORS = ['red', 'blue', 'yellow', 'white', 'black'];
const BTN_COLORS = ['red', 'blue', 'yellow', 'white'];
const BTN_LABELS = ['PUSH', 'HALT', 'WAIT', 'FIRE'];
const STRIP_COLORS = ['blue', 'white', 'yellow', 'red'];
const PAD_COLORS = ['red', 'blue', 'green', 'yellow'];
const INDICATORS = ['RDY', 'PWR', 'AUX', 'LNK', 'SYS'];
const HOLD_MS = 450;
const FINALE_MS = 1800;
const RATE_STEP = 0.25;

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const cnt = (c, x) => c.filter((y) => y === x).length;

// ── the field guide's rules (single source of truth for bomb and manual) ──────────
// K = { serial, last, even, vowel, bat, lit(label) }
const WIRE_RULES = {
  3: [
    ['If the first and last wires are the same colour, cut the second wire.', (c) => c[0] === c[2], () => 1],
    ['Otherwise, if exactly one wire is black, cut the black wire.', (c) => cnt(c, 'black') === 1, (c) => c.indexOf('black')],
    ['Otherwise, if the last digit of the serial number is even, cut the first wire.', (c, K) => K.even, () => 0],
    ['Otherwise, cut the last wire.', () => true, (c) => c.length - 1],
  ],
  4: [
    ['If there is a lit RDY indicator and two or more wires are yellow, cut the last yellow wire.', (c, K) => K.lit('RDY') && cnt(c, 'yellow') >= 2, (c) => c.lastIndexOf('yellow')],
    ['Otherwise, if no wire is blue, cut the third wire.', (c) => !cnt(c, 'blue'), () => 2],
    ['Otherwise, if exactly one wire is white, cut the first wire.', (c) => cnt(c, 'white') === 1, () => 0],
    ['Otherwise, if the last digit of the serial number is odd, cut the second wire.', (c, K) => !K.even, () => 1],
    ['Otherwise, cut the last blue wire.', () => true, (c) => c.lastIndexOf('blue')],
  ],
  5: [
    ['If the last wire is black and the last digit of the serial number is odd, cut the fourth wire.', (c, K) => c[4] === 'black' && !K.even, () => 3],
    ['Otherwise, if there are more red wires than blue wires, cut the first red wire.', (c) => cnt(c, 'red') > cnt(c, 'blue'), (c) => c.indexOf('red')],
    ['Otherwise, if no wire is yellow, cut the second wire.', (c) => !cnt(c, 'yellow'), () => 1],
    ['Otherwise, if the bomb has three or more batteries, cut the last wire.', (c, K) => K.bat >= 3, (c) => c.length - 1],
    ['Otherwise, cut the first wire.', () => true, () => 0],
  ],
  6: [
    ['If no wire is white and the last digit of the serial number is even, cut the third wire.', (c, K) => !cnt(c, 'white') && K.even, () => 2],
    ['Otherwise, if exactly one wire is yellow, cut the yellow wire.', (c) => cnt(c, 'yellow') === 1, (c) => c.indexOf('yellow')],
    ['Otherwise, if there is a lit PWR indicator, cut the fifth wire.', (c, K) => K.lit('PWR'), () => 4],
    ['Otherwise, if no wire is red, cut the last wire.', (c) => !cnt(c, 'red'), (c) => c.length - 1],
    ['Otherwise, cut the fourth wire.', () => true, () => 3],
  ],
};
const BUTTON_RULES = [
  ['If the button is blue and says WAIT, hold it.', (b) => b.color === 'blue' && b.label === 'WAIT', 'hold'],
  ['Otherwise, if the button says FIRE and the bomb has two or more batteries, tap it.', (b, K) => b.label === 'FIRE' && K.bat >= 2, 'tap'],
  ['Otherwise, if the button is white and there is a lit AUX indicator, hold it.', (b, K) => b.color === 'white' && K.lit('AUX'), 'hold'],
  ['Otherwise, if the button is red and says HALT, tap it.', (b) => b.color === 'red' && b.label === 'HALT', 'tap'],
  ['Otherwise, if the button is yellow, hold it.', (b) => b.color === 'yellow', 'hold'],
  ['Otherwise, if the bomb has no batteries, hold it.', (b, K) => K.bat === 0, 'hold'],
  ['Otherwise, tap it.', () => true, 'tap'],
];
const STRIP_DIGIT = { blue: 3, white: 6, yellow: 1, red: 8 };
// sequence: SEQ_MAP[vowel ? 'v' : 'n'][strikes][flash] -> pad to press
const SEQ_MAP = {
  v: [
    { red: 'green', blue: 'yellow', green: 'red', yellow: 'blue' },
    { red: 'blue', blue: 'green', green: 'yellow', yellow: 'red' },
    { red: 'yellow', blue: 'red', green: 'blue', yellow: 'green' },
  ],
  n: [
    { red: 'yellow', blue: 'blue', green: 'red', yellow: 'green' },
    { red: 'blue', blue: 'yellow', green: 'red', yellow: 'green' },
    { red: 'green', blue: 'yellow', green: 'blue', yellow: 'red' },
  ],
};
// 30 original glyphs (24×24, stroked) and the guide's five columns of seven
const GLYPHS = {
  hook: 'M9 3v11a4 4 0 0 0 8 0v-2',
  fork: 'M12 21V8M6 3v5a6 6 0 0 0 12 0V3',
  eye: 'M2.5 12C6.5 6 17.5 6 21.5 12C17.5 18 6.5 18 2.5 12ZM14 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
  bolt: 'M13.5 2.5L6 13.5h5.5L10 21.5L18 10h-5.5z',
  ladder: 'M8 3v18M16 3v18M8 7.5h8M8 12h8M8 16.5h8',
  comb: 'M4 5h16M6 5v14M10 5v9M14 5v14M18 5v9',
  moon: 'M15.5 3.5a8.5 8.5 0 1 0 0 17a6.5 6.5 0 1 1 0-17z',
  spark: 'M12 2.5l2.4 7.1l7.1 2.4l-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4z',
  glass: 'M6 3h12L6 21h12z',
  loop: 'M12 12C9.5 8.5 4 8.5 4 12s5.5 3.5 8 0s8-3.5 8 0s-5.5 3.5-8 0z',
  anchor: 'M12 7v14M8 11h8M4.5 14.5a7.5 7.5 0 0 0 15 0M14 4.5a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
  crown: 'M4 19h16l-1.5-11l-4 4.5L12 5l-2.5 7.5l-4-4.5z',
  waves: 'M3 9c3-3 6 3 9 0s6-3 9 0M3 15c3-3 6 3 9 0s6-3 9 0',
  key: 'M4 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 12h9M17 12v4M20 12v3',
  flag: 'M6 21V3l12 5l-12 5',
  bow: 'M4 6l8 6l-8 6zM20 6l-8 6l8 6z',
  sun: 'M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1',
  arch: 'M5 21v-9a7 7 0 0 1 14 0v9M9 21v-8a3 3 0 0 1 6 0v8',
  zigzag: 'M3 8l4.5 8l4.5-8l4.5 8L21 8',
  target: 'M20 12a8 8 0 1 1-16 0a8 8 0 1 1 16 0M14.5 12a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0',
  leaf: 'M5 19C5 10 10 5 19 5C19 14 14 19 5 19ZM5 19l8-8',
  steps: 'M3 20h5v-5h5v-5h5V5h3',
  tri: 'M12 3.5L21 19.5H3zM12 15h.01',
  gate: 'M5 21V4h14v17M5 10h14M12 10v11',
  cross: 'M12 2v20M2 12h20M17 12a5 5 0 1 1-10 0a5 5 0 1 1 10 0',
  drop: 'M12 3c4.5 6 6.5 9.2 6.5 12a6.5 6.5 0 0 1-13 0C5.5 12.2 7.5 9 12 3zM9 15.5a3 3 0 0 0 3 3',
  cup: 'M6 3v7a6 6 0 0 0 12 0V3M4 21h16M12 16v5',
  shell: 'M3.5 17a8.5 8.5 0 0 1 17 0zM12 17V8.5M8 17l-2.6-6M16 17l2.6-6',
  peaks: 'M2.5 19l5.5-13l4 9l4-9l5.5 13',
  spiral: 'M12 12a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0a4.5 4.5 0 0 1 9 0a6 6 0 0 1-12 0a7.5 7.5 0 0 1 15 0',
};
const COLUMNS = [
  ['spark', 'hook', 'ladder', 'moon', 'crown', 'loop', 'drop'],
  ['eye', 'spark', 'bolt', 'waves', 'hook', 'gate', 'shell'],
  ['anchor', 'comb', 'glass', 'eye', 'key', 'steps', 'flag'],
  ['bow', 'fork', 'sun', 'ladder', 'arch', 'zigzag', 'target'],
  ['leaf', 'tri', 'cross', 'cup', 'peaks', 'spiral', 'comb'],
];
const glyph = (id, cls = 'dx-glyph') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${GLYPHS[id]}"/></svg>`;

// ── a bomb, drawn deterministically from a seed ────────────────────────────────
function genBomb(seed, diff) {
  const r = rng('defuse|' + seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const CONS = 'BCDFGHJKLMNPQRSTVWXZ';
  const DIG = '0123456789';
  const vowel = r() < 0.5;
  const ch = [];
  for (let i = 0; i < 5; i++) ch.push(r() < 0.55 ? pick(CONS) : pick(DIG));
  if (vowel) ch[Math.floor(r() * 5)] = pick('AEU');
  ch.push(pick(DIG));
  const serial = ch.join('');
  const batteries = Math.floor(r() * 5);
  const pool = [...INDICATORS];
  const indicators = [0, 1].map(() => ({ label: pool.splice(Math.floor(r() * pool.length), 1)[0], lit: r() < 0.5 }));
  const wires = Array.from({ length: 3 + Math.floor(r() * 4) }, () => pick(WIRE_COLORS));
  const button = { color: pick(BTN_COLORS), label: pick(BTN_LABELS), strip: pick(STRIP_COLORS) };
  // keypad: four glyphs from one column, never all four in another column
  let col = 0;
  let four = [];
  for (let guard = 0; guard < 50; guard++) {
    col = Math.floor(r() * COLUMNS.length);
    const idx = [0, 1, 2, 3, 4, 5, 6];
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    four = idx.slice(0, 4).map((i) => COLUMNS[col][i]);
    if (!COLUMNS.some((c, k) => k !== col && four.every((g) => c.includes(g)))) break;
  }
  const keys = [...four];
  for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  const seq = Array.from({ length: DIFFS[diff].stages }, () => pick(PAD_COLORS));
  const bomb = { seed, diff, serial, vowel, batteries, indicators, wires, button, keypad: keys, seq };
  bomb.answers = solveBomb(bomb);
  return bomb;
}
function ctxOf(b) {
  const last = +b.serial[b.serial.length - 1];
  return { serial: b.serial, last, even: last % 2 === 0, vowel: /[AEIOU]/.test(b.serial), bat: b.batteries, lit: (l) => b.indicators.some((i) => i.label === l && i.lit) };
}
function solveBomb(b) {
  const K = ctxOf(b);
  const wr = WIRE_RULES[b.wires.length];
  const wi = wr.findIndex(([, when]) => when(b.wires, K));
  const bi = BUTTON_RULES.findIndex(([, when]) => when(b.button, K));
  const act = BUTTON_RULES[bi][2];
  const col = COLUMNS.findIndex((c) => b.keypad.every((g) => c.includes(g)));
  return {
    wire: wr[wi][2](b.wires, K), wireRule: wi,
    button: { act, digit: act === 'hold' ? STRIP_DIGIT[b.button.strip] : null, rule: bi },
    keypad: [...b.keypad].sort((x, y) => COLUMNS[col].indexOf(x) - COLUMNS[col].indexOf(y)), column: col,
    seq: [0, 1, 2].map((st) => b.seq.map((c) => SEQ_MAP[K.vowel ? 'v' : 'n'][st][c])),
  };
}

// remembered between rematches on this device
const memo = { role: null, diff: 'normal', page: 'basics' };
const ENDED = new Set();

const ICON_BOMB = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="18" width="48" height="36" rx="8" class="f-card"/><rect x="15" y="25" width="22" height="11" rx="2" class="f-lcd"/><path d="M19 30.5h3M25 30.5h3M31 30.5h2" class="s-hl"/><circle cx="46" cy="30.5" r="5" class="f-bad"/><path d="M15 43c6 5 12-5 18 0s12-5 16 0" class="s-wire"/><path d="M32 18c0-6 4-9 9-9s7 3 8 0" class="s-ink"/><path d="M50 4l1.5 4M54 6l-3 3M55 11l-4-1" class="s-ink"/></svg>';
const ICON_BOOK = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 16c-7-5-15-6-24-5v38c9-1 17 0 24 5c7-5 15-6 24-5V11c-9-1-17 0-24 5z" class="f-card"/><path d="M32 16v38" class="s-ink"/><path d="M14 20c4-.5 8 0 12 2M14 27c4-.5 8 0 12 2M14 34c4-.5 8 0 12 2M38 22c4-2 8-2.5 12-2M38 29c4-2 8-2.5 12-2" class="s-muted"/><rect x="38" y="35" width="12" height="10" rx="2" class="f-hl"/></svg>';

registerGame({
  id: 'defuse',
  title: 'Defuse',
  blurb: 'One sees the bomb, one reads the manual. Talk fast.',
  kind: 'live',
  team: true,
  modes: ['live'],
  tags: ['brainy'],
  platforms: ['phone', 'computer'],
  best: 'computer',
  minutes: 6,
  howTo: [
    'One of you holds the Bomb, the other reads the Manual. Talk out loud.',
    'The Bomb describes what they see; the Manual finds the rule and says what to do.',
    'Solve all four modules before the clock runs out.',
    'A wrong move is a strike and speeds the clock up. Three strikes: boom.',
  ],
  css: `
.g-defuse { --dx-red: #e0393e; --dx-blue: #2369d6; --dx-yellow: #ffd21f; --dx-green: #1e9a55; --dx-white: #f8f5ec; --dx-black: #23212a; --dx-dark: #18171d;
  position: relative; flex: 1; display: flex; flex-direction: column; gap: 14px; padding: 4px 0 12px; color: var(--g-ink); font-family: var(--g-font-body); }
@media (min-width: 760px) { .g-defuse { width: calc(100vw - 48px); max-width: 1120px; align-self: center; } }
.g-defuse :where(button:not(.gm-btn)) { font: inherit; color: inherit; } .g-defuse button { cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.g-defuse .dx-tag { display: block; font: 800 0.66rem/1.15 var(--g-font-body); letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); }
.g-defuse .dx-h { font: 400 clamp(1.45rem, 5.4vw, 2.1rem)/1.05 var(--g-font-display); margin: 0; }
.g-defuse .f-card { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 3; } .g-defuse .f-lcd { fill: var(--dx-dark); stroke: var(--g-ink); stroke-width: 2.5; }
.g-defuse .f-bad { fill: var(--dx-red); stroke: var(--g-ink); stroke-width: 2.5; } .g-defuse .f-hl { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 2.5; }
.g-defuse .s-ink { fill: none; stroke: var(--g-ink); stroke-width: 3; stroke-linecap: round; } .g-defuse .s-hl { fill: none; stroke: var(--g-hl); stroke-width: 3; stroke-linecap: round; }
.g-defuse .s-muted { fill: none; stroke: var(--g-muted); stroke-width: 2.5; stroke-linecap: round; } .g-defuse .s-wire { fill: none; stroke: var(--dx-blue); stroke-width: 4; stroke-linecap: round; }
.g-defuse .dx-glyph { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

/* one-device card */
.g-defuse .dx-solo { margin: auto; width: min(100%, 380px); display: flex; flex-direction: column; gap: 12px; padding: 22px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); }
.g-defuse .dx-solo-art { display: flex; gap: 10px; justify-content: center; } .g-defuse .dx-solo-art svg { width: 72px; height: 72px; }
.g-defuse .dx-solo p { line-height: 1.45; }

/* lobby */
.g-defuse .dx-lobby { width: min(100%, 760px); margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.g-defuse .dx-lead { font-size: 1rem; line-height: 1.45; color: var(--g-muted); font-weight: 600; margin-top: 6px !important; }
.g-defuse .dx-roles { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.g-defuse .dx-role { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 14px 14px 12px; text-align: left; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-ink)); transition: transform 0.1s, box-shadow 0.1s, background-color 0.15s; min-height: 200px; }
.g-defuse .dx-role:active { transform: translate(3px, 3px); box-shadow: 0 0 0 var(--g-ink); }
.g-defuse .dx-role svg { width: 58px; height: 58px; }
.g-defuse .dx-role-name { font: 400 1.35rem/1 var(--g-font-display); }
.g-defuse .dx-role-desc { font-size: 0.92rem; line-height: 1.35; color: var(--g-muted); font-weight: 600; }
.g-defuse .dx-role-dev { font: 800 0.66rem/1 var(--g-font-body); letter-spacing: 0.12em; text-transform: uppercase; padding: 5px 8px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-hl); color: var(--g-on-ink); }
.g-defuse .dx-role-who { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; margin-top: auto; }
.g-defuse .dx-role-who .g-chip { min-height: 26px; }
.g-defuse .dx-role.is-mine { background: var(--g-hl-soft, var(--g-card)); transform: translate(-2px, -2px); box-shadow: 6px 6px 0 var(--g-edge, var(--g-ink)); }
.g-defuse .dx-role.is-clash { border-style: dashed; }
.g-defuse .dx-who { display: inline-flex; align-items: center; min-height: 26px; padding: 2px 10px; border: 2px solid var(--g-ink); border-radius: 999px; font: 800 0.8rem/1 var(--g-font-body); color: var(--g-on-ink); }
.g-defuse .dx-who.p-a { background: var(--p-a); } .g-defuse .dx-who.p-b { background: var(--p-b); }
.g-defuse .dx-hint { display: flex; gap: 8px; align-items: center; font-weight: 700; font-size: 0.92rem; line-height: 1.35; }
.g-defuse .dx-hint i { flex: none; width: 10px; height: 10px; background: var(--g-hl); border: 2px solid var(--g-ink); transform: rotate(45deg); }
.g-defuse .dx-diff { display: grid; grid-template-columns: repeat(3, 1fr); border: 2.5px solid var(--g-ink); border-radius: 12px; overflow: hidden; background: var(--g-card); box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
.g-defuse .dx-diff button { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 9px 4px; min-height: 52px; background: none; border: 0; border-left: 2px solid var(--g-ink); }
.g-defuse .dx-diff button:first-child { border-left: 0; }
.g-defuse .dx-diff b { font: 400 0.98rem/1 var(--g-font-display); } .g-defuse .dx-diff span { font-size: 0.8rem; font-weight: 700; color: var(--g-muted); font-variant-numeric: tabular-nums; }
.g-defuse .dx-diff button[aria-checked="true"] { background: var(--g-ink); color: var(--g-bg); } .g-defuse .dx-diff button[aria-checked="true"] span { color: inherit; opacity: 0.8; }
.g-defuse .dx-lobby-status { min-height: 1.4em; text-align: center; font-weight: 800; }
.g-defuse .dx-lobby-actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 12px; }
.g-defuse .dx-lobby-actions .gm-btn { min-height: 54px; }

/* the bomb */
.g-defuse .dx-bomb { position: relative; display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 16px; padding: 22px; background-color: var(--g-card); background-image: var(--g-halftone, none); background-size: 6px 6px; border: 3px solid var(--g-ink); border-radius: 24px; box-shadow: 8px 8px 0 var(--g-edge, var(--g-ink)); }
.g-defuse .dx-screw { position: absolute; width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--g-ink); background: var(--g-bg); }
.g-defuse .dx-screw::after { content: ''; position: absolute; left: 1px; right: 1px; top: 50%; height: 2px; margin-top: -1px; background: var(--g-ink); transform: rotate(35deg); }
.g-defuse .dx-screw:nth-child(1) { left: 7px; top: 7px; } .g-defuse .dx-screw:nth-child(2) { right: 7px; top: 7px; }
.g-defuse .dx-screw:nth-child(3) { left: 7px; bottom: 7px; } .g-defuse .dx-screw:nth-child(4) { right: 7px; bottom: 7px; }
.g-defuse .dx-side { display: flex; flex-direction: column; gap: 14px; }
.g-defuse .dx-lcd { padding: 10px 12px 12px; background: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: inset 0 -5px 0 rgb(255 255 255 / 0.06); }
.g-defuse .dx-lcd .dx-tag { color: #8d8a80; }
.g-defuse .dx-time { display: block; font: 400 2.9rem/1 var(--g-font-display); color: var(--dx-yellow); font-variant-numeric: tabular-nums; letter-spacing: 0.02em; text-align: center; margin-top: 4px; }
.g-defuse .dx-bomb.is-hurry .dx-time { color: var(--dx-red); }
.g-defuse .dx-strikes { display: flex; gap: 8px; justify-content: center; }
.g-defuse .dx-strikes i { position: relative; width: 30px; height: 30px; border: 2.5px solid var(--g-ink); border-radius: 7px; background: var(--g-bg); }
.g-defuse .dx-strikes i.on { background: var(--dx-red); }
.g-defuse .dx-strikes i.on::before, .g-defuse .dx-strikes i.on::after { content: ''; position: absolute; left: 4px; right: 4px; top: 50%; height: 3px; margin-top: -1.5px; background: var(--dx-dark); border-radius: 2px; transform: rotate(45deg); }
.g-defuse .dx-strikes i.on::after { transform: rotate(-45deg); }
.g-defuse .dx-sticker { padding: 8px 10px 9px; background: var(--dx-white); color: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 6px; transform: rotate(-1.5deg); box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
.g-defuse .dx-sticker .dx-tag { color: #6a665e; }
.g-defuse .dx-serial { display: block; font: 800 1.5rem/1.1 ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; letter-spacing: 0.12em; }
.g-defuse .dx-bay { display: flex; flex-direction: column; gap: 6px; }
.g-defuse .dx-bats { display: flex; flex-wrap: wrap; gap: 6px; min-height: 22px; align-items: center; }
.g-defuse .dx-bats svg { width: 40px; height: 20px; }
.g-defuse .dx-bats .b-body { fill: var(--dx-yellow); stroke: var(--g-ink); stroke-width: 2.2; } .g-defuse .dx-bats .b-band { fill: var(--dx-dark); } .g-defuse .dx-bats .b-nub { fill: var(--g-ink); }
.g-defuse .dx-none { font-size: 0.82rem; font-weight: 700; color: var(--g-muted); padding: 3px 8px; border: 2px dashed var(--g-line); border-radius: 6px; }
.g-defuse .dx-inds { display: flex; gap: 8px; flex-wrap: wrap; }
.g-defuse .dx-ind { display: inline-flex; align-items: center; gap: 7px; padding: 5px 9px 5px 6px; background: var(--g-bg); border: 2px solid var(--g-ink); border-radius: 8px; font: 800 0.9rem/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.06em; }
.g-defuse .dx-ind i { width: 15px; height: 15px; border-radius: 50%; border: 2px solid var(--g-ink); background: color-mix(in srgb, var(--g-ink) 22%, var(--g-card)); }
.g-defuse .dx-ind.is-lit i { background: var(--dx-yellow); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dx-yellow) 35%, transparent); }
.g-defuse .dx-mods { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.g-defuse .dx-mod { position: relative; display: flex; flex-direction: column; min-height: 220px; padding: 10px 12px 12px; background: color-mix(in srgb, var(--g-ink) 5%, var(--g-card)); border: 2.5px solid var(--g-ink); border-radius: 14px; box-shadow: inset 3px 3px 0 color-mix(in srgb, var(--g-ink) 10%, transparent); }
.g-defuse .dx-mod-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.g-defuse .dx-mod-tag { padding: 4px 8px; background: var(--g-ink); color: var(--g-bg); border-radius: 6px; font: 800 0.66rem/1 var(--g-font-body); letter-spacing: 0.14em; text-transform: uppercase; }
.g-defuse .dx-led { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--g-ink); background: color-mix(in srgb, var(--g-ink) 18%, var(--g-card)); transition: background-color 0.15s; }
.g-defuse .dx-mod.is-solved .dx-led { background: var(--g-good); box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-good) 30%, transparent); }
.g-defuse .dx-mod.is-bad .dx-led { background: var(--g-bad); }
.g-defuse .dx-mod.is-bad { animation: dx-shake 0.32s ease-out; }
.g-defuse .dx-mod.is-solved::after { content: ''; position: absolute; inset: 0; border-radius: 12px; background: repeating-linear-gradient(-45deg, transparent 0 9px, color-mix(in srgb, var(--g-good) 12%, transparent) 9px 11px); pointer-events: none; }
.g-defuse .dx-mod-body { flex: 1; display: grid; place-items: center; padding-top: 8px; }
.g-defuse .dx-wires { width: 100%; max-width: 290px; height: auto; display: block; overflow: visible; }
.g-defuse .dx-term { fill: color-mix(in srgb, var(--g-ink) 14%, var(--g-card)); stroke: var(--g-ink); stroke-width: 2.5; }
.g-defuse .dx-stud { fill: var(--g-card); stroke: var(--g-ink); stroke-width: 2; }
.g-defuse .dx-wire { cursor: pointer; outline: none; }
.g-defuse .dx-wire .o { fill: none; stroke: var(--g-ink); stroke-width: 11; stroke-linecap: round; }
.g-defuse .dx-wire .c { fill: none; stroke: var(--w); stroke-width: 6.5; stroke-linecap: round; }
.g-defuse .dx-wire .s { fill: none; stroke: color-mix(in srgb, #fff 45%, var(--w)); stroke-width: 1.6; stroke-linecap: round; stroke-dasharray: 14 9; transform: translateY(-1.6px); }
.g-defuse .dx-wire .hit { fill: none; stroke: transparent; stroke-width: 24; pointer-events: stroke; }
.g-defuse .dx-wire .cut, .g-defuse .dx-wire.is-cut .whole { display: none; } .g-defuse .dx-wire.is-cut .cut { display: inline; }
.g-defuse .dx-wire .tip { fill: var(--dx-yellow); stroke: var(--g-ink); stroke-width: 1.5; }
.g-defuse .dx-wire:focus-visible .o { stroke: var(--p-a); }
@media (hover: hover) { .g-defuse .dx-wire:not(.is-cut):hover .o { stroke-width: 13.5; } }
.g-defuse .dx-btnwrap { display: flex; align-items: center; gap: 22px; }
.g-defuse .dx-big { position: relative; width: 132px; height: 132px; border-radius: 50%; border: 3px solid var(--g-ink); background: var(--bc); color: var(--dx-dark); box-shadow: 0 9px 0 var(--g-ink); transform: translateY(-4px); transition: transform 0.07s, box-shadow 0.07s; touch-action: none; user-select: none; -webkit-user-select: none; }
.g-defuse .dx-big::before { content: ''; position: absolute; inset: 9px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--dx-dark) 30%, transparent); }
.g-defuse .dx-big span { position: relative; font: 400 1.35rem/1 var(--g-font-display); letter-spacing: 0.04em; }
.g-defuse .dx-big.is-down { transform: translateY(4px); box-shadow: 0 1px 0 var(--g-ink); }
.g-defuse .dx-big:focus-visible { outline: 3px solid var(--p-a); outline-offset: 4px; }
.g-defuse .dx-strip { width: 22px; height: 128px; padding: 4px; border: 2.5px solid var(--g-ink); border-radius: 11px; background: var(--dx-dark); }
.g-defuse .dx-strip i { display: block; height: 100%; border-radius: 6px; background: #3a3842; transition: background-color 0.12s; }
.g-defuse .dx-strip.is-on i { background: var(--sc); }
.g-defuse .dx-keys { display: grid; grid-template-columns: repeat(2, 86px); gap: 12px; }
.g-defuse .dx-gkey { position: relative; display: grid; place-items: center; width: 86px; height: 86px; padding: 18px 16px 12px; background: var(--dx-white); color: var(--dx-dark); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: 0 5px 0 var(--g-ink); transition: transform 0.06s, box-shadow 0.06s; }
.g-defuse .dx-gkey:active { transform: translateY(4px); box-shadow: 0 1px 0 var(--g-ink); }
.g-defuse .dx-gkey .dx-kled { position: absolute; top: 6px; left: 50%; width: 22px; height: 7px; margin-left: -11px; border-radius: 4px; border: 1.5px solid var(--dx-dark); background: #bdb8ad; }
.g-defuse .dx-gkey.is-ok .dx-kled { background: var(--dx-green); } .g-defuse .dx-gkey.is-no .dx-kled { background: var(--dx-red); }
.g-defuse .dx-gkey .dx-glyph { width: 44px; height: 44px; stroke-width: 2.2; }
.g-defuse .dx-gkey:focus-visible { outline: 3px solid var(--p-a); outline-offset: 3px; }
.g-defuse .dx-seqwrap { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.g-defuse .dx-seq { display: grid; grid-template-columns: repeat(2, 74px); gap: 12px; transform: rotate(45deg); margin: 18px; }
.g-defuse .dx-pad { position: relative; width: 74px; height: 74px; border: 2.5px solid var(--g-ink); border-radius: 12px; background: color-mix(in srgb, var(--pc) 34%, var(--g-card)); box-shadow: 3px 3px 0 var(--g-ink); transition: transform 0.06s, box-shadow 0.06s, background-color 0.08s; }
.g-defuse .dx-pad span { position: absolute; left: 7px; top: 5px; transform: rotate(-45deg); font: 800 0.72rem/1 var(--g-font-body); color: var(--g-ink); opacity: 0.75; }
.g-defuse .dx-pad.is-lit { background: var(--pc); transform: translate(-2px, -2px); box-shadow: 5px 5px 0 var(--g-ink); }
.g-defuse .dx-pad.is-lit span { color: var(--dx-dark); }
.g-defuse .dx-pad:active { transform: translate(2px, 2px); box-shadow: 0 0 0 var(--g-ink); }
.g-defuse .dx-pad:focus-visible { outline: 3px solid var(--p-a); outline-offset: 3px; }
.g-defuse .dx-stage { display: flex; gap: 6px; }
.g-defuse .dx-stage i { width: 12px; height: 12px; border: 2px solid var(--g-ink); border-radius: 50%; background: var(--g-card); }
.g-defuse .dx-stage i.on { background: var(--g-good); } .g-defuse .dx-stage i.now { background: var(--g-hl); }
.g-defuse .is-shake { animation: dx-shake 0.36s ease-out; }
@keyframes dx-shake { 0%, 100% { translate: 0 0; } 20% { translate: -6px 1px; } 40% { translate: 5px -1px; } 60% { translate: -3px 1px; } 80% { translate: 2px 0; } }

/* finale */
.g-defuse .dx-fx { position: fixed; inset: 0; z-index: 3; display: grid; place-items: center; padding: 120px 16px 16px; pointer-events: none; }
.g-defuse .dx-fx:empty { display: none; }
.g-defuse .dx-boom { position: relative; width: min(92%, 520px); aspect-ratio: 1.15; display: grid; place-items: center; animation: dx-boom 0.5s cubic-bezier(0.2, 1.5, 0.4, 1) both; }
.g-defuse .dx-boom svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.g-defuse .dx-boom .b1 { fill: var(--g-hl); stroke: var(--g-ink); stroke-width: 5; stroke-linejoin: round; }
.g-defuse .dx-boom .b2 { fill: var(--dx-red); stroke: var(--g-ink); stroke-width: 4; stroke-linejoin: round; }
.g-defuse .dx-boom .b0 { fill: var(--g-edge, var(--g-ink)); }
.g-defuse .dx-boom b { position: relative; font: 400 clamp(3rem, 15vw, 5.6rem)/1 var(--g-font-display); color: var(--g-hl); -webkit-text-stroke: 2.5px var(--dx-dark); paint-order: stroke fill; text-shadow: 4px 4px 0 var(--dx-dark); transform: rotate(-6deg); }
@keyframes dx-boom { from { transform: scale(0.3) rotate(-12deg); opacity: 0; } to { transform: scale(1) rotate(0); opacity: 1; } }
.g-defuse .dx-stamp { padding: 14px 22px 12px; text-align: center; background: var(--g-card); color: var(--g-good); border: 5px double var(--g-good); border-radius: 12px; transform: rotate(-7deg); box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); animation: dx-stamp 0.45s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
.g-defuse .dx-stamp b { display: block; font: 400 clamp(2.4rem, 11vw, 4.2rem)/1 var(--g-font-display); letter-spacing: 0.04em; }
.g-defuse .dx-stamp span { font-weight: 800; font-size: 1.05rem; color: var(--g-ink); }
@keyframes dx-stamp { from { transform: rotate(-7deg) scale(2.2); opacity: 0; } to { transform: rotate(-7deg) scale(1); opacity: 1; } }
.g-defuse.is-boom .dx-bomb, .g-defuse.is-boom .dx-manual-wrap { filter: grayscale(1); opacity: 0.5; }

/* the manual: a field guide */
.g-defuse .dx-mbar { position: sticky; top: 0; z-index: 2; display: grid; grid-template-columns: auto auto 1fr; align-items: center; gap: 14px; padding: 9px 12px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 12px; box-shadow: var(--g-shadow, 3px 3px 0 var(--g-ink)); }
.g-defuse .dx-mbar .dx-lcd { padding: 5px 10px 6px; border-radius: 9px; }
.g-defuse .dx-mbar .dx-time { font-size: 1.75rem; margin: 0; }
.g-defuse .dx-mbar .dx-strikes { gap: 5px; align-items: center; } .g-defuse .dx-mbar .dx-strikes .dx-tag { margin-right: 4px; } .g-defuse .dx-mbar .dx-strikes i { width: 22px; height: 22px; border-radius: 5px; }
.g-defuse .dx-mbar .dx-strikes i.on::before, .g-defuse .dx-mbar .dx-strikes i.on::after { left: 3px; right: 3px; height: 2.5px; }
.g-defuse .dx-mbar.is-bad { animation: dx-shake 0.36s ease-out; border-color: var(--g-bad); }
.g-defuse .dx-lamps { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.g-defuse .dx-lamp { display: inline-flex; align-items: center; gap: 5px; font: 800 0.7rem/1 var(--g-font-body); letter-spacing: 0.06em; text-transform: uppercase; color: var(--g-muted); }
.g-defuse .dx-lamp i { width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--g-ink); background: color-mix(in srgb, var(--g-ink) 15%, var(--g-card)); }
.g-defuse .dx-lamp.on { color: var(--g-ink); } .g-defuse .dx-lamp.on i { background: var(--g-good); }
.g-defuse .dx-manual-wrap { display: flex; flex-direction: column; gap: 16px; }
.g-defuse .dx-mbody { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 22px; align-items: start; }
.g-defuse .dx-index { position: sticky; top: 76px; display: flex; flex-direction: column; gap: 8px; }
.g-defuse .dx-index button { display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 10px; padding: 9px 10px; text-align: left; background: var(--g-card); border: 2px solid var(--g-ink); border-radius: 10px; font-weight: 800; font-size: 0.98rem; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
.g-defuse .dx-index button .n { display: grid; place-items: center; width: 28px; height: 28px; border: 2px solid var(--g-ink); border-radius: 50%; font: 400 0.8rem/1 var(--g-font-display); background: var(--g-bg); }
.g-defuse .dx-index button[aria-selected="true"] { background: var(--g-ink); color: var(--g-bg); } .g-defuse .dx-index button[aria-selected="true"] .n { background: var(--g-hl); color: var(--g-on-ink); border-color: var(--g-bg); }
.g-defuse .dx-index .ok { width: 18px; height: 18px; } .g-defuse .dx-index .ok path { fill: none; stroke: var(--g-good); stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; }
.g-defuse .dx-index button[aria-selected="true"] .ok path { stroke: var(--g-bg); }
.g-defuse .dx-index button:not(.is-done) .ok { visibility: hidden; }
.g-defuse .dx-page { position: relative; padding: 22px 26px 26px; background: var(--g-card); border: 2.5px solid var(--g-ink); border-radius: 6px 14px 14px 6px; box-shadow: var(--g-shadow-lg, 6px 6px 0 var(--g-ink)); font-size: 1.12rem; line-height: 1.55; }
.g-defuse .dx-page::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 10px; border-right: 2px solid var(--g-ink); background: var(--g-hl); border-radius: 4px 0 0 4px; }
.g-defuse .dx-sec[hidden] { display: none !important; }
.g-defuse .dx-run { display: flex; justify-content: space-between; gap: 10px; padding-bottom: 8px; margin-bottom: 14px; border-bottom: 2px solid var(--g-ink); font: 800 0.66rem/1.2 var(--g-font-body); letter-spacing: 0.16em; text-transform: uppercase; color: var(--g-muted); }
.g-defuse .dx-sec h3 { margin: 0 0 10px; font: 400 clamp(1.5rem, 6vw, 2rem)/1.05 var(--g-font-display); display: flex; align-items: center; gap: 12px; }
.g-defuse .dx-sec h3 .n { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border: 2.5px solid var(--g-ink); border-radius: 50%; background: var(--g-hl); color: var(--g-on-ink); font-size: 1rem; }
.g-defuse .dx-sec h4 { margin: 18px 0 8px; font: 800 0.78rem/1.2 var(--g-font-body); letter-spacing: 0.14em; text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
.g-defuse .dx-sec h4::after { content: ''; flex: 1; height: 2px; background: var(--g-line); }
.g-defuse .dx-sec p { margin: 0 0 10px; }
.g-defuse .dx-sec .dx-intro { font-weight: 600; }
.g-defuse .dx-rules { list-style: none; counter-reset: rule; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.g-defuse .dx-rules li { counter-increment: rule; display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; align-items: start; }
.g-defuse .dx-rules li::before { content: counter(rule); display: grid; place-items: center; width: 28px; height: 28px; margin-top: 1px; border: 2px solid var(--g-ink); border-radius: 6px; background: var(--g-bg); font: 400 0.82rem/1 var(--g-font-display); }
.g-defuse .dx-note { padding: 10px 12px; margin-top: 12px !important; border: 2px dashed var(--g-ink); border-radius: 8px; font-size: 0.98rem; }
.g-defuse .dx-sw { display: inline-block; width: 0.95em; height: 0.95em; margin-right: 6px; vertical-align: -0.12em; border: 2px solid var(--g-ink); border-radius: 3px; background: var(--sw); }
.g-defuse table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 1rem; margin: 6px 0 4px; }
.g-defuse th, .g-defuse td { border: 2px solid var(--g-ink); padding: 7px 8px; text-align: left; }
.g-defuse th { font: 800 0.72rem/1.2 var(--g-font-body); letter-spacing: 0.1em; text-transform: uppercase; background: var(--g-bg); }
.g-defuse td.is-now, .g-defuse th.is-now { background: var(--g-hl-soft, var(--g-bg)); }
.g-defuse .dx-cols { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; max-width: 520px; }
.g-defuse .dx-col { display: flex; flex-direction: column; gap: 6px; padding: 6px; border: 2px solid var(--g-ink); border-radius: 10px; background: var(--g-bg); }
.g-defuse .dx-col b { text-align: center; font: 400 0.95rem/1 var(--g-font-display); padding: 2px 0 4px; border-bottom: 2px solid var(--g-ink); }
.g-defuse .dx-col span { display: grid; place-items: center; aspect-ratio: 1; padding: 6px; background: var(--g-card); border: 1.5px solid var(--g-ink); border-radius: 7px; }
.g-defuse .dx-col .dx-glyph { width: 100%; max-width: 40px; }
.g-defuse .dx-foot { margin-top: 18px !important; padding-top: 8px; border-top: 2px solid var(--g-line); font-size: 0.8rem; color: var(--g-muted); font-weight: 700; display: flex; justify-content: space-between; }

@media (max-width: 759px) {
  .g-defuse .dx-bomb { grid-template-columns: 1fr; padding: 18px 14px 16px; border-radius: 20px; box-shadow: 6px 6px 0 var(--g-edge, var(--g-ink)); }
  .g-defuse .dx-side { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
  .g-defuse .dx-side .dx-lcd { grid-column: 1; } .g-defuse .dx-side .dx-strikes { grid-column: 2; align-self: center; }
  .g-defuse .dx-time { font-size: 2.3rem; }
  .g-defuse .dx-mods { grid-template-columns: 1fr; }
  .g-defuse .dx-mod { min-height: 0; }
  .g-defuse .dx-mbody { grid-template-columns: 1fr; gap: 12px; }
  .g-defuse .dx-index { position: static; flex-direction: row; overflow-x: auto; gap: 6px; padding: 2px 4px 6px 2px; scrollbar-width: none; }
  .g-defuse .dx-index button { grid-template-columns: auto auto; flex: none; padding: 7px 10px 7px 7px; font-size: 0.9rem; gap: 7px; }
  .g-defuse .dx-index button .ok { display: none; }
  .g-defuse .dx-index button.is-done .n { background: var(--g-good); color: var(--g-card); }
  .g-defuse .dx-page { padding: 16px 14px 18px 22px; font-size: 1.06rem; }
  .g-defuse .dx-mbar { grid-template-columns: auto auto; gap: 8px 12px; padding: 8px 10px; }
  .g-defuse .dx-lamps { grid-column: 1 / -1; justify-content: space-between; }
  .g-defuse .dx-cols { gap: 6px; } .g-defuse .dx-col { padding: 4px; gap: 4px; } .g-defuse .dx-col span { padding: 4px; }
  .g-defuse th, .g-defuse td { padding: 6px 5px; font-size: 0.92rem; }
}
@media (max-width: 440px) {
  .g-defuse th, .g-defuse td { padding: 6px 4px; font-size: 0.88rem; overflow-wrap: anywhere; }
  .g-defuse th { font-size: 0.62rem; letter-spacing: 0.05em; }
  .g-defuse td .dx-sw, .g-defuse tbody th .dx-sw { display: block; margin: 0 0 4px; }
}
@media (max-width: 380px) { .g-defuse .dx-roles { gap: 10px; } .g-defuse .dx-role { padding: 12px 10px; } .g-defuse .dx-role-name { font-size: 1.15rem; } }
@media (prefers-reduced-motion: reduce) { .g-defuse *, .g-defuse *::before, .g-defuse *::after { animation: none !important; transition: none !important; } }
`,
  mount(el, api) {
    if (api.mode !== 'live') {
      el.innerHTML = `<div class="g-defuse"><div class="dx-solo">
        <div class="dx-solo-art">${ICON_BOMB}${ICON_BOOK}</div>
        <h2 class="dx-h">Two devices, please</h2>
        <p>Defuse needs two devices: one for the bomb, one for the manual.</p>
        <p class="dx-lead">Start it with <b>Play live</b>. The bomb works best on a computer, the manual on a phone. Then talk it through out loud.</p>
        <button type="button" class="gm-btn gm-btn-big" data-g="close">Back to games</button>
      </div></div>`;
      api.setStatus('Needs two devices');
      return { destroy() {} };
    }

    const me = api.me;
    const them = api.other(me);
    const offs = [];
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const token = () => Math.random().toString(36).slice(2, 10);
    let alive = true;
    let raf = 0;

    // lobby state (mine), the partner's comes from presence
    const L = { role: memo.role, diff: DIFFS[memo.diff] ? memo.diff : 'normal', dv: 0, dw: me, go: null, sw: null };
    const P = () => { const s = api.partnerState(); return s && s.v === 1 ? s : null; };
    const seenGo = new Set();
    const seenSwap = new Set();
    { const s = P(); if (s && s.go) seenGo.add(s.go); if (s && s.sw && s.sw.t) seenSwap.add(s.sw.t); }
    let phase = 'lobby'; // lobby | bomb | manual
    let B = null; // the bomb round (bomb side)
    let M = null; // the mirrored round (manual side)

    el.innerHTML = '<div class="g-defuse"></div>';
    const root = el.firstElementChild;
    const $ = (s) => root.querySelector(s);
    const $$ = (s) => [...root.querySelectorAll(s)];

    function pub() {
      const o = { v: 1, role: L.role, diff: L.diff, dv: L.dv, dw: L.dw, go: L.go, sw: L.sw, ph: phase === 'bomb' ? (B.over ? 'over' : 'play') : phase === 'manual' ? 'reading' : 'lobby' };
      if (phase === 'bomb') Object.assign(o, { n: B.n, rd: B.diff, left: Math.round(B.left), rate: rate(), st: B.strikes, sv: B.solved.join(''), pz: B.pz ? 1 : 0, res: B.res, win: B.win ? 1 : 0 });
      if (phase === 'manual') o.n = M.n;
      api.setPresence(o);
    }
    const rate = () => 1 + RATE_STEP * (B ? B.strikes : 0);
    function adoptDiff(s) {
      if (!s || !DIFFS[s.diff] || !Number.isFinite(s.dv)) return false;
      if (s.dv > L.dv || (s.dv === L.dv && String(s.dw) > String(L.dw))) { L.diff = s.diff; L.dv = s.dv; L.dw = s.dw; memo.diff = s.diff; return true; }
      return false;
    }

    // ── lobby ───────────────────────────────────────────────────────────
    function renderLobby() {
      root.className = 'g-defuse is-lobby';
      root.innerHTML = `<section class="dx-lobby">
        <header>
          <p class="dx-tag">Briefing</p>
          <h2 class="dx-h">Who’s holding what?</h2>
          <p class="dx-lead">One of you gets the bomb, the other gets the field guide. Only the manual knows the rules, so talk it through out loud.</p>
        </header>
        <div class="dx-roles" role="group" aria-label="Pick your role">
          <button type="button" class="dx-role" data-role="bomb" aria-pressed="false">${ICON_BOMB}<span class="dx-role-name">Bomb</span><span class="dx-role-desc">Sees the device. Describes it, cuts and presses.</span><span class="dx-role-who"></span></button>
          <button type="button" class="dx-role" data-role="manual" aria-pressed="false">${ICON_BOOK}<span class="dx-role-name">Manual</span><span class="dx-role-desc">Reads the field guide and calls the moves.</span><span class="dx-role-who"></span></button>
        </div>
        <p class="dx-hint"><i aria-hidden="true"></i>Bomb works best on a computer, Manual on a phone.</p>
        <div class="dx-diff" role="radiogroup" aria-label="Difficulty">${Object.entries(DIFFS).map(([k, d]) => `<button type="button" role="radio" aria-checked="false" data-diff="${k}"><b>${d.label}</b><span>${fmt(d.secs * 1000)}</span></button>`).join('')}</div>
        <p class="dx-lobby-status" aria-live="polite"></p>
        <div class="dx-lobby-actions"><button type="button" class="gm-btn gm-btn-ghost" data-act="swap">Swap roles</button><button type="button" class="gm-btn" data-act="start">Start</button></div>
      </section>`;
      updateLobby();
    }
    function updateLobby() {
      if (phase !== 'lobby') return;
      const s = P();
      const theirs = s ? s.role || null : null;
      const here = api.partnerHere;
      for (const b of $$('.dx-role')) {
        const r = b.dataset.role;
        b.classList.toggle('is-mine', L.role === r);
        b.classList.toggle('is-clash', L.role === r && theirs === r);
        b.setAttribute('aria-pressed', String(L.role === r));
        const who = [];
        if (L.role === r) who.push(me);
        if (here && theirs === r) who.push(them);
        b.querySelector('.dx-role-who').innerHTML = who.sort().map((w) => `<span class="dx-who p-${w}">${esc(w === me ? 'You' : api.name(w))}</span>`).join('');
      }
      for (const b of $$('.dx-diff button')) b.setAttribute('aria-checked', String(b.dataset.diff === L.diff));
      const ready = L.role && theirs && L.role !== theirs && here;
      const st = $('.dx-lobby-status');
      st.textContent = !here ? `Waiting for ${api.name(them)}…`
        : !L.role ? 'Pick a role.'
          : !theirs ? `Waiting for ${api.name(them)} to pick.`
            : L.role === theirs ? `You both picked ${cap(L.role)}. One of you switch.`
              : L.go ? 'Starting…' : `Ready. ${L.role === 'bomb' ? 'You have the bomb.' : 'You have the manual.'}`;
      $('[data-act="start"]').disabled = !ready;
      $('[data-act="swap"]').disabled = !ready;
      api.setStatus(ready ? 'Roles set' : 'Pick your roles');
    }
    function lobbyClick(e) {
      const role = e.target.closest('.dx-role');
      if (role) { L.role = role.dataset.role; memo.role = L.role; L.go = null; api.sfx('tap'); pub(); updateLobby(); return; }
      const d = e.target.closest('[data-diff]');
      if (d) {
        const s = P();
        L.dv = Math.max(L.dv, (s && s.dv) || 0) + 1; L.dw = me; L.diff = d.dataset.diff; memo.diff = L.diff;
        api.sfx('tap'); pub(); updateLobby(); return;
      }
      const act = e.target.closest('[data-act]');
      if (!act || act.disabled) return;
      const s = P();
      const theirs = s && s.role;
      if (act.dataset.act === 'swap' && L.role && theirs && L.role !== theirs) {
        // the swap rides in the event and in presence, so a dropped event still lands
        const next = { t: token(), [me]: theirs, [them]: L.role };
        L.sw = next;
        api.send('swap', next);
        L.role = theirs; memo.role = L.role; L.go = null;
        api.sfx('flip'); pub(); updateLobby();
      } else if (act.dataset.act === 'start' && L.role && theirs && L.role !== theirs) {
        if (L.role === 'bomb') begin();
        else { L.go = token(); api.send('go', { g: L.go }); pub(); updateLobby(); }
      }
    }
    function maybeGo(g) {
      if (phase !== 'lobby' || !g || seenGo.has(g)) return;
      const s = P();
      if (L.role === 'bomb' && s && s.role === 'manual') { seenGo.add(g); begin(); }
    }

    // ── the bomb side ─────────────────────────────────────────────────────
    function begin() {
      const seed = token();
      const gen = genBomb(seed, L.diff);
      B = {
        n: token(), seed, diff: L.diff, gen, left: DIFFS[L.diff].secs * 1000, strikes: 0, solved: [0, 0, 0, 0],
        cut: gen.wires.map(() => false), keyAt: 0, seqStage: 0, seqIn: 0, seqLast: 0, flashT0: 0, lit: null,
        btn: null, pz: !api.partnerHere, over: false, win: false, res: null, shownSecs: -1,
      };
      phase = 'bomb';
      renderBomb();
      api.sfx('place');
      api.setStatus('You have the bomb');
      pub();
    }
    const batterySVG = '<svg viewBox="0 0 40 20" aria-hidden="true"><rect class="b-body" x="1.5" y="2" width="33" height="16" rx="3"/><rect class="b-band" x="23" y="3" width="6" height="14"/><rect class="b-nub" x="35" y="6.5" width="3.5" height="7" rx="1"/></svg>';
    function wiresSVG(g) {
      const n = g.wires.length;
      const gap = n <= 4 ? 32 : 26;
      const top = 85 - ((n - 1) / 2) * gap;
      const ys = g.wires.map((_, i) => top + i * gap);
      const wire = (c, i) => {
        const y = ys[i];
        const sag = (i % 2 ? -1 : 1) * (8 + (i % 3) * 3);
        const full = `M38 ${y} Q120 ${y + sag} 202 ${y}`;
        const m = y + sag / 2;
        const left = `M38 ${y} Q79 ${y + sag / 2} 114 ${m + 1}`;
        const right = `M126 ${m - 1} Q161 ${y + sag / 2} 202 ${y}`;
        return `<g class="dx-wire" data-wire="${i}" data-color="${c}" style="--w: var(--dx-${c})" role="button" tabindex="0" aria-label="Wire ${i + 1} of ${n}, ${c}">
          <path class="hit" d="${full}"/>
          <g class="whole"><path class="o" d="${full}"/><path class="c" d="${full}"/><path class="s" d="${full}"/></g>
          <g class="cut"><g transform="translate(-4 3)"><path class="o" d="${left}"/><path class="c" d="${left}"/><circle class="tip" cx="114" cy="${m + 1}" r="2.6"/></g><g transform="translate(4 4)"><path class="o" d="${right}"/><path class="c" d="${right}"/><circle class="tip" cx="126" cy="${m - 1}" r="2.6"/></g></g>
          <circle class="dx-stud" cx="34" cy="${y}" r="4.5"/><circle class="dx-stud" cx="206" cy="${y}" r="4.5"/>
        </g>`;
      };
      return `<svg class="dx-wires" viewBox="0 0 240 170" role="group" aria-label="Wires">
        <rect class="dx-term" x="16" y="${ys[0] - 16}" width="22" height="${ys[n - 1] - ys[0] + 32}" rx="5"/>
        <rect class="dx-term" x="202" y="${ys[0] - 16}" width="22" height="${ys[n - 1] - ys[0] + 32}" rx="5"/>
        ${g.wires.map(wire).join('')}
      </svg>`;
    }
    function modHTML(id, i, body) {
      return `<section class="dx-mod" data-mod="${id}" aria-label="${MOD_NAME[id]}"><header class="dx-mod-head"><span class="dx-mod-tag">${i + 1} · ${MOD_NAME[id]}</span><i class="dx-led" aria-hidden="true"></i></header><div class="dx-mod-body">${body}</div></section>`;
    }
    function renderBomb() {
      const g = B.gen;
      root.className = 'g-defuse is-bomb';
      root.innerHTML = `<div class="dx-bomb" aria-label="The bomb">
        <i class="dx-screw"></i><i class="dx-screw"></i><i class="dx-screw"></i><i class="dx-screw"></i>
        <aside class="dx-side">
          <div class="dx-lcd"><span class="dx-tag">Time left</span><span class="dx-time" role="timer">${fmt(B.left)}</span></div>
          <div class="dx-strikes" aria-label="Strikes: 0 of 3"><i></i><i></i><i></i></div>
          <div class="dx-sticker"><span class="dx-tag">Serial no.</span><span class="dx-serial">${g.serial}</span></div>
          <div class="dx-bay"><span class="dx-tag">Batteries</span><div class="dx-bats" aria-label="${g.batteries} batteries">${g.batteries ? batterySVG.repeat(g.batteries) : '<span class="dx-none">Empty bay</span>'}</div></div>
          <div class="dx-bay"><span class="dx-tag">Indicators</span><div class="dx-inds">${g.indicators.map((x) => `<span class="dx-ind${x.lit ? ' is-lit' : ''}" aria-label="${x.label}, ${x.lit ? 'lit' : 'unlit'}"><i></i>${x.label}</span>`).join('')}</div></div>
        </aside>
        <div class="dx-mods">
          ${modHTML('wires', 0, wiresSVG(g))}
          ${modHTML('button', 1, `<div class="dx-btnwrap"><button type="button" class="dx-big" style="--bc: var(--dx-${g.button.color})" data-color="${g.button.color}" aria-label="Big ${g.button.color} button labelled ${g.button.label}"><span>${g.button.label}</span></button><div class="dx-strip" aria-label="Light strip"><i></i></div></div>`)}
          ${modHTML('keypad', 2, `<div class="dx-keys">${g.keypad.map((k) => `<button type="button" class="dx-gkey" data-glyph="${k}" aria-label="Key with a ${k} symbol"><i class="dx-kled"></i>${glyph(k)}</button>`).join('')}</div>`)}
          ${modHTML('sequence', 3, `<div class="dx-seqwrap"><div class="dx-seq">${PAD_COLORS.map((c) => `<button type="button" class="dx-pad" data-color="${c}" style="--pc: var(--dx-${c})" aria-label="${cap(c)} pad"><span>${c[0].toUpperCase()}</span></button>`).join('')}</div><div class="dx-stage" aria-label="Sequence progress"></div></div>`)}
        </div>
      </div><div class="dx-fx"></div>`;
      updateBomb();
    }
    function updateBomb() {
      if (!B) return;
      $$('.dx-strikes i').forEach((x, i) => x.classList.toggle('on', i < B.strikes));
      const sk = $('.dx-strikes');
      if (sk) sk.setAttribute('aria-label', `Strikes: ${B.strikes} of 3`);
      MODS.forEach((m, i) => { const x = $(`.dx-mod[data-mod="${m}"]`); if (x) x.classList.toggle('is-solved', !!B.solved[i]); });
      $$('.dx-wire').forEach((w) => w.classList.toggle('is-cut', B.cut[+w.dataset.wire]));
      const done = B.solved[2] ? 4 : B.keyAt;
      B.gen.answers.keypad.forEach((k, i) => { const b = $(`.dx-gkey[data-glyph="${k}"]`); if (b) b.classList.toggle('is-ok', i < done); });
      const stage = $('.dx-stage');
      if (stage) stage.innerHTML = B.gen.seq.map((_, i) => `<i class="${i < B.seqStage || B.solved[3] ? 'on' : i === B.seqStage ? 'now' : ''}"></i>`).join('');
    }
    function bad(mod) {
      const x = $(`.dx-mod[data-mod="${mod}"]`);
      if (x) { x.classList.remove('is-bad'); void x.offsetWidth; x.classList.add('is-bad'); later(() => x.classList.remove('is-bad'), 700); }
    }
    function strike(mod) {
      if (B.over) return;
      B.strikes++;
      api.sfx('bad'); api.haptic(90);
      bad(mod);
      updateBomb();
      pub();
      if (B.strikes >= 3) lose('strikes');
    }
    function solve(mod) {
      const i = MODS.indexOf(mod);
      if (B.solved[i]) return;
      B.solved[i] = 1;
      api.sfx('good'); api.haptic(20);
      updateBomb();
      pub();
      if (B.solved.every(Boolean)) win();
    }
    const busy = (mod) => !B || B.over || B.pz || B.solved[MODS.indexOf(mod)];
    function cutWire(i) {
      if (busy('wires') || B.cut[i]) return;
      B.cut[i] = true;
      api.sfx('flip');
      updateBomb();
      if (i === B.gen.answers.wire) solve('wires'); else strike('wires');
    }
    function pressKey(gl) {
      if (busy('keypad')) return;
      const want = B.gen.answers.keypad[B.keyAt];
      const b = $(`.dx-gkey[data-glyph="${gl}"]`);
      if (B.gen.answers.keypad.indexOf(gl) < B.keyAt) return; // already lit
      if (gl === want) {
        B.keyAt++;
        api.sfx('place');
        updateBomb();
        if (B.keyAt >= 4) solve('keypad');
      } else {
        if (b) { b.classList.add('is-no'); later(() => b.classList.remove('is-no'), 600); }
        strike('keypad');
      }
    }
    function pressPad(c) {
      if (busy('sequence')) return;
      const now = performance.now();
      B.seqLast = now;
      B.flashT0 = 0;
      lightPad(c, 260);
      const K = ctxOf(B.gen);
      const want = SEQ_MAP[K.vowel ? 'v' : 'n'][Math.min(2, B.strikes)][B.gen.seq[B.seqIn]];
      if (c !== want) { B.seqIn = 0; strike('sequence'); return; }
      api.sfx('tap');
      B.seqIn++;
      if (B.seqIn > B.seqStage) {
        B.seqIn = 0;
        B.seqStage++;
        B.seqLast = now - 1400; // replay the longer sequence soon
        if (B.seqStage >= B.gen.seq.length) solve('sequence'); else updateBomb();
      }
    }
    let padTimer = 0;
    function lightPad(c, ms) {
      $$('.dx-pad').forEach((p) => p.classList.toggle('is-lit', p.dataset.color === c));
      clearTimeout(padTimer);
      timers.delete(padTimer);
      if (ms) padTimer = later(() => { $$('.dx-pad').forEach((p) => p.classList.remove('is-lit')); }, ms);
    }
    function btnDown() {
      if (busy('button') || B.btn) return;
      B.btn = { at: performance.now(), lit: false };
      $('.dx-big').classList.add('is-down');
      api.sfx('tap');
    }
    function btnUp(cancel) {
      if (!B || !B.btn) return;
      const held = performance.now() - B.btn.at >= HOLD_MS;
      B.btn = null;
      $('.dx-big').classList.remove('is-down');
      $('.dx-strip').classList.remove('is-on');
      if (cancel || B.over || B.pz) return;
      const ans = B.gen.answers.button;
      const digit = Math.max(0, Math.ceil(B.left / 1000)) % 10;
      const ok = held ? ans.act === 'hold' && digit === ans.digit : ans.act === 'tap';
      if (ok) solve('button'); else strike('button');
    }
    function finale(kind, res) {
      const fx = $('.dx-fx');
      if (!fx) return;
      if (kind === 'win') {
        fx.innerHTML = `<div class="dx-stamp" role="status"><b>DEFUSED</b><span>${esc(res && res.text ? res.text.replace(/^Defused /, '') : '')}</span></div>`;
      } else {
        root.classList.add('is-boom');
        const pts = (R, r, n, ox = 0, oy = 0) => Array.from({ length: n * 2 }, (_, i) => { const a = (i * Math.PI) / n - Math.PI / 2; const k = i % 2 ? r : R * (0.82 + 0.18 * ((i * 7) % 5) / 4); return `${(50 + ox + Math.cos(a) * k).toFixed(1)},${(50 + oy + Math.sin(a) * k * 0.86).toFixed(1)}`; }).join(' ');
        fx.innerHTML = `<div class="dx-boom" role="status"><svg viewBox="0 0 100 100" aria-hidden="true"><polygon class="b0" points="${pts(50, 28, 13, 3, 3)}"/><polygon class="b1" points="${pts(50, 28, 13)}"/><polygon class="b2" points="${pts(32, 19, 11)}"/></svg><b>BOOM</b></div>`;
      }
    }
    function endRound(win, res) {
      B.over = true; B.win = win; B.res = res; B.btn = null;
      ENDED.add(B.n);
      api.sfx(win ? 'win' : 'hit'); api.haptic(win ? 30 : 220);
      finale(win ? 'win' : 'boom', res);
      pub();
      if (!api.isHost) api.send('result', { n: B.n, res, win });
      later(() => api.finish(res), FINALE_MS);
    }
    function win() {
      const secs = Math.max(0, Math.ceil(B.left / 1000));
      const t = fmt(B.left);
      const sub = B.strikes === 0 && secs > DIFFS[B.diff].secs / 2 ? 'Not a single strike. Suspiciously smooth.'
        : B.strikes === 0 ? 'Clean hands, zero strikes.'
          : secs < 30 ? 'Cut it close. Very close.'
            : B.strikes === 2 ? 'Two strikes and a lot of nerve.' : 'One strike, no regrets.';
      endRound(true, { team: true, score: secs, text: `Defused with ${t} left`, sub: `${sub} (${DIFFS[B.diff].label})` });
    }
    function lose(why) {
      endRound(false, { team: true, text: 'Boom.', sub: why === 'time' ? 'The clock hit zero mid-sentence.' : 'Three strikes. The bomb had opinions.' });
    }
    function bombFrame(now, dt) {
      if (!B.over && !B.pz) {
        B.left -= dt * rate();
        if (B.left <= 0) { B.left = 0; lose('time'); }
      }
      const secs = Math.max(0, Math.ceil(B.left / 1000));
      if (secs !== B.shownSecs) {
        B.shownSecs = secs;
        const t = $('.dx-time');
        if (t) t.textContent = fmt(B.left);
        $('.dx-bomb').classList.toggle('is-hurry', secs <= 30);
        if (!B.over && !B.pz && secs <= 30 && secs > 0) api.sfx('tick');
        pub();
      }
      if (B.btn && !B.btn.lit && now - B.btn.at >= HOLD_MS) {
        B.btn.lit = true;
        const s = $('.dx-strip');
        s.style.setProperty('--sc', `var(--dx-${B.gen.button.strip})`);
        s.classList.add('is-on');
        s.setAttribute('aria-label', `Light strip: ${B.gen.button.strip}`);
      }
      // the colour sequence replays itself whenever nobody has pressed a pad for a moment
      if (!B.solved[3] && !B.over && !B.pz && now - B.seqLast > 2600) {
        if (!B.flashT0) B.flashT0 = now + 250;
        const per = 640;
        const len = (B.seqStage + 1) * per + 1500;
        const t = now - B.flashT0;
        let lit = null;
        if (t >= 0) { const k = t % len; const i = Math.floor(k / per); if (i <= B.seqStage && k % per < 400) lit = B.gen.seq[i]; }
        if (lit !== B.lit) { B.lit = lit; lightPad(lit, 0); if (lit) api.sfx('tick'); }
      } else if (B.lit && !B.over) { B.lit = null; }
    }
    function bombClick(e) {
      const w = e.target.closest('.dx-wire');
      if (w) { cutWire(+w.dataset.wire); return; }
      const k = e.target.closest('.dx-gkey');
      if (k) { pressKey(k.dataset.glyph); return; }
      const p = e.target.closest('.dx-pad');
      if (p && e.detail === 0) pressPad(p.dataset.color);
    }
    function bombDown(e) {
      const p = e.target.closest('.dx-pad');
      if (p && phase === 'bomb') { e.preventDefault(); pressPad(p.dataset.color); return; }
      const b = e.target.closest('.dx-big');
      if (b && phase === 'bomb') { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ } btnDown(); }
    }
    function bombUp() { if (B && B.btn) btnUp(false); }
    function bombCancel() { if (B && B.btn) btnUp(true); }
    function bombKey(e) {
      if (phase !== 'bomb') return;
      const isAct = e.key === 'Enter' || e.key === ' ';
      if (!isAct) return;
      const w = e.target.closest && e.target.closest('.dx-wire');
      if (w && e.type === 'keydown') { e.preventDefault(); cutWire(+w.dataset.wire); return; }
      const b = e.target.closest && e.target.closest('.dx-big');
      if (b) { e.preventDefault(); if (e.type === 'keydown' && !e.repeat) btnDown(); else if (e.type === 'keyup') btnUp(false); }
    }

    // ── the manual side ───────────────────────────────────────────────────
    const swatch = (c) => `<span class="dx-sw" style="--sw: var(--dx-${c})"></span>${cap(c)}`;
    function manualHTML() {
      const ruleList = (list, pre) => `<ol class="dx-rules">${list.map((r, i) => `<li data-rule="${pre}${i + 1}"><span>${esc(r[0])}</span></li>`).join('')}</ol>`;
      const word = { 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' };
      const seqTable = (v) => `<table data-table="${v}"><thead><tr><th scope="col">Flash</th>${[0, 1, 2].map((st) => `<th scope="col" data-st="${st}">${st} strike${st === 1 ? '' : 's'}</th>`).join('')}</tr></thead><tbody>${PAD_COLORS.map((c) => `<tr><th scope="row">${swatch(c)}</th>${[0, 1, 2].map((st) => `<td data-v="${v}" data-from="${c}" data-st="${st}" data-to="${SEQ_MAP[v][st][c]}">${swatch(SEQ_MAP[v][st][c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      const page = (id, n, title, body, p) => `<section class="dx-sec" data-page="${id}"><div class="dx-run"><span>Defusal field guide</span><span>${id === 'basics' ? 'Start here' : 'Module ' + n}</span></div><h3><span class="n">${n}</span>${title}</h3>${body}<p class="dx-foot"><span>Read every rule in order. Stop at the first that applies.</span><span>p. ${p}</span></p></section>`;
      const pages = [
        page('basics', '0', 'Reading the bomb', `
          <p class="dx-intro">You can’t see the bomb. Ask your partner what’s on it, find the rule here, and tell them what to do.</p>
          <h4>On the case</h4>
          <ol class="dx-rules">
            <li><span>The <b>serial number</b> is on the sticker. Its last character is always a digit.</span></li>
            <li><span>The <b>battery bay</b> holds zero to four batteries. Count every one.</span></li>
            <li><span><b>Indicators</b> are small lamps with a three-letter label. An indicator counts as lit only when its lamp is on.</span></li>
            <li><span>Every module has a light in its corner. It turns green when that module is done.</span></li>
          </ol>
          <h4>Strikes</h4>
          <p>A wrong cut or press is a strike. Each strike makes the clock run faster. The third strike sets the bomb off.</p>
          <p class="dx-note">The four modules can be done in any order. All four done: the bomb is safe.</p>`, 1),
        page('wires', '1', 'Wires', `
          <p class="dx-intro">Count the wires from the top. Find the list for that many wires, read it from the top, and follow the first rule that applies. Cut exactly one wire.</p>
          ${[3, 4, 5, 6].map((n) => `<h4>${word[n]} wires</h4>${ruleList(WIRE_RULES[n], `w${n}-`)}`).join('')}`, 2),
        page('button', '2', 'The big button', `
          <p class="dx-intro">First decide: tap it or hold it? Follow the first rule that applies.</p>
          ${ruleList(BUTTON_RULES, 'b-')}
          <h4>Tapping</h4>
          <p>Press it and let go straight away. That’s it.</p>
          <h4>Holding</h4>
          <p>Press it and keep holding. A light strip beside the button switches on. Let go when the <b>last digit of the timer</b> matches the strip:</p>
          <table data-table="strip"><thead><tr><th scope="col">Strip</th><th scope="col">Let go on a</th></tr></thead><tbody>${STRIP_COLORS.map((c) => `<tr><th scope="row">${swatch(c)}</th><td data-strip="${c}" data-digit="${STRIP_DIGIT[c]}"><b>${STRIP_DIGIT[c]}</b></td></tr>`).join('')}</tbody></table>
          <p class="dx-note">Example: with a blue strip, let go at 4:13 or 3:53.</p>`, 3),
        page('keypad', '3', 'Glyph keypad', `
          <p class="dx-intro">The keypad has four keys, each marked with a symbol. Exactly one column below holds all four. Press the keys in the order they appear in that column, from top to bottom.</p>
          <div class="dx-cols">${COLUMNS.map((c, i) => `<div class="dx-col" data-col="${i}"><b>${'ABCDE'[i]}</b>${c.map((g) => `<span data-glyph="${g}">${glyph(g)}</span>`).join('')}</div>`).join('')}</div>
          <p class="dx-note">A wrong key is a strike. Keys you already got right stay lit.</p>`, 4),
        page('sequence', '4', 'Colour sequence', `
          <p class="dx-intro">The four pads flash a sequence. For every flash, press the pad this table gives, in the same order. Each time the whole sequence is right, it grows by one flash. Finish the last one and the module is done.</p>
          <p>Pick the table by whether the serial number contains a vowel (A, E, I, O or U). Use the column for the strikes you have right now; it changes after a strike.</p>
          <h4>Serial has a vowel</h4>${seqTable('v')}
          <h4>No vowel in the serial</h4>${seqTable('n')}`, 5),
      ];
      const tab = (id, n, title) => `<button type="button" role="tab" data-page="${id}" aria-selected="false"><span class="n">${n}</span><span>${title}</span><svg class="ok" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4l8-9"/></svg></button>`;
      return `<div class="dx-manual-wrap">
        <div class="dx-mbar">
          <div class="dx-lcd"><span class="dx-time" role="timer">${fmt(M.left)}</span></div>
          <div class="dx-strikes" aria-label="Strikes: 0 of 3"><span class="dx-tag">Strikes</span><i></i><i></i><i></i></div>
          <div class="dx-lamps">${MODS.map((m, i) => `<span class="dx-lamp" data-mod="${m}"><i></i>${['Wires', 'Button', 'Keypad', 'Sequence'][i]}</span>`).join('')}</div>
        </div>
        <div class="dx-mbody">
          <nav class="dx-index" role="tablist" aria-label="Field guide sections">${tab('basics', '0', 'The basics')}${tab('wires', '1', 'Wires')}${tab('button', '2', 'Button')}${tab('keypad', '3', 'Keypad')}${tab('sequence', '4', 'Sequence')}</nav>
          <article class="dx-page">${pages.join('')}</article>
        </div>
      </div><div class="dx-fx"></div>`;
    }
    function enterManual(s) {
      phase = 'manual';
      M = { n: s.n, left: s.left, rate: s.rate || 1, at: performance.now(), strikes: s.st | 0, solved: String(s.sv || '0000'), pz: !!s.pz, over: false, frozen: false, shown: '' };
      root.className = 'g-defuse is-manual';
      root.innerHTML = manualHTML();
      showPage(memo.page || 'basics');
      api.setStatus('You have the manual');
      api.sfx('place');
      pub();
      manualState(s);
    }
    function showPage(id) {
      memo.page = id;
      $$('.dx-index [data-page]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.page === id)));
      $$('.dx-sec').forEach((x) => { x.hidden = x.dataset.page !== id; });
    }
    function manualState(s) {
      if (!M || !s) return;
      if (s.n !== M.n) return;
      const now = performance.now();
      M.left = s.left; M.rate = s.rate || 1; M.at = now; M.pz = !!s.pz;
      const st = s.st | 0;
      if (st > M.strikes) {
        api.sfx('bad'); api.haptic(90);
        const bar = $('.dx-mbar');
        if (bar) { bar.classList.remove('is-bad'); void bar.offsetWidth; bar.classList.add('is-bad'); }
      }
      M.strikes = st;
      M.solved = String(s.sv || '0000');
      $$('.dx-mbar .dx-strikes i').forEach((x, i) => x.classList.toggle('on', i < st));
      $$('.dx-lamp').forEach((x, i) => x.classList.toggle('on', M.solved[i] === '1'));
      $$('.dx-index [data-page]').forEach((b) => { const i = MODS.indexOf(b.dataset.page); b.classList.toggle('is-done', i >= 0 && M.solved[i] === '1'); });
      $$('[data-st]').forEach((x) => x.classList.toggle('is-now', +x.dataset.st === Math.min(2, st)));
      if (s.ph === 'over' && !M.over) manualOver(s.res, !!s.win);
    }
    function manualOver(res, win) {
      if (!M || M.over) return;
      M.over = true;
      ENDED.add(M.n);
      finale(win ? 'win' : 'boom', res);
      api.sfx(win ? 'win' : 'hit');
      // the host records it; the guest's end card normally arrives from the host, with a fallback
      if (res) later(() => api.finish(res), api.isHost ? FINALE_MS : FINALE_MS + 1500);
    }
    function manualFrame(now) {
      const left = M.over || M.pz || M.frozen ? M.left : M.left - (now - M.at) * M.rate;
      const t = fmt(left);
      if (t !== M.shown) { M.shown = t; const x = $('.dx-time'); if (x) x.textContent = t; }
    }

    // ── wiring ────────────────────────────────────────────────────────────
    root.addEventListener('click', (e) => {
      if (phase === 'lobby') lobbyClick(e);
      else if (phase === 'bomb') bombClick(e);
      else if (phase === 'manual') { const t = e.target.closest('.dx-index [data-page]'); if (t) { showPage(t.dataset.page); api.sfx('flip'); } }
    });
    root.addEventListener('pointerdown', bombDown);
    const up = (e) => bombUp(e);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', bombCancel);
    root.addEventListener('keydown', bombKey);
    root.addEventListener('keyup', bombKey);
    root.addEventListener('contextmenu', (e) => { if (e.target.closest('.dx-big, .dx-pad, .dx-gkey')) e.preventDefault(); });
    offs.push(() => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', bombCancel); });

    offs.push(api.onPartnerState((s) => {
      if (!alive || !s || s.v !== 1) return;
      if (adoptDiff(s) && phase === 'lobby') pub();
      if (phase === 'lobby') {
        if (s.ph === 'play' && s.role === 'bomb' && L.role === 'manual' && s.n && !ENDED.has(s.n)) { enterManual(s); return; }
        if (s.sw) takeSwap(s.sw);
        if (s.go) maybeGo(s.go);
        updateLobby();
      } else if (phase === 'manual') manualState(s);
    }));
    offs.push(api.on('go', (d) => { if (d && d.g) maybeGo(d.g); }));
    function takeSwap(d) {
      if (phase !== 'lobby' || !d || !d.t || seenSwap.has(d.t) || (d[me] !== 'bomb' && d[me] !== 'manual')) return;
      seenSwap.add(d.t);
      L.role = d[me]; memo.role = L.role; L.go = null; api.sfx('flip'); pub(); updateLobby();
    }
    offs.push(api.on('swap', takeSwap));
    offs.push(api.on('result', (d) => { if (phase === 'manual' && d && d.n === M.n) manualOver(d.res, !!d.win); }));
    offs.push(api.onPartnerHere((here) => {
      if (phase === 'bomb' && B && !B.over) { B.pz = !here; if (!here) bombCancel(); pub(); }
      if (phase === 'manual' && M) { if (!here) { M.left = M.left - (performance.now() - M.at) * M.rate; M.at = performance.now(); } M.frozen = !here; }
      if (phase === 'lobby') updateLobby();
    }));

    let last = 0;
    function frame(now) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(250, now - (last || now));
      last = now;
      if (phase === 'bomb' && B) bombFrame(now, dt);
      else if (phase === 'manual' && M) manualFrame(now);
    }

    renderLobby();
    pub();
    { const s = P(); if (s) { adoptDiff(s); if (s.ph === 'play' && s.role === 'bomb' && L.role === 'manual' && s.n && !ENDED.has(s.n)) enterManual(s); else updateLobby(); } }
    raf = requestAnimationFrame(frame);

    // test hook (automation only)
    const hook = {
      info: () => ({
        phase, role: L.role, partnerRole: (P() || {}).role || null, diff: L.diff,
        bomb: B && { n: B.n, seed: B.seed, diff: B.diff, left: B.left, strikes: B.strikes, solved: [...B.solved], over: B.over, win: B.win, res: B.res, gen: B.gen, cut: [...B.cut], keyAt: B.keyAt, seqStage: B.seqStage, seqIn: B.seqIn, pz: B.pz },
        manual: M && { n: M.n, strikes: M.strikes, solved: M.solved, over: M.over, shown: M.shown },
      }),
      gen: (seed, diff) => genBomb(seed, diff || 'normal'),
    };
    if (navigator.webdriver) window.__defuse = hook;

    return {
      destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        timers.forEach((t) => clearTimeout(t));
        timers.clear();
        offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
        if (window.__defuse === hook) delete window.__defuse;
      },
    };
  },
});
