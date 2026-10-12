// The portrait gallery: a hider's best surviving skin, drawn flat on a 2D canvas (no WebGL context).
// The shared doc keeps the lock's quantised paint blob (paint.js's codec, ≤ 3000 characters);
// here it is decoded into the 128×128 atlas and the body, head, crest, tail and legs rectangles are
// laid out as a little flat chameleon sticker. Results are cached by blob, so a lobby rebuild costs
// nothing after the first draw.
import { decodeInto, encode, quantize } from './paint.js';
import { TEX } from './avatar.js';
import { bytesToB64, b64ToBytes } from './util.js';

// Atlas rectangles (x, y from the bottom, w, h), as avatar.js lays them out.
const R = {
  body: [0, 52, 76, 76], head: [76, 76, 52, 52], casque: [76, 52, 26, 24], tail: [0, 28, 128, 24],
  legFL: [0, 0, 32, 28], legFR: [32, 0, 32, 28], legBL: [64, 0, 32, 28], legBR: [96, 0, 32, 28],
};
const W = 168; const H = 100;
const cache = new Map();
let data = null; let atlas = null;

function ctx2d(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, g: c.getContext('2d') }; }
/** Draw one atlas rectangle into the target shape (the path is built by `shape`), stretched to its bounds. */
function patch(g, rect, x, y, w, h, shape) {
  const [rx, ry, rw, rh] = rect;
  g.save(); g.beginPath(); shape(g, x, y, w, h); g.closePath();
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,250,240,.95)'; g.lineWidth = 6; g.stroke();
  g.strokeStyle = '#1d1b22'; g.lineWidth = 2.6; g.stroke();
  g.clip();
  g.drawImage(atlas.c, rx, TEX - ry - rh, rw, rh, x, y, w, h);
  g.restore();
}
const ell = (g, x, y, w, h) => g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
const rrect = (r) => (g, x, y, w, h) => { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); };

// ── packing: the doc keeps ≤ 3000 characters per portrait ─────────────────────────────────
// Step 1 is paint.js's own codec (full 128², ≤ 32 colours) when it fits. A busy skin (a stamped
// pattern, lots of strokes) doesn’t, so the ladder drops to a coarser copy: 64² / 16 colours,
// 32² / 12, 16² / 8. A coarse blob is `[2, size, palette n, palette rgb…, tokens…]` with each token
// `(run − 1) << 5 | colour` (runs of up to 8), then base64. A portrait is a keepsake at 72 px wide,
// so the loss doesn't show.
export const PORTRAIT_CHARS = 3000;
const LADDER = [[64, 16], [32, 12], [16, 8]];
let scratch = null;
function coarse(data, size, colours) {
  const N = TEX * TEX; const f = TEX / size;
  if (!scratch) scratch = new Uint8Array(N * 4);
  scratch.fill(0); for (let i = 3; i < N * 4; i += 4) scratch[i] = 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0; let g = 0; let b = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const o = ((y * f + dy) * TEX + x * f + dx) * 4; r += data[o]; g += data[o + 1]; b += data[o + 2]; }
    const o = (y * TEX + x) * 4; const n = f * f; scratch[o] = r / n; scratch[o + 1] = g / n; scratch[o + 2] = b / n;
  }
  const q = quantize(scratch, colours + 1); // + 1: the black outside the size × size corner takes a slot
  const used = new Map(); const pal = []; const idx = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = q.idx[y * TEX + x]; let m = used.get(k);
    if (m === undefined) { m = pal.length; used.set(k, m); pal.push(q.palette[k]); }
    idx[y * size + x] = m;
  }
  if (pal.length > 32) return null;
  const out = [2, size, pal.length];
  for (const c of pal) out.push(c[0], c[1], c[2]);
  let p = 0; const n = idx.length;
  while (p < n) { let r = 1; while (p + r < n && idx[p + r] === idx[p] && r < 8) r++; out.push(((r - 1) << 5) | idx[p]); p += r; }
  return bytesToB64(Uint8Array.from(out));
}
/** Pack a hider's RGBA skin (128×128×4, never modified) into a portrait blob ≤ 3000 characters, or '' if even the coarsest is too big. */
export function packPortrait(rgba) {
  try {
    const copy = new Uint8Array(rgba); // encode() quantises in place: never touch the live skin
    const full = encode(copy).b64;
    if (full.length <= PORTRAIT_CHARS) return full;
    for (const [size, colours] of LADDER) { const b = coarse(rgba, size, colours); if (b && b.length <= PORTRAIT_CHARS) return b; }
  } catch { /* fall through */ }
  return '';
}
/** Blob (either format) → RGBA 128×128 in `out`; false when malformed. */
export function unpackPortrait(blob, out) {
  let bytes; try { bytes = b64ToBytes(blob); } catch { return false; }
  if (bytes[0] === 1) return decodeInto(blob, out) >= 0;
  if (bytes[0] !== 2) return false;
  const size = bytes[1]; const np = bytes[2];
  if (!size || TEX % size || np < 1 || np > 32) return false;
  const pal = []; let q = 3; for (let i = 0; i < np; i++) { pal.push([bytes[q], bytes[q + 1], bytes[q + 2]]); q += 3; }
  const idx = new Uint8Array(size * size); let p = 0;
  while (p < idx.length && q < bytes.length) { const b = bytes[q++]; const k = b & 31; const r = (b >> 5) + 1; for (let i = 0; i < r && p < idx.length; i++) idx[p++] = k; }
  if (p !== idx.length) return false;
  const f = TEX / size;
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) { const c = pal[idx[((y / f) | 0) * size + ((x / f) | 0)]] || pal[0]; const o = (y * TEX + x) * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; }
  return true;
}

