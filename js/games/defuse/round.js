// Defuse: the round. Pure and deterministic: buildRound(seed, tier) gives the bomb device and the manual device the
// identical edgework, module list, rules, puzzles, twists and schedule, so only { seed, tier } ever has to travel.
// Every random draw comes from a named stream (stream(seed, ...keys)), so adding a draw in one place never shifts another.
import { hash, stream, int, pick, shuffle, sample } from './util.js';
import { WIRES, BUTTON, KEYPAD, SEQUENCE } from './classic.js';
import { MAZE } from './maze.js';
import { PASSWORD } from './password.js';
import { MORSE } from './morse.js';
import { SWITCHES } from './switches.js';
import { VENT } from './vent.js';
import { RELAY } from './relay.js';

/** Every module, in the order the manual lists its pages. */
export const REGISTRY = [WIRES, BUTTON, KEYPAD, SEQUENCE, MAZE, PASSWORD, MORSE, SWITCHES, VENT, RELAY].filter(Boolean);
export const BY_ID = Object.fromEntries(REGISTRY.map((p) => [p.id, p]));
export const CLASSIC_IDS = ['wires', 'button', 'keypad', 'sequence'];

// ── tiers ───────────────────────────────────────────────────────────────
export const TIERS = {
  classic: { id: 'classic', label: 'Classic', secs: 300, mods: 4, twists: 0, level: 1, stages: 4, needy: false, blurb: 'The original four modules and the original guide.' },
  chill: { id: 'chill', label: 'Rookie', secs: 360, mods: 3, twists: 0, level: 1, stages: 3, needy: false, blurb: 'Three modules. The rules change every round.' },
  normal: { id: 'normal', label: 'Agent', secs: 300, mods: 4, twists: 1, level: 2, stages: 4, needy: false, blurb: 'Four modules and one twist.' },
  spicy: { id: 'spicy', label: 'Expert', secs: 285, mods: 5, twists: 2, level: 3, stages: 5, needy: true, blurb: 'Five modules, a vent that wants attention, two twists.' },
  wild: { id: 'wild', label: 'Bomb Squad', secs: 270, mods: 6, twists: 3, level: 4, stages: 5, needy: true, blurb: 'Six modules, a vent, three twists. Every strike costs half a minute.' },
};
/** Lobby order. Old saved keys (chill, normal, spicy) keep their meaning. */
export const TIER_ORDER = ['chill', 'normal', 'spicy', 'wild', 'classic'];
export const tierOf = (k) => (Object.prototype.hasOwnProperty.call(TIERS, k) ? TIERS[k] : null);

// ── twists ──────────────────────────────────────────────────────────────
export const TWISTS = {
  decoy: { id: 'decoy', name: 'Twin modules', kind: 'herring' },
  void: { id: 'void', name: 'VOID sticker', kind: 'herring' },
  errata: { id: 'errata', name: 'Correction slip', kind: 'herring' },
  surge: { id: 'surge', name: 'Surge', kind: 'pressure' },
  tax: { id: 'tax', name: 'Strike tax', kind: 'pressure' },
  blackout: { id: 'blackout', name: 'Blackout', kind: 'comms' },
  relay: { id: 'relay', name: 'Role swap', kind: 'swap' },
  vent: { id: 'vent', name: 'Vent', kind: 'pressure' },
};
export const SURGE_SECS = 12;
export const TAX_SECS = 30;
export const BLACKOUT = { warn: 2, dur: 5 };
export const GOLD_BONUS = 20;

export const DECOY_RULES = {
  low: 'Use the module with the <b>lower</b> plate number.',
  high: 'Use the module with the <b>higher</b> plate number.',
  even: 'Use the module whose plate number <b>ends in an even digit</b> (0, 2, 4, 6 or 8).',
  odd: 'Use the module whose plate number <b>ends in an odd digit</b> (1, 3, 5, 7 or 9).',
  share: 'Use the module whose plate number has a <b>digit that also appears in the serial number</b>.',
};
/** Which of two plates is live under a rule: 0 or 1, or -1 when the rule can't tell them apart. */
export function decoyLive(rule, plates, serial) {
  const [a, b] = plates;
  let ta, tb;
  switch (rule) {
    case 'low': return a < b ? 0 : a > b ? 1 : -1;
    case 'high': return a > b ? 0 : a < b ? 1 : -1;
    case 'even': ta = a % 2 === 0; tb = b % 2 === 0; break;
    case 'odd': ta = a % 2 === 1; tb = b % 2 === 1; break;
    case 'share': { const ds = new Set(String(serial).replace(/\D/g, '')); ta = [...String(a)].some((c) => ds.has(c)); tb = [...String(b)].some((c) => ds.has(c)); break; }
    default: return -1;
  }
  return ta === tb ? -1 : ta ? 0 : 1;
}

