// Small shared helpers for Blend & Seek (no three.js here).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, k) => a + (b - a) * k;
/** Frame-rate independent smoothing: move a toward b with half-life-ish rate `r` (1/s). */
export const damp = (a, b, r, dt) => b + (a - b) * Math.exp(-r * dt);
export const TAU = Math.PI * 2;

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export function dampAngle(a, b, r, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-r * dt));
}

/** Deterministic PRNG (mulberry32) from a string or number seed. */
export function seeded(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h || 1;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (n) => Math.floor(r() * n);
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}

/** FNV-1a 32-bit over a byte array (Uint8Array / Uint8ClampedArray). */
export function fnv(bytes, start = 0, end = bytes.length) {
  let h = 0x811c9dc5;
  for (let i = start; i < end; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function hexToRgb(hex) {
  let s = String(hex || '').trim();
  if (s.startsWith('rgb')) {
    const m = s.match(/[\d.]+/g) || [0, 0, 0];
    return [+m[0] | 0, +m[1] | 0, +m[2] | 0];
  }
  if (s[0] === '#') s = s.slice(1);
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r, g, b) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
export const rgbInt = (r, g, b) => (r << 16) | (g << 8) | b;
export function mixHex(a, b, k) {
  const x = hexToRgb(a); const y = hexToRgb(b);
  return rgbToHex(Math.round(lerp(x[0], y[0], k)), Math.round(lerp(x[1], y[1], k)), Math.round(lerp(x[2], y[2], k)));
}
export function shade(hex, k) { return k < 0 ? mixHex(hex, '#000000', -k) : mixHex(hex, '#ffffff', k); }
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Resolve a CSS colour (maybe color-mix / var) into #rrggbb using a probe element. */
export function cssColor(el, value, fallback = '#888888') {
  try {
    const p = document.createElement('i');
    p.style.color = value;
    p.style.display = 'none';
    el.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    if (!c) return fallback;
    const m = c.match(/[\d.]+/g);
    if (!m || m.length < 3) return fallback;
    if (/color\(srgb/.test(c)) return rgbToHex(Math.round(+m[0] * 255), Math.round(+m[1] * 255), Math.round(+m[2] * 255));
    return rgbToHex(+m[0] | 0, +m[1] | 0, +m[2] | 0);
  } catch { return fallback; }
}

export const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** base64 <-> bytes without allocating giant intermediate strings per byte. */
export function bytesToB64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
export function b64ToBytes(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Registry of DOM listeners so destroy() can remove every one. */
export function listeners() {
  const list = [];
  return {
    on(target, type, fn, opts) { target.addEventListener(type, fn, opts); list.push([target, type, fn, opts]); return fn; },
    clear() { for (const [t, ty, fn, o] of list) { try { t.removeEventListener(ty, fn, o); } catch { /* ignore */ } } list.length = 0; },
    get count() { return list.length; },
  };
}

// ── compact orientation (presence) ──
// "Smallest three" quaternion packing into one unsigned 32-bit integer: 2 bits for the index of
// the largest component (dropped, made positive), then 3 × 10 bits for the others in
// [-1/√2, 1/√2]. ~0.1° precision, one small number in the presence JSON.
const QS = Math.SQRT1_2;
const QA = [0, 0, 0, 0];
export function packQuat(x, y, z, w) {
  const a = QA; a[0] = x; a[1] = y; a[2] = z; a[3] = w;
  let big = 0; let m = -1;
  for (let i = 0; i < 4; i++) { const v = Math.abs(a[i]); if (v > m) { m = v; big = i; } }
  const sgn = a[big] < 0 ? -1 : 1;
  let out = big;
  for (let i = 0; i < 4; i++) {
    if (i === big) continue;
    let v = (a[i] * sgn) / QS; v = v < -1 ? -1 : v > 1 ? 1 : v;
    out = out * 1024 + Math.round((v * 0.5 + 0.5) * 1023);
  }
  return out;
}
const QV = [0, 0, 0];
/** Unpack into out[0..3] = x, y, z, w (unit). */
export function unpackQuat(p, out) {
  p = Math.round(p) || 0;
  const c = p % 1024; const b = Math.floor(p / 1024) % 1024; const a = Math.floor(p / 1048576) % 1024; const big = Math.floor(p / 1073741824) & 3;
  const v = QV; v[0] = ((a / 1023) * 2 - 1) * QS; v[1] = ((b / 1023) * 2 - 1) * QS; v[2] = ((c / 1023) * 2 - 1) * QS;
  const s = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const L = Math.sqrt(Math.max(0, 1 - s));
  let k = 0;
  for (let i = 0; i < 4; i++) out[i] = i === big ? L : v[k++];
  const n = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  for (let i = 0; i < 4; i++) out[i] /= n;
  return out;
}
/** Spherical interpolation of two unit quaternions (arrays) into out. */
export function slerpQuat(a, b, t, out) {
  let bx = b[0]; let by = b[1]; let bz = b[2]; let bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0; let k1;
  if (cos > 0.9995) { k0 = 1 - t; k1 = t; } else {
    const th = Math.acos(cos); const s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s;
  }
  out[0] = a[0] * k0 + bx * k1; out[1] = a[1] * k0 + by * k1; out[2] = a[2] * k0 + bz * k1; out[3] = a[3] * k0 + bw * k1;
  const n = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  for (let i = 0; i < 4; i++) out[i] /= n;
  return out;
}