/** The flat sticker for one blob as a PNG data URL, or '' (no DOM, or a bad blob). */
export function portraitUrl(blob) {
  if (typeof document === 'undefined' || !blob) return '';
  if (cache.has(blob)) return cache.get(blob);
  let url = '';
  try {
    if (!data) data = new Uint8Array(TEX * TEX * 4);
    if (!unpackPortrait(blob, data)) throw new Error('bad blob');
    if (!atlas) atlas = ctx2d(TEX, TEX);
    const img = atlas.g.createImageData(TEX, TEX); img.data.set(data);
    // rows in the buffer run bottom-up (v = 0 at the bottom): flip while uploading
    const flip = atlas.g.createImageData(TEX, TEX);
    for (let y = 0; y < TEX; y++) flip.data.set(img.data.subarray(y * TEX * 4, (y + 1) * TEX * 4), (TEX - 1 - y) * TEX * 4);
    atlas.g.putImageData(flip, 0, 0);
    const o = ctx2d(W, H); const g = o.g;
    // tail (curls to the back), legs, body, head, crest, eye
    g.save(); g.translate(26, 62); g.rotate(-0.28);
    patch(g, R.tail, -22, -9, 62, 20, rrect(9)); g.restore();
    patch(g, R.legBL, 44, 62, 18, 22, rrect(7));
    patch(g, R.legBR, 76, 62, 18, 22, rrect(7));
    patch(g, R.body, 30, 26, 94, 52, ell);
    patch(g, R.legFL, 94, 62, 18, 22, rrect(7));
    patch(g, R.legFR, 118, 62, 16, 20, rrect(7));
    patch(g, R.head, 110, 20, 46, 42, ell);
    patch(g, R.casque, 118, 8, 22, 20, ell);
    g.fillStyle = '#fffaf0'; g.strokeStyle = '#1d1b22'; g.lineWidth = 2.2;
    g.beginPath(); g.arc(142, 34, 7.5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#14121a'; g.beginPath(); g.arc(144.5, 34, 3.4, 0, Math.PI * 2); g.fill();
    url = o.c.toDataURL('image/png');
  } catch (e) { console.warn('portrait', e && e.message); url = ''; }
  if (cache.size >= 12) cache.delete(cache.keys().next().value);
  cache.set(blob, url);
  return url;
}
/** An <img> for the blob (alt text names the owner), or '' when it can't be drawn. */
export function portraitImg(blob, w) {
  const url = portraitUrl(blob);
  return url ? `<img src="${url}" width="${W}" height="${H}" alt="Best hide portrait (${w === 'a' ? 'first' : 'second'} player)" decoding="async">` : '';
}