// ── names ───────────────────────────────────────────────────────────────
const ADJ = ['Nervous', 'Sleepy', 'Grumpy', 'Brave', 'Wobbly', 'Sneaky', 'Cheerful', 'Dramatic', 'Fluffy', 'Jumpy', 'Cosmic', 'Sparkly', 'Mighty', 'Tiny', 'Clumsy', 'Daring', 'Eager', 'Fancy', 'Gentle', 'Hasty', 'Jolly', 'Keen', 'Lucky', 'Moody', 'Noisy', 'Polite', 'Quirky', 'Rowdy', 'Shy', 'Speedy', 'Sturdy', 'Tipsy', 'Velvet', 'Witty', 'Zesty', 'Bashful', 'Cranky', 'Dizzy', 'Frosty', 'Peppy'];
const ANI = ['Pelican', 'Otter', 'Badger', 'Walrus', 'Llama', 'Penguin', 'Hedgehog', 'Moose', 'Gecko', 'Raccoon', 'Beaver', 'Ferret', 'Narwhal', 'Panda', 'Koala', 'Falcon', 'Lobster', 'Marmot', 'Newt', 'Ocelot', 'Puffin', 'Quail', 'Rabbit', 'Sloth', 'Tortoise', 'Urchin', 'Vulture', 'Wombat', 'Yak', 'Zebra', 'Alpaca', 'Bison', 'Capybara', 'Dolphin', 'Emu', 'Flamingo', 'Giraffe', 'Heron', 'Iguana', 'Jackal'];
export const nameOf = (seed) => { const h = hash(seed, 'name'); return `${ADJ[h % ADJ.length]} ${ANI[(h >>> 8) % ANI.length]}`; };

// ── edgework ────────────────────────────────────────────────────────────
export const INDICATORS = ['RDY', 'PWR', 'AUX', 'LNK', 'SYS', 'CLR', 'IGN', 'MSA'];
export const PORTS = ['DVI', 'PS2', 'RJ45', 'SERIAL'];
const CONS = 'BCDFGHJKLMNPQRSTVWXZ';
const DIG = '0123456789';

function serialOf(r, vowel) {
  const ch = [];
  for (let i = 0; i < 5; i++) ch.push(r() < 0.55 ? pick(r, CONS) : pick(r, DIG));
  if (vowel) ch[int(r, 5)] = pick(r, 'AEIOU');
  ch.push(pick(r, DIG));
  return ch.join('');
}
function makeEdgework(seed, T, withVoid) {
  const r = stream(seed, 'edge');
  const vowel = r() < 0.5;
  const serial = serialOf(r, vowel);
  const batteries = int(r, 5);
  const pool = [...(T.id === 'classic' ? INDICATORS.slice(0, 5) : INDICATORS)];
  const indicators = [0, 1].map(() => ({ label: pool.splice(int(r, pool.length), 1)[0], lit: r() < 0.5 }));
  const E = { serial, vowel: /[AEIOU]/.test(serial), last: +serial[5], even: +serial[5] % 2 === 0, batteries, indicators, ports: [], portPlate: false };
  if (T.level >= 2) { const pr = stream(seed, 'ports'); E.portPlate = true; E.ports = sample(pr, PORTS, int(pr, 4)); }
  if (withVoid) {
    const vr = stream(seed, 'void');
    let fake = serial;
    for (let t = 0; t < 40; t++) {
      fake = serialOf(vr, vr() < 0.5);
      if (fake !== serial && +fake[5] % 2 !== +serial[5] % 2 && /[AEIOU]/.test(fake) !== E.vowel) break;
      if (t > 25 && fake !== serial && +fake[5] % 2 !== +serial[5] % 2) break;
    }
    E.void = fake;
    const real = pick(vr, indicators);
    E.voidInd = { label: real.label, lit: !real.lit };
  }
  return E;
}

