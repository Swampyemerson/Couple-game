// Air Hockey's printed look. Everything here draws once (on layout / theme change) into a cached
// canvas, so the per-frame loop only ever blits small sprites: paper tooth, halftone, the misregistered
// centre mark, the mallet / puck / ink-splat sprites. Pure canvas helpers, no game state.
import { W, H, RM, RP } from './physics.js';

/** Small seeded generator: the same grain and the same splat shape on every device. */
export function rng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

/** [r, g, b] of any CSS colour string (the tokens may be hex, rgb() or a colour-mix result). */
export function rgbOf(str) {
  try {
    const c = mk(1, 1); const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000'; x.fillStyle = str; x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch { return [24, 23, 29]; }
}

/** Paper tooth: a tile of random specks in the ink colour (dark ink on light paper, cream on black stock).
 *  Device pixels, so the grain stays one pixel fine whatever the resolution. */
export function grainTile(ink, dark, px = 96) {
  const c = mk(px, px); const x = c.getContext('2d');
  const img = x.createImageData(px, px); const d = img.data;
  const [r, g, b] = rgbOf(ink); const rnd = rng(1971);
  const top = dark ? 46 : 62; // alpha of the strongest speck (0..255)
  for (let i = 0; i < px * px; i++) {
    const v = rnd(); const a = v > 0.55 ? Math.pow((v - 0.55) / 0.45, 1.6) * top : 0;
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a;
  }
  x.putImageData(img, 0, 0);
  return c;
}

/** Fill the whole canvas (device pixels) with the grain. */
export function paintGrain(c, tile, w, h) {
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = c.createPattern(tile, 'repeat'); c.fillRect(0, 0, w, h);
  c.restore();
}

/** A halftone ring / band: dots on a staggered grid whose size follows `size(d)`, d = 0..1 along the fade. */
export function dots(c, x0, x1, y0, y1, step, rMax, fade, color, alpha) {
  c.fillStyle = color; c.globalAlpha = alpha;
  c.beginPath();
  for (let y = y0, row = 0; y < y1; y += step * 0.87, row++) {
    const r = rMax * fade((y - y0) / (y1 - y0));
    if (r < 0.12) continue;
    for (let x = x0 + (row % 2) * step * 0.5; x < x1; x += step) { c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); }
  }
  c.fill(); c.globalAlpha = 1;
}
/** Concentric halftone around a point: the dots shrink with the distance. */
export function dotRings(c, cx, cy, r0, r1, step, rMax, color, alpha) {
  c.fillStyle = color; c.globalAlpha = alpha;
  c.beginPath();
  for (let r = r0, ring = 0; r < r1; r += step * 0.87, ring++) {
    const dr = rMax * (1 - (r - r0) / (r1 - r0));
    if (dr < 0.12) continue;
    const n = Math.max(8, Math.round((Math.PI * 2 * r) / step)); const off = (ring % 2) * 0.5;
    for (let i = 0; i < n; i++) { const a = ((i + off) / n) * Math.PI * 2; const px = cx + Math.cos(a) * r; const py = cy + Math.sin(a) * r; c.moveTo(px + dr, py); c.arc(px, py, dr, 0, Math.PI * 2); }
  }
  c.fill(); c.globalAlpha = 1;
}

/** The centre mark: two interlocking rings (one per player) over a yellow plate, each plate a hair off
 *  register. In light mode the overlap prints violet (multiply); on black stock the plates just stack. */
