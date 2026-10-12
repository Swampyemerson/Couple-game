// Defuse: the four classic modules (wires, big button, glyph keypad, colour sequence) as plugins.
//
// Every module has two editions of its rules, picked by the tier object T:
//   T.id === 'classic'  the fixed rules the game always shipped with (the field guide text is word for word the same)
//   any other tier      rules drawn from templates for this one round, so memorising last week's manual is no help
//
// Rules are stored as data { t: text, c: condition, a: action }. The text is what the manual prints; the condition
// and action are small strings the bomb judges with and the manual page also prints as data-* attributes, so a test
// can solve a bomb from the page alone:
//   conditions (joined with "," = and): true | count:COLOR:0|1|2+ | firstis:C | lastis:C | more:C:D | same
//     | even | odd | vowel | novowel | lit:LABEL | unlit:LABEL | bat:0 | bat:N+ | port:P | noport:P | color:C | label:L
//   wire actions:   nth:K (1 based) | first:C | last:C | end          button actions: tap | hold
// Pure: no DOM at import time, no imports besides ./util.js, no randomness except the seeded r passed in.
import { int, pick, shuffle, sample, cap, esc, cnt, ORD, NUM, swatch, ctxOf, rngOf } from './util.js';

const WIRE_COLORS = ['red', 'blue', 'yellow', 'white', 'black'];
const BTN_COLORS = ['red', 'blue', 'yellow', 'white'];
const STRIP_COLORS = ['blue', 'white', 'yellow', 'red'];
const PAD_COLORS = ['red', 'blue', 'green', 'yellow'];
const IND_POOL = ['RDY', 'PWR', 'AUX', 'LNK', 'SYS', 'CLR', 'IGN', 'MSA'];
const PORT_POOL = ['DVI', 'PS2', 'RJ45', 'SERIAL'];
const HOLD_MS = 450;
const ALL_TIERS = ['classic', 'chill', 'normal', 'spicy', 'wild'];
const clone = (x) => JSON.parse(JSON.stringify(x));
/** "an RJ45", "a DVI": the article for a port label as it is said aloud (only RJ45 starts with a vowel sound). */
const an = (word) => `${/^(RJ|[AEIOU])/.test(word) ? 'an' : 'a'} ${word}`;
/** "B", "B and C", "B, C and D" */
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const lv = (T) => Math.max(1, Math.min(4, (T && T.level) | 0 || 1));

// ── 30 original glyphs (24×24, stroked) ─────────────────────────────────────────
export const GLYPHS = {
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
const GLYPH_IDS = Object.keys(GLYPHS);
/** One glyph as an inline SVG (the .dx-glyph class is styled by the framework). */
export function glyphSVG(id, cls = 'dx-glyph') {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${GLYPHS[id] || ''}"/></svg>`;
}

// ── the rule language: one evaluator for conditions, one phrasing for the manual ────────
/** x = { w: wire colours | null, b: { color, label } | null, K: ctxOf(E), E } */
function atom(a, x) {
  const p = a.split(':');
  const { w, K } = x;
  switch (p[0]) {
    case 'count': { const n = cnt(w, p[1]); return p[2] === '0' ? n === 0 : p[2] === '1' ? n === 1 : n >= 2; }
    case 'firstis': return w[0] === p[1];
    case 'lastis': return w[w.length - 1] === p[1];
    case 'more': return cnt(w, p[1]) > cnt(w, p[2]);
    case 'same': return w[0] === w[w.length - 1];
    case 'even': return K.even;
    case 'odd': return !K.even;
    case 'vowel': return K.vowel;
    case 'novowel': return !K.vowel;
    case 'lit': return K.lit(p[1]);
    case 'unlit': return K.has(p[1]) && !K.lit(p[1]);
    case 'bat': return p[1] === '0' ? K.bat === 0 : K.bat >= parseInt(p[1], 10);
    case 'port': return ((x.E && x.E.ports) || []).includes(p[1]);
    case 'noport': return !((x.E && x.E.ports) || []).includes(p[1]);
    case 'color': return x.b.color === p[1];
    case 'label': return x.b.label === p[1];
    default: return false;
  }
}
const holds = (spec, x) => spec === 'true' || spec.split(',').every((a) => atom(a, x));

function atomText(a) {
  const p = a.split(':');
  switch (p[0]) {
    case 'count': return p[2] === '0' ? `no wire is ${p[1]}` : p[2] === '1' ? `exactly one wire is ${p[1]}` : `two or more wires are ${p[1]}`;
    case 'firstis': return `the first wire is ${p[1]}`;
    case 'lastis': return `the last wire is ${p[1]}`;
    case 'more': return `there are more ${p[1]} wires than ${p[2]} wires`;
    case 'same': return 'the first and last wires are the same colour';
    case 'even': return 'the last digit of the serial number is even';
    case 'odd': return 'the last digit of the serial number is odd';
    case 'vowel': return 'the serial number has a vowel';
    case 'novowel': return 'the serial number has no vowel';
    case 'lit': return `the ${p[1]} indicator is lit`;
    case 'unlit': return `the ${p[1]} indicator is unlit`;
    case 'bat': return p[1] === '0' ? 'the bomb has no batteries' : `the bomb has ${NUM[parseInt(p[1], 10)]} or more batteries`;
    case 'port': return `the bomb has ${an(p[1])} port`;
    case 'noport': return `the bomb has no ${p[1]} port`;
    case 'color': return `the button is ${p[1]}`;
    case 'label': return `the button says ${p[1]}`;
    default: return a;
  }
}
/** "the button is blue and says WAIT": a colour clause followed by a label clause reads as one. */
function condText(spec) {
  const parts = spec.split(',');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith('color:') && parts[i + 1] && parts[i + 1].startsWith('label:')) { out.push(`${atomText(parts[i])} and says ${parts[i + 1].slice(6)}`); i++; } else out.push(atomText(parts[i]));
  }
  return out.join(' and ');
}
const ruleText = (i, last, cond, act) => (last ? `Otherwise, ${act}.` : i === 0 ? `If ${condText(cond)}, ${act}.` : `Otherwise, if ${condText(cond)}, ${act}.`);
function wireActText(a) {
  const p = a.split(':');
  if (p[0] === 'nth') return `cut the ${ORD[+p[1] - 1]} wire`;
  if (p[0] === 'end') return 'cut the last wire';
  return `cut the ${p[0]} ${p[1]} wire`;
}
const btnActText = (a) => `${a} it`;
const wireWord = (a) => (a.startsWith('nth:') ? ORD[+a.slice(4) - 1] : a.startsWith('first:') ? 'first' : 'last');