// ── twists, modules, schedule ───────────────────────────────────────────
function twistPool(T) {
  const ok = (id) => !BY_ID[id] || !BY_ID[id].tiers || BY_ID[id].tiers.includes(T.id);
  const pool = ['decoy', 'void', 'errata', 'surge', 'tax', 'blackout'];
  if (BY_ID.relay && ok('relay')) pool.push('relay');
  if (!T.needy && BY_ID.vent && ok('vent')) pool.push('vent');
  return pool;
}
function drawTwists(seed, T) {
  if (!T.twists) return { twists: [], reserve: [] };
  const r = stream(seed, 'twists');
  const forced = T.id === 'wild' ? ['tax'] : [];
  const rest = shuffle(r, twistPool(T).filter((x) => !forced.includes(x)));
  const all = [...forced, ...rest];
  return { twists: all.slice(0, T.twists), reserve: rest.slice(T.twists - forced.length).filter((x) => ['void', 'surge', 'tax', 'blackout'].includes(x)) };
}
function drawTypes(seed, T, n) {
  if (T.id === 'classic') return [...CLASSIC_IDS];
  const r = stream(seed, 'mods');
  const pool = REGISTRY.filter((p) => !p.needy && !p.remote && (!p.tiers || p.tiers.includes(T.id)));
  const cl = shuffle(r, pool.filter((p) => CLASSIC_IDS.includes(p.id)));
  const nw = shuffle(r, pool.filter((p) => !CLASSIC_IDS.includes(p.id)));
  const out = [];
  if (n >= 3 && cl.length && nw.length) out.push(cl.shift(), nw.shift());
  const rest = shuffle(r, [...cl, ...nw]);
  while (out.length < n && rest.length) out.push(rest.shift());
  return out.slice(0, n).map((p) => p.id);
}
/** Surges and blackouts, as "seconds left on the clock" when they start. Never in the first or last 30 s, never overlapping. */
function schedule(seed, T, nSurge, nBlack) {
  const out = { surge: [], blackout: [] };
  const kinds = [...Array(nSurge).fill('surge'), ...Array(nBlack).fill('blackout')];
  if (!kinds.length) return out;
  const r = stream(seed, 'sched');
  const span = { surge: 30, blackout: 12 };
  const order = shuffle(r, kinds);
  const range = T.secs - 60;
  const used = order.reduce((s, k) => s + span[k], 0);
  const free = Math.max(0, range - used);
  const w = order.map(() => 0.35 + r());
  const ws = w.reduce((a, b) => a + b, 0) + 0.35;
  let pos = T.secs - 30;
  order.forEach((k, i) => {
    pos -= (free * w[i]) / ws;
    out[k].push(Math.round(pos));
    pos -= span[k];
  });
  return out;
}