export function centreMark(c, T, lw) {
  const cx = W / 2; const cy = H / 2; const R = 6.4; const gap = 3.5;
  c.save();
  c.lineCap = 'round';
  // yellow plate, the furthest off register
  c.fillStyle = T.hl; c.globalAlpha = 0.9;
  c.beginPath(); c.arc(cx + 1.2, cy + 0.9, R + gap + 1.6, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
  const ring = (dx, col, ox, oy) => { c.strokeStyle = col; c.lineWidth = lw * 1.9; c.beginPath(); c.arc(cx + dx + ox, cy + oy, R, 0, Math.PI * 2); c.stroke(); };
  if (!T.dark) c.globalCompositeOperation = 'multiply';
  ring(-gap, T.a, -0.55, -0.4);
  ring(gap, T.b, 0.6, 0.5);
  c.globalCompositeOperation = 'source-over';
  // the key plate: a thin black outline of both rings, printed true
  c.strokeStyle = T.ink; c.lineWidth = lw * 0.55; c.globalAlpha = 0.9;
  c.beginPath(); c.arc(cx - gap, cy, R + lw * 0.95, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(cx + gap, cy, R + lw * 0.95, 0, Math.PI * 2); c.stroke();
  c.globalAlpha = 1;
  c.restore();
}

/** A disc sprite helper: draws into a fresh canvas big enough for r + shadow, returns { cv, half } (half in css px). */
function sprite(rCss, extra, dpr, draw) {
  const half = Math.ceil(rCss + extra);
  const cv = mk(half * 2 * dpr, half * 2 * dpr); const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, half * dpr, half * dpr);
  draw(c);
  return { cv, half };
}
const disc = (c, x, y, r, fill, stroke, lw) => {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
};

/** A mallet: hard offset shadow, the player's ink printed a touch off the key outline, a halftone dish. */
export function malletSprite(T, who, s, dpr) {
  const r = RM * s; const lw = Math.max(1.5, s * 0.55); const sh = Math.max(2, s * 0.9);
  const mis = Math.max(0.7, r * 0.055); // the colour plate is a hair off the black outline
  return sprite(r, sh * 1.4 + lw + 2, dpr, (c) => {
    disc(c, sh, sh * 1.2, r, T.edge);
    disc(c, mis, mis * 0.8, r - lw * 0.4, T[who]);
    disc(c, 0, 0, r, null, T.ink, lw);
    // halftone dish: dots of the card stock in the middle ring
    c.save(); c.beginPath(); c.arc(0, 0, r * 0.7, 0, Math.PI * 2); c.clip();
    c.fillStyle = T.card; c.globalAlpha = 0.55;
    const st = Math.max(2.2, r * 0.17);
    c.beginPath();
    for (let y = -r, row = 0; y <= r; y += st * 0.87, row++) for (let x = -r + (row % 2) * st * 0.5; x <= r; x += st) { const d = Math.hypot(x, y) / (r * 0.7); const dr = st * 0.36 * (1 - d * 0.6); if (dr > 0.2) { c.moveTo(x + dr, y); c.arc(x, y, dr, 0, Math.PI * 2); } }
    c.fill(); c.globalAlpha = 1; c.restore();
    disc(c, 0, 0, r * 0.68, null, T.ink, lw * 0.7);
    disc(c, sh * 0.35, sh * 0.45, r * 0.4, T.edge);
    disc(c, mis * 0.6, mis * 0.5, r * 0.4 - lw * 0.3, T[who]);
    disc(c, 0, 0, r * 0.4, null, T.ink, lw);
    c.globalAlpha = 0.55; c.beginPath(); c.arc(0, 0, r * 0.25, Math.PI * 1.05, Math.PI * 1.6); c.strokeStyle = T.card; c.lineWidth = lw; c.stroke(); c.globalAlpha = 1;
  });
}

/** A puck (i = 0 the ink puck, 1 the yellow twin), with its hard shadow. */
export function puckSprite(T, i, s, dpr) {
  const r = RP * s; const lw = Math.max(1.5, s * 0.5); const sh = Math.max(1.5, s * 0.6);
  return sprite(r, sh * 1.4 + lw + 2, dpr, (c) => {
    disc(c, sh, sh * 1.2, r, T.edge);
    disc(c, 0, 0, r, i ? T.hl : T.ink, T.ink, lw);
    disc(c, 0, 0, r * 0.62, null, i ? T.ink : T.card, Math.max(1, lw * 0.6));
    disc(c, 0, 0, r * 0.16, i ? T.ink : T.card);
  });
}

/** The goal splat: a blot of the scorer's ink with droplets, a halftone halo and a key outline. Drawn big, scaled in. */
export function splatSprite(T, who, s, dpr) {
  const R = 20 * s; const rnd = rng(who === 'a' ? 11 : 29);
  const lobes = []; const n = 9;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rnd() * 0.5; lobes.push([Math.cos(a), Math.sin(a), 0.5 + rnd() * 0.42, 0.18 + rnd() * 0.2]); }
  const drops = [];
  for (let i = 0; i < 9; i++) { const a = rnd() * Math.PI * 2; drops.push([Math.cos(a), Math.sin(a), 0.82 + rnd() * 0.32, 0.035 + rnd() * 0.06]); }
  return sprite(R * 1.45, 4, dpr, (c) => {
    const body = () => {
      c.beginPath();
      c.arc(0, 0, R * 0.52, 0, Math.PI * 2);
      for (const [dx, dy, d, r] of lobes) { c.moveTo(dx * R * d * 0.62 + R * r, dy * R * d * 0.62); c.arc(dx * R * d * 0.62, dy * R * d * 0.62, R * r, 0, Math.PI * 2); }
      for (const [dx, dy, d, r] of drops) { c.moveTo(dx * R * d + R * r, dy * R * d); c.arc(dx * R * d, dy * R * d, R * r, 0, Math.PI * 2); }
    };
    // halftone halo
    dotRings(c, 0, 0, R * 0.7, R * 1.38, Math.max(3, s * 1.5), Math.max(1, s * 0.5), T[who], 0.5);
    c.translate(R * 0.045, R * 0.06); body(); c.fillStyle = T.edge; c.fill(); c.translate(-R * 0.045, -R * 0.06);
    // outline first (wide stroke), ink on top: only the outer half of the stroke survives, so overlapping lobes show no seams
    body(); c.lineWidth = Math.max(4, s * 1.2); c.strokeStyle = T.ink; c.lineJoin = 'round'; c.stroke();
    c.fillStyle = T[who]; c.fill();
    // a shine: a small slice of paper showing through the wet ink
    c.globalAlpha = 0.5; c.fillStyle = T.card; c.beginPath(); c.arc(-R * 0.16, -R * 0.2, R * 0.09, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
  });
}