/** A rule none can reach: an earlier rule's conditions are all among its conditions. */
const shadowed = (rules, spec) => { const mine = spec.split(','); return rules.some((q) => q.c.split(',').every((a) => mine.includes(a))); };

// ── semantic checks: run a rule list over fixed pseudo-random bombs ─────────────────────────
// The syntactic check above only sees "this rule repeats an earlier rule's atoms". It cannot see that "serial is odd" after
// "serial is even" leaves nothing for the rules below to do. So every seeded list is also run over SIM_N fixed bombs (the
// same bombs for every call: a private generator, not the round's stream) and must pass two tests:
//   reachable   each rule is the first to apply on at least MIN_FIRE of them (and so is the closing "Otherwise")
//   not a no-op each rule changes the answer, compared with what the rules below it would have given, on >= MIN_CHANGE
const SIM_N = 400;
const MIN_FIRE = 5;
const MIN_CHANGE = 3;
let simEdge = null;
function simEdges() {
  if (simEdge) return simEdge;
  const r = rngOf('defuse|classic|sim|edge');
  simEdge = Array.from({ length: SIM_N }, () => {
    const vowel = r() < 0.5;
    const pool = shuffle(r, IND_POOL);
    const E = { serial: `${vowel ? 'A' : 'B'}CDFG${int(r, 10)}`, batteries: int(r, 5), indicators: [0, 1].map((i) => ({ label: pool[i], lit: r() < 0.5 })), ports: sample(r, PORT_POOL, int(r, 4)) };
    return { E, K: ctxOf(E) };
  });
  return simEdge;
}
const simCache = new Map();
function simWires(n, pal) {
  const key = `w|${n}|${pal.join()}`;
  if (!simCache.has(key)) { const r = rngOf(`defuse|classic|sim|${key}`); simCache.set(key, simEdges().map(({ E, K }) => ({ w: Array.from({ length: n }, () => pick(r, pal)), K, E }))); }
  return simCache.get(key);
}
function simButtons(colors, labels) {
  const key = `b|${colors.join()}|${labels.join()}`;
  if (!simCache.has(key)) { const r = rngOf(`defuse|classic|sim|${key}`); simCache.set(key, simEdges().map(({ E, K }) => ({ w: null, b: { color: pick(r, colors), label: pick(r, labels) }, K, E }))); }
  return simCache.get(key);
}
/** For each rule: how often it is the first to apply (fire) and how often it gives another answer than the next rule that applies (change). */
function audit(list, xs, ans) {
  const m = list.length;
  const fire = new Array(m).fill(0);
  const change = new Array(m).fill(0);
  for (const x of xs) {
    const i = list.findIndex((q) => holds(q.c, x));
    if (i < 0) continue;
    fire[i]++;
    const j = list.findIndex((q, k) => k > i && holds(q.c, x));
    if (j >= 0 && ans(list[i].a, x) !== ans(list[j].a, x)) change[i]++;
  }
  return { fire, change };
}
/** How many rules of a finished list never fire (or the final one never does) or change nothing. */
function listFaults(list, xs, ans) {
  const { fire, change } = audit(list, xs, ans);
  return list.reduce((n, _, i) => n + (fire[i] < MIN_FIRE || (i < list.length - 1 && change[i] < MIN_CHANGE) ? 1 : 0), 0);
}
/** Would this candidate (appended to the rules so far) be the first to apply often enough? */
const reachable = (list, c, xs) => audit([...list, { c: c.c, a: c.a || 'tap' }], xs, () => 0).fire[list.length] >= MIN_FIRE;

/** Draw one edgework atom. skip = kinds already used in this condition. Level 1 never reads indicators or ports. */
function edgeAtom(r, L, skip = []) {
  const kinds = (L === 1 ? ['par', 'vow', 'bat'] : ['par', 'vow', 'bat', 'ind', 'port']).filter((k) => !skip.includes(k));
  const k = pick(r, kinds);
  if (k === 'par') return { s: r() < 0.5 ? 'even' : 'odd', kind: k };
  if (k === 'vow') return { s: r() < 0.5 ? 'vowel' : 'novowel', kind: k };
  if (k === 'bat') return { s: `bat:${pick(r, [2, 3])}+`, kind: k };
  if (k === 'ind') return { s: `${r() < 0.6 ? 'lit' : 'unlit'}:${pick(r, IND_POOL)}`, kind: k };
  return { s: `${r() < 0.6 ? 'port' : 'noport'}:${pick(r, PORT_POOL)}`, kind: k };
}

// ═══════════════════════════════ WIRES ═══════════════════════════════
const WIRE_CLASSIC = {
  3: [
    ['If the first and last wires are the same colour, cut the second wire.', 'same', 'nth:2'],
    ['Otherwise, if exactly one wire is black, cut the black wire.', 'count:black:1', 'first:black'],
    ['Otherwise, if the last digit of the serial number is even, cut the first wire.', 'even', 'nth:1'],
    ['Otherwise, cut the last wire.', 'true', 'end'],
  ],
  4: [
    ['If there is a lit RDY indicator and two or more wires are yellow, cut the last yellow wire.', 'lit:RDY,count:yellow:2+', 'last:yellow'],
    ['Otherwise, if no wire is blue, cut the third wire.', 'count:blue:0', 'nth:3'],
    ['Otherwise, if exactly one wire is white, cut the first wire.', 'count:white:1', 'nth:1'],
    ['Otherwise, if the last digit of the serial number is odd, cut the second wire.', 'odd', 'nth:2'],
    ['Otherwise, cut the last blue wire.', 'true', 'last:blue'],
  ],
  5: [
    ['If the last wire is black and the last digit of the serial number is odd, cut the fourth wire.', 'lastis:black,odd', 'nth:4'],
    ['Otherwise, if there are more red wires than blue wires, cut the first red wire.', 'more:red:blue', 'first:red'],
    ['Otherwise, if no wire is yellow, cut the second wire.', 'count:yellow:0', 'nth:2'],
    ['Otherwise, if the bomb has three or more batteries, cut the last wire.', 'bat:3+', 'end'],
    ['Otherwise, cut the first wire.', 'true', 'nth:1'],
  ],
  6: [
    ['If no wire is white and the last digit of the serial number is even, cut the third wire.', 'count:white:0,even', 'nth:3'],
    ['Otherwise, if exactly one wire is yellow, cut the yellow wire.', 'count:yellow:1', 'first:yellow'],
    ['Otherwise, if there is a lit PWR indicator, cut the fifth wire.', 'lit:PWR', 'nth:5'],
    ['Otherwise, if no wire is red, cut the last wire.', 'count:red:0', 'end'],
    ['Otherwise, cut the fourth wire.', 'true', 'nth:4'],
  ],
};