// ── the round ───────────────────────────────────────────────────────────
export function buildRound(seed, tierKey) {
  seed = String(seed);
  const T = tierOf(tierKey) || TIERS.normal;
  let { twists, reserve } = drawTwists(seed, T);
  const has = (id) => twists.includes(id);
  const relayOn = has('relay');
  const ventOn = T.needy ? !!BY_ID.vent : has('vent');

  const E = makeEdgework(seed, T, has('void'));

  // which module types, then the layout
  const plain = T.mods - (relayOn ? 1 : 0);
  const decoyOn = has('decoy');
  const types = drawTypes(seed, T, plain - (decoyOn ? 1 : 0));
  const lr = stream(seed, 'layout');
  let dupId = null;
  const ents = types.map((id) => ({ id }));
  if (decoyOn && types.length) { dupId = pick(stream(seed, 'decoy', 'type'), types); ents.push({ id: dupId, dup: true }); }
  if (relayOn) ents.push({ id: 'relay' });
  const order = T.id === 'classic' ? ents : shuffle(lr, ents);
  if (ventOn) order.push({ id: 'vent' });

  // rules, errata
  const book = {};
  const ids = [...new Set(order.map((e) => e.id))].sort((a, b) => REGISTRY.indexOf(BY_ID[a]) - REGISTRY.indexOf(BY_ID[b]));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  for (const id of ids) {
    const p = BY_ID[id];
    const R0 = p.rules(stream(seed, 'rules', id), T);
    book[id] = { R0, R: R0, note: null };
  }
  let errataId = null;
  const wantErrata = has('errata');
  if (wantErrata) {
    for (const id of shuffle(stream(seed, 'errata'), ids)) {
      const p = BY_ID[id];
      if (!p.errata) continue;
      const er = p.errata(stream(seed, 'errata', id), clone(book[id].R0), T);
      if (er && er.R && er.note) { book[id].R = er.R; book[id].note = er.note; errataId = id; break; }
    }
    if (!errataId) { // nothing could carry a slip: swap in another twist
      twists = twists.filter((x) => x !== 'errata');
      const sub = reserve.find((x) => !twists.includes(x));
      if (sub) twists.push(sub);
    }
  }

  // plates (every module gets one when the round has twists, so a twin doesn't give itself away)
  const plated = T.twists > 0;
  const pr = stream(seed, 'plates');
  const used = new Set();
  const plate = () => { for (;;) { const p = 100 + int(pr, 900); if (!used.has(p)) { used.add(p); return p; } } };
  let decoy = null;
  const slots = order.map((e) => ({ id: e.id, plate: plated ? plate() : 0, decoy: false, dup: !!e.dup, S: null }));
  if (decoyOn && dupId) {
    const idx = slots.map((s, i) => (s.id === dupId ? i : -1)).filter((i) => i >= 0);
    let rule = pick(stream(seed, 'decoy', 'rule'), ['low', 'high', 'even', 'odd', 'share']);
    let live = -1;
    for (let t = 0; t < 300 && live < 0; t++) {
      for (const i of idx) { used.delete(slots[i].plate); slots[i].plate = plate(); }
      live = decoyLive(rule, idx.map((i) => slots[i].plate), E.serial);
    }
    if (live < 0) { rule = 'low'; live = decoyLive('low', idx.map((i) => slots[i].plate), E.serial); }
    slots[idx[1 - live]].decoy = true;
    decoy = { type: dupId, rule };
  }
  // puzzles
  for (const s of slots) s.S = BY_ID[s.id].gen(stream(seed, 'gen', s.id, s.dup ? 'twin' : 'main'), E, book[s.id].R, T);

  // golden module: about one round in twelve, never one of the twins (it would give the live one away)
  let gold = -1;
  if (T.id !== 'classic') {
    const gr = stream(seed, 'gold');
    const cand = slots.map((s, i) => (!s.decoy && s.id !== dupId && !BY_ID[s.id].needy ? i : -1)).filter((i) => i >= 0);
    if (gr() < 1 / 12 && cand.length) gold = pick(gr, cand);
  }

  // timed twists
  const nBlack = has('blackout') ? 1 + int(stream(seed, 'blackout', 'n'), 2) : 0;
  const sched = schedule(seed, T, has('surge') ? 2 : 0, nBlack);
  const twistRules = {};
  if (decoy) twistRules.decoy = decoy;
  if (has('void')) twistRules.void = { serial: E.void };
  if (errataId) twistRules.errata = { id: errataId };
  if (has('surge')) twistRules.surge = { at: sched.surge, dur: SURGE_SECS };
  if (has('blackout')) twistRules.blackout = { at: sched.blackout, warn: BLACKOUT.warn, dur: BLACKOUT.dur };
  if (has('tax') || T.id === 'wild') twistRules.tax = { secs: TAX_SECS };
  if (relayOn) twistRules.relay = {};
  if (ventOn) twistRules.vent = {};

  const fp = hash('ed', T.id, JSON.stringify(ids.map((id) => book[id].R0)));
  const edition = T.id === 'classic' ? 'Ed. C-1' : `Ed. ${1 + (fp % 9)}${'ACDEFGHJKLMNPRTUVWXY'[(fp >>> 4) % 20]}-${(fp >>> 12) % 10}`;
  return { seed, tier: T.id, T, E, slots, book, ids, twists, twistRules, gold, name: nameOf(seed), edition };
}

/** Does this slot count towards defusing the bomb? */
export const isScored = (slot) => !slot.decoy && !(BY_ID[slot.id] && BY_ID[slot.id].needy);
