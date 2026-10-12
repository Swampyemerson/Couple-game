// Defuse: shared helpers for the framework and every module file. Pure: no DOM, no imports, so the
// node unit tests can import any module file directly.
//
// Seeded randomness. Everything about a round (edgework, which modules, each module's rules and its
// puzzle) is drawn from the round seed, so the bomb device and the manual device build the same
// round from { seed, tier } alone. Use a separate named stream per purpose so adding a draw in one
// module never shifts another: stream(seed, 'rules', 'maze').

export function hash(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= 0x2f; h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
/** A seeded generator () => [0, 1). Same algorithm as core.js rng(). */
export function rngOf(seed) {
  let a = hash(seed) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A named stream: stream(seed, 'rules', 'maze'). */
export const stream = (seed, ...keys) => rngOf(['defuse', seed, ...keys].join('|'));
export const int = (r, n) => Math.floor(r() * n);
export const pick = (r, a) => a[Math.floor(r() * a.length)];
export function shuffle(r, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** k distinct items from arr. */
export const sample = (r, arr, k) => shuffle(r, arr).slice(0, k);

export const cap = (s) => s[0].toUpperCase() + s.slice(1);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const cnt = (c, x) => c.filter((y) => y === x).length;
export const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
export const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
/** A colour swatch for manual text (the CSS var --dx-<c> exists for every colour in DX_COLORS). */
export const swatch = (c) => `<span class="dx-sw" style="--sw: var(--dx-${c})"></span>${cap(c)}`;
export const DX_COLORS = ['red', 'blue', 'yellow', 'green', 'white', 'black', 'orange', 'purple'];

/**
 * Edgework helpers. E = { serial, vowel, last, even, batteries, indicators: [{label, lit}], void?: serial }
 * K = ctxOf(E) adds lit(label) and the commonly asked facts.
 */
export function ctxOf(E) {
  const last = +E.serial[E.serial.length - 1];
  return { serial: E.serial, last, even: last % 2 === 0, vowel: /[AEIOU]/.test(E.serial), bat: E.batteries, lit: (l) => E.indicators.some((i) => i.label === l && i.lit), has: (l) => E.indicators.some((i) => i.label === l) };
}