/** One wire-count condition. g = colours the condition guarantees are present (so "the first X wire" is always valid). */
function wireCond(r, L, pal) {
  const wireAtom = () => {
    const X = pick(r, pal);
    const k = pick(r, L === 1 ? ['c0', 'c1', 'c2', 'first', 'last'] : ['c0', 'c1', 'c2', 'first', 'last', 'more']);
    if (k === 'c0') return { s: `count:${X}:0`, g: [] };
    if (k === 'c1') return { s: `count:${X}:1`, g: [X] };
    if (k === 'c2') return { s: `count:${X}:2+`, g: [X] };
    if (k === 'first') return { s: `firstis:${X}`, g: [X] };
    if (k === 'last') return { s: `lastis:${X}`, g: [X] };
    return { s: `more:${X}:${pick(r, pal.filter((c) => c !== X))}`, g: [X] };
  };
  if (r() >= [0, 0.25, 0.5, 0.7][L - 1]) return r() < 0.65 ? wireAtom() : { s: edgeAtom(r, L).s, g: [] };
  if (L >= 3 && r() < 0.3) { const e1 = edgeAtom(r, L); return { s: `${e1.s},${edgeAtom(r, L, [e1.kind]).s}`, g: [] }; }
  const w = wireAtom();
  const e = edgeAtom(r, L).s;
  return r() < 0.5 ? { s: `${w.s},${e}`, g: w.g } : { s: `${e},${w.s}`, g: w.g };
}
/** Which wire (0 based) a cut action points at on these colours. */
function wireOf(act, w) {
  const a = act.split(':');
  const wire = a[0] === 'nth' ? +a[1] - 1 : a[0] === 'first' ? w.indexOf(a[1]) : a[0] === 'last' ? w.lastIndexOf(a[1]) : w.length - 1;
  return wire < 0 || wire >= w.length ? w.length - 1 : wire;
}
/** A cut: mostly a position, chosen evenly over the wires; sometimes a colour that the condition guarantees is there. */
function wireAction(r, n, g, pColor) {
  if (g.length && r() < pColor) return `${r() < 0.5 ? 'first' : 'last'}:${pick(r, g)}`;
  const k = 1 + int(r, n);
  return k === n && r() < 0.5 ? 'end' : `nth:${k}`; // "the last wire" and "the fifth wire" are the same cut on a five-wire bomb
}
function drawWireList(r, n, L, pal, xs) {
  const nCond = L === 1 ? 2 + (r() < 0.4 ? 1 : 0) : L === 2 ? 3 : L === 3 ? 3 + (r() < 0.5 ? 1 : 0) : 4;
  const list = [];
  const seen = new Set();
  for (let guard = 0; list.length < nCond && guard < 120; guard++) {
    const c = wireCond(r, L, pal);
    if (seen.has(c.s) || shadowed(list, c.s)) continue;
    seen.add(c.s);
    const a = wireAction(r, n, c.g, 0.4);
    if (!reachable(list, { c: c.s, a }, xs)) continue; // an earlier rule already takes (nearly) every bomb this one would
    list.push({ c: c.s, a });
  }
  return list;
}
function genWireList(r, n, L, pal) {
  const xs = simWires(n, pal);
  const ans = (a, x) => wireOf(a, x.w);
  let best = null;
  let bestFaults = 1e9;
  for (let attempt = 0; attempt < 24 && bestFaults > 0; attempt++) {
    const head = drawWireList(r, n, L, pal, xs);
    for (let t = 0; t < 6; t++) {
      const list = [...head, { c: 'true', a: wireAction(r, n, [], 0) }];
      const faults = listFaults(list, xs, ans);
      if (faults < bestFaults) { best = list; bestFaults = faults; }
      if (!faults) break;
    }
  }
  return best.map((x, i) => ({ ...x, t: ruleText(i, i === best.length - 1, x.c, wireActText(x.a)) }));
}
function solveWires(S, E, R) {
  const K = ctxOf(E);
  const w = S.w;
  const list = R.lists[w.length];
  const x = { w, K, E };
  let rule = list.findIndex((q) => holds(q.c, x));
  if (rule < 0) rule = list.length - 1;
  return { wire: wireOf(list[rule].a, w), rule };
}
/** Wires are 40 units apart with a hit box that runs halfway to each neighbour, so every wire is a 44 px target on a phone. */
const WIRE_GAP = 40;
function wiresSVG(w) {
  const n = w.length;
  const H = Math.max(150, (n - 1) * WIRE_GAP + 64);
  const top = H / 2 - ((n - 1) / 2) * WIRE_GAP;
  const ys = w.map((_, i) => top + i * WIRE_GAP);
  const wire = (c, i) => {
    const y = ys[i];
    const sag = (i % 2 ? -1 : 1) * (8 + (i % 3) * 3);
    const full = `M38 ${y} Q120 ${y + sag} 202 ${y}`;
    const m = y + sag / 2;
    const left = `M38 ${y} Q79 ${y + sag / 2} 114 ${m + 1}`;
    const right = `M126 ${m - 1} Q161 ${y + sag / 2} 202 ${y}`;
    return `<g class="dx-wire" data-wire="${i}" data-color="${c}" style="--w: var(--dx-${c})" role="button" tabindex="0" aria-label="Wire ${i + 1} of ${n}, ${c}">
      <rect class="hb" x="14" y="${y - WIRE_GAP / 2}" width="212" height="${WIRE_GAP}" fill="transparent" stroke="none" pointer-events="all"/>
      <g class="whole"><path class="o" d="${full}"/><path class="c" d="${full}"/><path class="s" d="${full}"/></g>
      <g class="cut"><g transform="translate(-4 3)"><path class="o" d="${left}"/><path class="c" d="${left}"/><circle class="tip" cx="114" cy="${m + 1}" r="2.6"/></g><g transform="translate(4 4)"><path class="o" d="${right}"/><path class="c" d="${right}"/><circle class="tip" cx="126" cy="${m - 1}" r="2.6"/></g></g>
      <circle class="dx-stud" cx="34" cy="${y}" r="4.5"/><circle class="dx-stud" cx="206" cy="${y}" r="4.5"/>
    </g>`;
  };
  return `<svg class="dx-wires" viewBox="0 0 240 ${H}" role="group" aria-label="Wires">
    <rect class="dx-term" x="16" y="${ys[0] - 16}" width="22" height="${ys[n - 1] - ys[0] + 32}" rx="5"/>
    <rect class="dx-term" x="202" y="${ys[0] - 16}" width="22" height="${ys[n - 1] - ys[0] + 32}" rx="5"/>
    ${w.map(wire).join('')}
  </svg>`;
}

export const WIRES = {
  id: 'wires',
  name: 'Wires',
  tab: 'Wires',
  tiers: ALL_TIERS,
  needy: false,
  remote: false,
  css: '',
  rules(r, T) {
    if (T.id === 'classic') {
      const lists = {};
      for (const n of [3, 4, 5, 6]) lists[n] = WIRE_CLASSIC[n].map(([t, c, a]) => ({ t, c, a }));
      return { ed: 'classic', pal: [...WIRE_COLORS], lists };
    }
    const L = lv(T);
    const pal = L >= 3 ? [...WIRE_COLORS, 'green'] : [...WIRE_COLORS];
    const lists = {};
    for (const n of [3, 4, 5, 6]) lists[n] = genWireList(r, n, L, pal);
    return { ed: 'seeded', pal, lists };
  },
  /** Change one rule's cut. The manual prints the original page plus the note; the bomb uses the changed rules. */
  errata(r, R, T) {
    if (R.ed === 'classic') return null;
    const n = 3 + int(r, 4);
    const i = int(r, R.lists[n].length - 1); // a rule people actually reach, not the "otherwise"
    const old = R.lists[n][i].a;
    const p = old.split(':');
    const single = p.length > 1 && R.lists[n][i].c.includes(`count:${p[1]}:1`); // then first and last X are the same wire
    let a;
    if (p[0] === 'nth' || single) { const ks = [1, 2, 3, 4, 5, 6].filter((k) => k <= n && k !== (p[0] === 'nth' ? +p[1] : 0)); a = `nth:${pick(r, ks)}`; } else if (p[0] === 'first') a = `last:${p[1]}`;
    else if (p[0] === 'last') a = `first:${p[1]}`;
    else a = `nth:${1 + int(r, n - 1)}`;
    const R2 = clone(R);
    const q = R2.lists[n][i];
    q.a = a;
    q.t = ruleText(i, i === R2.lists[n].length - 1, q.c, wireActText(a));
    const w = wireWord(a);
    const phrase = a.startsWith('nth:') || a === 'end' ? `cut the <b>${w}</b> wire` : `cut the <b>${w}</b> ${a.split(':')[1]} wire`;
    return { R: R2, note: `Correction to Wires, ${NUM[n]} wires, rule ${i + 1}: ${phrase}, not the ${wireWord(old)}.` };
  },
  page(R) {
    const word = { 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' };
    const list = (n) => `<ol class="dx-rules">${R.lists[n].map((q, i) => `<li data-rule="w${n}-${i + 1}" data-if="${esc(q.c)}" data-cut="${esc(q.a)}"><span>${esc(q.t)}</span></li>`).join('')}</ol>`;
    return `<p class="dx-intro">Count the wires from the top. Find the list for that many wires, read it from the top, and follow the first rule that applies. Cut exactly one wire.</p>
      ${[3, 4, 5, 6].map((n) => `<h4>${word[n]} wires</h4>${list(n)}`).join('')}`;
  },
  gen(r, E, R) {
    let best = null;
    for (let t = 0; t < (R.ed === 'classic' ? 1 : 3); t++) {
      const n = 3 + int(r, 4);
      const w = Array.from({ length: n }, () => pick(r, R.pal));
      best = { w };
      if (solveWires(best, E, R).rule < R.lists[n].length - 1) break; // make the reader work past the first rules
    }
    return best;
  },
  /** -> { wire: index (0 = top), rule: index in that count's list } */
  solve: solveWires,
  mount(box, S, R, host) {
    const A = solveWires(S, host.E, R);
    const cut = new Set((host.saved && host.saved.cut) || []);
    box.innerHTML = wiresSVG(S.w);
    const mark = () => box.querySelectorAll('.dx-wire').forEach((el) => el.classList.toggle('is-cut', cut.has(+el.dataset.wire)));
    mark();
    function cutWire(i) {
      if (host.busy() || cut.has(i)) return;
      cut.add(i);
      mark();
      host.sfx('flip');
      if (i === A.wire) host.solve(); else host.strike('wires');
    }
    return {
      click(e) { const w = e.target.closest && e.target.closest('.dx-wire'); if (w) cutWire(+w.dataset.wire); },
      key(e) {
        if (e.type !== 'keydown' || (e.key !== 'Enter' && e.key !== ' ')) return;
        const w = e.target.closest && e.target.closest('.dx-wire');
        if (w) { e.preventDefault(); cutWire(+w.dataset.wire); }
      },
      save: () => ({ cut: [...cut] }),
    };
  },
  drive(S, E, R) { return [{ sel: `.dx-wire[data-wire="${solveWires(S, E, R).wire}"]`, act: 'click' }]; },
};

// ═══════════════════════════════ BIG BUTTON ═══════════════════════════════
const BTN_CLASSIC = [
  ['If the button is blue and says WAIT, hold it.', 'color:blue,label:WAIT', 'hold'],
  ['Otherwise, if the button says FIRE and the bomb has two or more batteries, tap it.', 'label:FIRE,bat:2+', 'tap'],
  ['Otherwise, if the button is white and there is a lit AUX indicator, hold it.', 'color:white,lit:AUX', 'hold'],
  ['Otherwise, if the button is red and says HALT, tap it.', 'color:red,label:HALT', 'tap'],
  ['Otherwise, if the button is yellow, hold it.', 'color:yellow', 'hold'],
  ['Otherwise, if the bomb has no batteries, hold it.', 'bat:0', 'hold'],
  ['Otherwise, tap it.', 'true', 'tap'],
];
const BTN_LABELS = ['PUSH', 'HALT', 'WAIT', 'FIRE', 'ABORT', 'DETONATE', 'HOLD', 'PRESS'];
const releaseOk = (secs, rel, d) => {
  const s = secs % 60;
  return rel === 'sum' ? Math.floor(s / 10) + (s % 10) === d : rel === 'any' ? Math.floor(s / 10) === d || s % 10 === d : s % 10 === d;
};
function btnRuleTexts(rules) { return rules.map((q, i) => ({ ...q, t: ruleText(i, i === rules.length - 1, q.c, btnActText(q.a)) })); }

function genButtonRules(r, T) {
  const L = lv(T);
  const colors = L >= 3 ? [...BTN_COLORS, 'green'] : [...BTN_COLORS];
  const labels = L >= 3 ? [...BTN_LABELS] : L === 2 ? BTN_LABELS.slice(0, 6) : BTN_LABELS.slice(0, 4);
  const nCond = L === 1 ? 3 : L === 2 ? 4 : L === 3 ? 4 + (r() < 0.5 ? 1 : 0) : 5;
  const kinds = ['color', 'color', 'color', 'label', 'label', 'label', 'edge', 'edge'];
  if (L >= 2) kinds.push('cl', 'ce', 'le');
  // The words HOLD and PRESS on the button are red herrings. For each word this bomb's manual either says what it
  // means (literal) or the opposite (inverted, the usual case), so nobody can learn "HOLD means tap" once and for all.
  const inverted = { HOLD: r() < 0.7, PRESS: r() < 0.7 };
  const herring = { HOLD: inverted.HOLD ? 'tap' : 'hold', PRESS: inverted.PRESS ? 'hold' : 'tap' };
  const xs = simButtons(colors, labels);
  const ans = (a) => a;
  let best = null;
  let bestFaults = 1e9;
  for (let attempt = 0; attempt < 30 && bestFaults > 0; attempt++) {
    const rules = [];
    const seen = new Set();
    for (let guard = 0; rules.length < nCond && guard < 120; guard++) {
      const k = pick(r, kinds);
      const parts = [];
      let label = null;
      if (k === 'color' || k === 'cl' || k === 'ce') parts.push(`color:${pick(r, colors)}`);
      if (k === 'label' || k === 'cl' || k === 'le') { label = pick(r, labels); parts.push(`label:${label}`); }
      if (k === 'edge' || k === 'ce' || k === 'le') parts.push(edgeAtom(r, L).s);
      const c = parts.join(',');
      if (seen.has(c) || shadowed(rules, c)) continue;
      seen.add(c);
      const a = herring[label] || (r() < 0.5 ? 'tap' : 'hold');
      if (!reachable(rules, { c, a }, xs)) continue;
      rules.push({ c, a });
    }
    for (let t = 0; t < 4; t++) {
      const list = [...rules, { c: 'true', a: r() < 0.5 ? 'tap' : 'hold' }];
      if (list.every((q) => q.a === list[0].a)) { const f = list[list.length - 1]; f.a = f.a === 'tap' ? 'hold' : 'tap'; } // both answers must occur; the closing rule names no label, so the herrings stay intact
      const faults = listFaults(list, xs, ans);
      if (faults < bestFaults) { best = list; bestFaults = faults; }
      if (!faults) break;
    }
  }
  return { colors, labels, rules: btnRuleTexts(best) };
}
function solveButton(S, E, R) {
  const x = { w: null, b: S, K: ctxOf(E), E };
  let rule = R.rules.findIndex((q) => holds(q.c, x));
  if (rule < 0) rule = R.rules.length - 1;
  const act = R.rules[rule].a;
  return { act, digit: act === 'hold' ? R.strip[S.strip] : null, rel: R.rel, rule };
}
const stripExamples = (rel, d) => {
  if (rel === 'sum') { const t = Math.floor(d / 2); return [`4:${t}${d - t}`, `2:1${d - 1}`]; }
  if (rel === 'any') return [`4:1${d}`, d <= 5 ? `2:${d}9` : `2:0${d}`];
  return [`4:1${d}`, `3:5${d}`];
};

export const BUTTON = {
  id: 'button',
  name: 'Big Button',
  tab: 'Button',
  tiers: ALL_TIERS,
  needy: false,
  remote: false,
  css: '',
  rules(r, T) {
    if (T.id === 'classic') {
      return { ed: 'classic', colors: [...BTN_COLORS], labels: BTN_LABELS.slice(0, 4), rules: BTN_CLASSIC.map(([t, c, a]) => ({ t, c, a })), strip: { blue: 3, white: 6, yellow: 1, red: 8 }, rel: 'last' };
    }
    const L = lv(T);
    const g = genButtonRules(r, T);
    const digits = sample(r, [1, 2, 3, 4, 5, 6, 7, 8, 9], 4);
    const strip = {};
    STRIP_COLORS.forEach((c, i) => { strip[c] = digits[i]; });
    const rel = L < 3 ? 'last' : L === 3 ? pick(r, ['last', 'sum', 'sum', 'any', 'any']) : pick(r, ['last', 'sum', 'sum', 'sum', 'any', 'any']);
    return { ed: 'seeded', colors: g.colors, labels: g.labels, rules: g.rules, strip, rel };
  },
  errata(r, R) {
    if (R.ed === 'classic') return null;
    const R2 = clone(R);
    if (r() < 0.6) {
      const i = int(r, R2.rules.length);
      const q = R2.rules[i];
      const old = q.a;
      q.a = old === 'tap' ? 'hold' : 'tap';
      q.t = ruleText(i, i === R2.rules.length - 1, q.c, btnActText(q.a));
      return { R: R2, note: `Correction to the Big Button, rule ${i + 1}: <b>${q.a}</b> it, not ${old} it.` };
    }
    const c = pick(r, STRIP_COLORS);
    const used = Object.values(R2.strip);
    const nd = pick(r, [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !used.includes(d)));
    const od = R2.strip[c];
    R2.strip[c] = nd;
    return { R: R2, note: `Correction to the Big Button strip table: ${c} is <b>${nd}</b>, not ${od}.` };
  },
  page(R) {
    const rel = R.rel;
    const how = rel === 'sum' ? 'the <b>two seconds digits of the timer add up</b> to the strip number'
      : rel === 'any' ? '<b>either seconds digit of the timer</b> is the strip number' : 'the <b>last digit of the timer</b> matches the strip';
    const head = rel === 'sum' ? 'Seconds add up to' : rel === 'any' ? 'Either digit is' : 'Let go on a';
    const c0 = STRIP_COLORS[0];
    const [e1, e2] = stripExamples(rel, R.strip[c0]);
    return `<p class="dx-intro">First decide: tap it or hold it? Follow the first rule that applies.</p>
      <ol class="dx-rules">${R.rules.map((q, i) => `<li data-rule="b-${i + 1}" data-if="${esc(q.c)}" data-do="${q.a}"><span>${esc(q.t)}</span></li>`).join('')}</ol>
      <h4>Tapping</h4>
      <p>Press it and let go straight away. That’s it.</p>
      <h4>Holding</h4>
      <p>Press it and keep holding. A light strip beside the button switches on. Let go when ${how}:</p>
      <table data-table="strip" data-rel="${rel}"><thead><tr><th scope="col">Strip</th><th scope="col">${head}</th></tr></thead><tbody>${STRIP_COLORS.map((c) => `<tr><th scope="row">${swatch(c)}</th><td data-strip="${c}" data-digit="${R.strip[c]}"><b>${R.strip[c]}</b></td></tr>`).join('')}</tbody></table>
      <p class="dx-note">Example: with a ${c0} strip, let go at ${e1} or ${e2}.</p>`;
  },
  gen(r, E, R) {
    let S = null;
    for (let t = 0; t < (R.ed === 'classic' ? 1 : 3); t++) {
      S = { color: pick(r, R.colors), label: pick(r, R.labels), strip: pick(r, STRIP_COLORS) };
      if (solveButton(S, E, R).rule < R.rules.length - 1) break;
    }
    return S;
  },
  /** -> { act: 'tap'|'hold', digit: strip number or null, rel: 'last'|'sum'|'any', rule: index } */
  solve: solveButton,
  mount(box, S, R, host) {
    const A = solveButton(S, host.E, R);
    const big = S.label.length > 6 ? ' style="font-size: 0.98rem"' : '';
    box.innerHTML = `<div class="dx-btnwrap"><button type="button" class="dx-big" style="--bc: var(--dx-${S.color})" data-color="${S.color}" aria-label="Big ${S.color} button labelled ${S.label}"><span${big}>${S.label}</span></button><div class="dx-strip" aria-label="Light strip"><i></i></div></div>`;
    const btnEl = box.querySelector('.dx-big');
    const strip = box.querySelector('.dx-strip');
    let held = null; // { at, lit }
    const winUp = () => release(false);
    const winCancel = () => release(true);
    function stop() {
      held = null;
      btnEl.classList.remove('is-down');
      strip.classList.remove('is-on');
      window.removeEventListener('pointerup', winUp);
      window.removeEventListener('pointercancel', winCancel);
    }
    function press() {
      if (host.busy() || held) return;
      held = { at: host.now(), lit: false };
      btnEl.classList.add('is-down');
      host.sfx('tap');
      window.addEventListener('pointerup', winUp);
      window.addEventListener('pointercancel', winCancel);
    }
    function release(cancel) {
      if (!held) return;
      const long = host.now() - held.at >= HOLD_MS;
      stop();
      if (cancel || host.busy()) return;
      const secs = Math.max(0, Math.ceil(host.left() / 1000));
      const ok = long ? A.act === 'hold' && releaseOk(secs, A.rel, A.digit) : A.act === 'tap';
      if (ok) host.solve(); else host.strike('button');
    }
    return {
      down(e) {
        if (e.button > 0 || !(e.target.closest && e.target.closest('.dx-big'))) return;
        if (e.cancelable) e.preventDefault();
        try { if (e.pointerId != null) btnEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        press();
      },
      up(e, cancel) { release(!!cancel); },
      key(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (!(e.target.closest && e.target.closest('.dx-big'))) return;
        e.preventDefault();
        if (e.type === 'keydown') { if (!e.repeat) press(); } else if (e.type === 'keyup') release(false);
      },
      frame(now) {
        if (!held) return;
        if (host.busy()) { stop(); return; }
        if (!held.lit && now - held.at >= HOLD_MS) {
          held.lit = true;
          strip.style.setProperty('--sc', `var(--dx-${S.strip})`);
          strip.classList.add('is-on');
          strip.setAttribute('aria-label', `Light strip: ${S.strip}`);
        }
      },
      destroy() { stop(); },
    };
  },
  /** hold ends with until 'digit:N' (last digit), 'sum:N' (seconds digits add up) or 'any:N' (either seconds digit) */
  drive(S, E, R) {
    const A = solveButton(S, E, R);
    if (A.act === 'tap') return [{ sel: '.dx-big', act: 'tap' }];
    return [{ sel: '.dx-big', act: 'hold', until: `${A.rel === 'last' ? 'digit' : A.rel}:${A.digit}` }];
  },
};

// ═══════════════════════════════ GLYPH KEYPAD ═══════════════════════════════
const KP_CLASSIC = [
  ['spark', 'hook', 'ladder', 'moon', 'crown', 'loop', 'drop'],
  ['eye', 'spark', 'bolt', 'waves', 'hook', 'gate', 'shell'],
  ['anchor', 'comb', 'glass', 'eye', 'key', 'steps', 'flag'],
  ['bow', 'fork', 'sun', 'ladder', 'arch', 'zigzag', 'target'],
  ['leaf', 'tri', 'cross', 'cup', 'peaks', 'spiral', 'comb'],
];
const overlap = (a, b) => a.filter((g) => b.includes(g)).length;
function genColumns(r, nCols) {
  const cols = [];
  for (let k = 0; k < nCols; k++) {
    let col = null;
    for (let guard = 0; guard < 300 && !col; guard++) {
      const share = k && guard < 200 ? 2 + int(r, 3) : 0; // deliberate overlaps: 2-4 glyphs lifted from an earlier column
      const lifted = share ? sample(r, cols[int(r, k)], share) : [];
      const rest = sample(r, GLYPH_IDS.filter((g) => !lifted.includes(g)), 7 - lifted.length);
      const c = shuffle(r, [...lifted, ...rest]);
      if (cols.every((o) => overlap(o, c) <= 4)) col = c;
    }
    cols.push(col || shuffle(r, sample(r, GLYPH_IDS, 7)));
  }
  return cols;
}
function solveKeypad(S, E, R) {
  const idx = R.cols.findIndex((c) => S.keys.every((g) => c.includes(g)));
  const col = R.cols[idx];
  const order = [...S.keys].sort((x, y) => (R.up[idx] ? col.indexOf(y) - col.indexOf(x) : col.indexOf(x) - col.indexOf(y)));
  return { col: idx, order };
}
const quads = (() => { const o = []; for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 7; c++) for (let d = c + 1; d < 7; d++) o.push([a, b, c, d]); return o; })();

export const KEYPAD = {
  id: 'keypad',
  name: 'Glyph Keypad',
  tab: 'Keypad',
  tiers: ALL_TIERS,
  needy: false,
  remote: false,
  css: `
.g-defuse .dx-cols.dx-kp-six { grid-template-columns: repeat(6, minmax(0, 1fr)); max-width: 640px; }
.g-defuse .dx-col b .dx-kp-arr { width: 0.6em; height: 0.78em; margin-left: 3px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; vertical-align: -0.04em; }`,
  rules(r, T) {
    if (T.id === 'classic') return { ed: 'classic', names: 'ABCDE', cols: clone(KP_CLASSIC), up: KP_CLASSIC.map(() => false) };
    const L = lv(T);
    const nCols = L >= 3 ? 6 : L === 2 ? 5 + int(r, 2) : 5;
    const cols = genColumns(r, nCols);
    const up = cols.map(() => false);
    if (L >= 3) for (const i of sample(r, cols.map((_, i) => i), 2 + int(r, 2))) up[i] = true;
    return { ed: 'seeded', names: 'ABCDEF'.slice(0, nCols), cols, up };
  },
  page(R) {
    const ups = R.names.split('').filter((_, i) => R.up[i]);
    const dir = ups.length
      ? ` Read column${ups.length > 1 ? 's' : ''} ${andList(ups)} the other way, from <b>bottom to top</b>; the arrow marks ${ups.length > 1 ? 'them' : 'it'}. All other columns read from top to bottom.`
      : '';
    const arrow = '<svg class="dx-kp-arr" viewBox="0 0 10 12" aria-label="read from the bottom up" role="img"><path d="M5 11V2M1.5 5.5L5 2l3.5 3.5"/></svg>';
    return `<p class="dx-intro">The keypad has four keys, each marked with a symbol. Exactly one column below holds all four. Press the keys in the order they appear in that column, ${ups.length ? 'normally ' : ''}from top to bottom.${dir}</p>
      <div class="dx-cols${R.cols.length > 5 ? ' dx-kp-six' : ''}">${R.cols.map((c, i) => `<div class="dx-col" data-col="${i}" data-dir="${R.up[i] ? 'up' : 'down'}"><b>${R.names[i]}${R.up[i] ? arrow : ''}</b>${c.map((g) => `<span data-glyph="${g}">${glyphSVG(g)}</span>`).join('')}</div>`).join('')}</div>
      <p class="dx-note">A wrong key is a strike. Keys you already got right stay lit.</p>`;
  },
  gen(r, E, R) {
    const n = R.cols.length;
    for (const ci of shuffle(r, R.cols.map((_, i) => i))) {
      const col = R.cols[ci];
      const ok = quads.filter((q) => { const f = q.map((i) => col[i]); return R.cols.every((o, k) => k === ci || !f.every((g) => o.includes(g))); });
      if (!ok.length) continue;
      const four = pick(r, ok).map((i) => col[i]);
      let keys = shuffle(r, four);
      const sol = solveKeypad({ keys }, E, R).order;
      if (keys.every((g, i) => g === sol[i])) keys = [...keys.slice(1), keys[0]];
      return { keys };
    }
    return { keys: R.cols[int(r, n)].slice(0, 4) }; // unreachable with generated columns
  },
  /** -> { col: column index, order: the four glyph ids in the order to press them } */
  solve: solveKeypad,
  mount(box, S, R, host) {
    const A = solveKeypad(S, host.E, R);
    let at = host.saved && Number.isInteger(host.saved.keyAt) ? Math.max(0, Math.min(4, host.saved.keyAt)) : 0;
    let bad = null;
    box.innerHTML = `<div class="dx-keys">${S.keys.map((k) => `<button type="button" class="dx-gkey" data-glyph="${k}" aria-label="Key with a ${k} symbol"><i class="dx-kled"></i>${glyphSVG(k)}</button>`).join('')}</div>`;
    const paint = () => box.querySelectorAll('.dx-gkey').forEach((b) => b.classList.toggle('is-ok', A.order.indexOf(b.dataset.glyph) < at));
    paint();
    function press(gl, btn) {
      if (host.busy()) return;
      if (A.order.indexOf(gl) < at) return; // already lit
      const now = host.now();
      if (gl === A.order[at]) {
        at++;
        host.sfx('place');
        paint();
        if (at >= 4) host.solve();
        return;
      }
      if (bad && bad.k === gl && now - bad.at < 400) return; // one tap, not a double tap
      bad = { k: gl, at: now };
      if (btn) { btn.classList.add('is-no'); host.later(() => btn.classList.remove('is-no'), 600); }
      host.strike('keypad');
    }
    return {
      click(e) { const k = e.target.closest && e.target.closest('.dx-gkey'); if (k) press(k.dataset.glyph, k); },
      save: () => ({ keyAt: at }),
    };
  },
  drive(S, E, R) { return solveKeypad(S, E, R).order.map((g) => ({ sel: `.dx-gkey[data-glyph="${g}"]`, act: 'click' })); },
};

// ═══════════════════════════════ COLOUR SEQUENCE ═══════════════════════════════
const SEQ_CLASSIC = {
  yes: [
    { red: 'green', blue: 'yellow', green: 'red', yellow: 'blue' },
    { red: 'blue', blue: 'green', green: 'yellow', yellow: 'red' },
    { red: 'yellow', blue: 'red', green: 'blue', yellow: 'green' },
  ],
  no: [
    { red: 'yellow', blue: 'blue', green: 'red', yellow: 'green' },
    { red: 'blue', blue: 'yellow', green: 'red', yellow: 'green' },
    { red: 'green', blue: 'yellow', green: 'blue', yellow: 'red' },
  ],
};
function genMaps(r) {
  const maps = [];
  for (let st = 0; st < 3; st++) {
    let p = null;
    for (let g = 0; g < 12; g++) {
      p = shuffle(r, PAD_COLORS);
      const same = p.every((c, i) => c === PAD_COLORS[i]);
      const dup = maps.some((m) => PAD_COLORS.every((c, i) => m[c] === p[i]));
      if (!same && !dup) break;
    }
    const m = {};
    PAD_COLORS.forEach((c, i) => { m[c] = p[i]; });
    maps.push(m);
  }
  return maps;
}
const seqSentence = (cond) => {
  const p = cond.split(':');
  return p[0] === 'vowel' ? 'the serial number contains a vowel (A, E, I, O or U)' : p[0] === 'even' ? 'the last digit of the serial number is even'
    : atomText(cond);
};
const seqTitles = (cond) => {
  const p = cond.split(':');
  if (p[0] === 'vowel') return ['Serial has a vowel', 'No vowel in the serial'];
  if (p[0] === 'even') return ['Last digit of the serial is even', 'Last digit of the serial is odd'];
  if (p[0] === 'lit') return [`The ${p[1]} indicator is lit`, `The ${p[1]} indicator is not lit, or is not on the bomb`];
  const n = parseInt(p[1], 10);
  return [`${cap(NUM[n])} or more batteries`, `Fewer than ${NUM[n]} batteries`];
};
function solveSequence(S, E, R) {
  const maps = holds(R.cond, { w: null, b: null, K: ctxOf(E), E }) ? R.yes : R.no;
  return [0, 1, 2].map((st) => S.seq.map((c) => maps[st][c]));
}

export const SEQUENCE = {
  id: 'sequence',
  name: 'Colour Sequence',
  tab: 'Sequence',
  tiers: ALL_TIERS,
  needy: false,
  remote: false,
  css: '',
  rules(r, T) {
    if (T.id === 'classic') return { ed: 'classic', cond: 'vowel', yes: clone(SEQ_CLASSIC.yes), no: clone(SEQ_CLASSIC.no) };
    const L = lv(T);
    const k = r();
    const cond = L === 1 ? (k < 0.5 ? 'vowel' : 'even') : k < 0.3 ? 'vowel' : k < 0.6 ? 'even' : k < 0.82 ? `bat:${pick(r, [2, 3])}+` : `lit:${pick(r, IND_POOL)}`;
    return { ed: 'seeded', cond, yes: genMaps(r), no: genMaps(r) };
  },
  page(R) {
    const [tYes, tNo] = seqTitles(R.cond);
    const table = (v, maps) => `<table data-table="${v}"><thead><tr><th scope="col">Flash</th>${[0, 1, 2].map((st) => `<th scope="col" data-st="${st}">${st} strike${st === 1 ? '' : 's'}</th>`).join('')}</tr></thead><tbody>${PAD_COLORS.map((c) => `<tr><th scope="row">${swatch(c)}</th>${[0, 1, 2].map((st) => `<td data-v="${v}" data-from="${c}" data-st="${st}" data-to="${maps[st][c]}">${swatch(maps[st][c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    return `<p class="dx-intro">The four pads flash a sequence. For every flash, press the pad this table gives, in the same order. Each time the whole sequence is right, it grows by one flash. Finish the last one and the module is done.</p>
      <p data-cond="${esc(R.cond)}">Pick the table by whether ${seqSentence(R.cond)}. Use the column for the strikes you have right now; it changes after a strike.</p>
      <h4>${tYes}</h4>${table('v', R.yes)}
      <h4>${tNo}</h4>${table('n', R.no)}`;
  },
  gen(r, E, R, T) { return { seq: Array.from({ length: (T && T.stages) || 4 }, () => pick(r, PAD_COLORS)) }; },
  /** -> [sequence for 0 strikes, for 1 strike, for 2+ strikes]: each the list of pad colours to press, one per flash */
  solve: solveSequence,
  mount(box, S, R, host) {
    const maps = holds(R.cond, { w: null, b: null, K: host.K || ctxOf(host.E), E: host.E }) ? R.yes : R.no;
    let stage = host.saved && Number.isInteger(host.saved.stage) ? Math.max(0, Math.min(S.seq.length, host.saved.stage)) : 0;
    let inIdx = 0;
    let last = host.saved ? host.now() : -1e9; // a fresh bomb starts replaying straight away
    let flashT0 = 0;
    let lit = null;
    let bad = null;
    let padGen = 0;
    box.innerHTML = `<div class="dx-seqwrap"><div class="dx-seq">${PAD_COLORS.map((c) => `<button type="button" class="dx-pad" data-color="${c}" style="--pc: var(--dx-${c})" aria-label="${cap(c)} pad"><span>${c[0].toUpperCase()}</span></button>`).join('')}</div><div class="dx-stage" aria-label="Sequence progress"></div></div>`;
    const pads = [...box.querySelectorAll('.dx-pad')];
    const dots = box.querySelector('.dx-stage');
    const paintStage = () => { dots.innerHTML = S.seq.map((_, i) => `<i class="${i < stage ? 'on' : i === stage ? 'now' : ''}"></i>`).join(''); };
    paintStage();
    function lightPad(c, ms) {
      pads.forEach((p) => p.classList.toggle('is-lit', p.dataset.color === c));
      const g = ++padGen;
      if (ms) host.later(() => { if (g === padGen) pads.forEach((p) => p.classList.remove('is-lit')); }, ms);
    }
    function press(c) {
      if (host.busy()) return;
      const now = host.now();
      last = now; flashT0 = 0; lit = null;
      lightPad(c, 260);
      const want = maps[Math.min(2, host.strikes())][S.seq[inIdx]];
      if (c !== want) {
        if (bad && bad.k === c && now - bad.at < 400) return; // a double tap on the same wrong pad is one mistake
        inIdx = 0; bad = { k: c, at: now };
        host.strike('sequence');
        return;
      }
      host.sfx('tap');
      inIdx++;
      if (inIdx > stage) {
        inIdx = 0;
        stage++;
        last = now - 1400; // replay the longer sequence soon
        paintStage();
        if (stage >= S.seq.length) host.solve();
      }
    }
    return {
      down(e) {
        if (e.button > 0) return;
        const p = e.target.closest && e.target.closest('.dx-pad');
        if (p) { if (e.cancelable) e.preventDefault(); press(p.dataset.color); }
      },
      click(e) { const p = e.target.closest && e.target.closest('.dx-pad'); if (p && e.detail === 0) press(p.dataset.color); }, // keyboard; pointers act on down
      frame(now) {
        // the sequence replays itself whenever nobody has pressed a pad for a moment
        if (!host.busy() && now - last > 2600) {
          if (!flashT0) flashT0 = now + 250;
          const per = 640;
          const len = (stage + 1) * per + 1500;
          const t = now - flashT0;
          let f = null;
          if (t >= 0) { const k = t % len; const i = Math.floor(k / per); if (i <= stage && k % per < 400) f = S.seq[i]; }
          if (f !== lit) { lit = f; lightPad(f, 0); if (f) host.sfx('tick'); }
        } else if (lit) { lit = null; lightPad(null, 0); }
      },
      save: () => ({ stage }),
    };
  },
  /** Presses for the strikes on the bomb right now (live.strikes), stage by stage: 1 flash, then 2, ... */
  drive(S, E, R, live) {
    const seq = solveSequence(S, E, R)[Math.min(2, (live && live.strikes) | 0)];
    const out = [];
    for (let k = 0; k < seq.length; k++) for (let j = 0; j <= k; j++) out.push({ sel: `.dx-pad[data-color="${seq[j]}"]`, act: 'tap' });
    return out;
  },
};

export const CLASSIC_FOUR = [WIRES, BUTTON, KEYPAD, SEQUENCE];
