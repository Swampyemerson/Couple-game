// Procedural pattern atlas: every patterned surface of a map is painted (deterministically)
// into one 1024² canvas. Tiles repeat in the shader (fract + textureGrad), so each tile is
// drawn seamless and surrounded by an 8 px wrap-around gutter. A CPU copy of the pixels is
// kept for the eyedropper and the stamp tool.
import { seeded, mixHex, shade, hexToRgb } from './util.js';

const PAD = 8;
const SIZES = { S: 48, M: 112, L: 240, XL: 496 };
/** Paper grain baked into every tile (graphics pass): ± this fraction of each channel, so a
 *  seeker's eyedropper, the stamp and the blend score all read the grain as part of the albedo.
 *  Worst case ΔE ≈ 3 (one dust speck on a bright tile), typical < 1. Per-tile override: `grain`. */
const GRAIN = 0.032;

/**
 * Skyline packer shared with the tests: rects [{ key, w, h }] (inner size; each gets an 8 px gutter on every
 * side) into a size × height page, tallest first, each at the lowest, then leftmost, spot (columns of 8 px).
 * Returns { at: { key: { x, y } }, used, dropped: [keys] } (x, y are the gutter-inclusive corner).
 */
export function packRects(rects, size, height) {
  const cols = Math.floor(size / 8); const top = new Int32Array(cols);
  const order = [...rects].sort((a, b) => b.h - a.h || b.w - a.w);
  const at = {}; const dropped = []; let used = 0;
  for (const r of order) {
    const W = r.w + PAD * 2; const H = r.h + PAD * 2; const cw = Math.ceil(W / 8);
    let bx = -1; let by = 1e9;
    for (let x = 0; x + cw <= cols; x++) {
      let m = 0; for (let k = 0; k < cw; k++) if (top[x + k] > m) m = top[x + k];
      if (m < by) { by = m; bx = x; }
    }
    if (bx < 0 || by + H > height) { dropped.push(r.key); continue; }
    for (let k = 0; k < cw; k++) top[bx + k] = by + H;
    at[r.key] = { x: bx * 8, y: by }; used = Math.max(used, by + H);
  }
  return { at, used, dropped };
}

/** size: width in px; height: 1024 or 2048 (two 1024² pages stacked in one texture for big maps). */
export function createAtlas(size = 1024, height = size) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, height);
  const reqs = [];
  const tiles = {}; // key -> [u0, v0, du, dv]
  const rects = {}; // key -> { x, y, w, h, repeat }

  function add(key, painter, { size: sz = 'L', repeat = true, w, h, grain = GRAIN } = {}) {
    const iw = w || SIZES[sz] || SIZES.L; const ih = h || iw;
    reqs.push({ key, painter, iw, ih, repeat, grain });
  }

  /** Paint every tile (all at once). finishSteps() is the same work one tile per step (it
   *  yields after each tile), so a map build can be spread over frames (maps.js buildMapAsync). */
  function finish() { const it = finishSteps(); for (;;) { const s = it.next(); if (s.done) return s.value; } }
  function* finishSteps() {
    add('white', (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }, { size: 'S', repeat: true, grain: 0 });
    // skyline packing, tallest first (graphics pass: the old shelf packer left a third of the page empty)
    const spots = packRects(reqs.map((r) => ({ key: r.key, w: r.iw, h: r.ih })), size, height);
    let used = 0;
    for (const r of [...reqs].sort((a, b) => b.ih - a.ih || b.iw - a.iw)) {
      const sp = spots.at[r.key];
      if (!sp) { console.warn('atlas full, dropping', r.key); continue; }
      const W = r.iw + PAD * 2; const H = r.ih + PAD * 2; const x = sp.x; const y = sp.y;
      used = Math.max(used, y + H);
      const ix = x + PAD; const iy = y + PAD; const w = r.iw; const h = r.ih;
      // maps pass (perf): paint straight into the (CPU-backed) atlas, clipped to the tile, and
      // copy the gutters with putImageData. The old tmp canvas + 9 clipped drawImage blits per
      // tile (and self-drawImage of the whole atlas for clamped gutters) were 25-225 ms a map;
      // this is 8-40 ms with the same pixels (± rounding on anti-aliased edges).
      ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, w, h); ctx.clip(); ctx.translate(ix, iy);
      try { r.painter(ctx, w, h, seeded(r.key)); } catch (e) { console.error('atlas painter', r.key, e); }
      ctx.restore();
      const img = ctx.getImageData(ix, iy, w, h);
      if (r.grain > 0) { grainTile(img, r.grain, seeded(r.key + ':grain')); ctx.putImageData(img, ix, iy); }
      if (r.repeat) {
        // wrap-around gutter: the opposite edges (and corners) of the tile
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          ctx.putImageData(img, ix + ox * w, iy + oy * h, ox < 0 ? w - PAD : 0, oy < 0 ? h - PAD : 0, ox ? PAD : w, oy ? PAD : h);
        }
      } else {
        // clamp-extend: the edge rows, then the edge columns (corners included), across the gutter
        const d = img.data; const rowLen = w * 4;
        const strip = ctx.createImageData(w, PAD);
        for (const [sy, dy] of [[0, y], [h - 1, iy + h]]) {
          const src = d.subarray(sy * rowLen, (sy + 1) * rowLen);
          for (let k = 0; k < PAD; k++) strip.data.set(src, k * rowLen);
          ctx.putImageData(strip, ix, dy);
        }
        const col = ctx.createImageData(PAD, H); const cd = col.data;
        for (const [sx, dx] of [[0, x], [w - 1, ix + w]]) {
          for (let yy = 0; yy < H; yy++) {
            const si = ((yy < PAD ? 0 : yy >= PAD + h ? h - 1 : yy - PAD) * w + sx) * 4;
            for (let k = 0; k < PAD; k++) { const di = (yy * PAD + k) * 4; cd[di] = d[si]; cd[di + 1] = d[si + 1]; cd[di + 2] = d[si + 2]; cd[di + 3] = d[si + 3]; }
          }
          ctx.putImageData(col, dx, y);
        }
      }
      rects[r.key] = { x: ix, y: iy, w, h, repeat: r.repeat };
      tiles[r.key] = [ix / size, 1 - (iy + h) / height, w / size, h / height];
      yield r.key;
    }
    // The CPU copy for the eyedropper / stamp / blend score is read on first use (or by
    // warm() in idle time after a map switch): a 4-8 MB getImageData no longer sits in the
    // switch itself, and a cached map that is never sampled never pays for it.
    let data = null;
    return {
      canvas, size, width: size, height, tiles, rects, used,
      get data() { if (!data) data = ctx.getImageData(0, 0, size, height).data; return data; },
      get hasData() { return !!data; },
      warm() { void this.data; },
    };
  }
  return { add, finish, finishSteps };
}

/** CPU texel lookup matching the shader: tile + fract(uv). Writes [r,g,b] (0-255) into out. */
export function sampleAtlas(atlas, tile, u, v, out) {
  const S = atlas.size; const SH = atlas.height || S;
  let fu = u - Math.floor(u); let fv = v - Math.floor(v);
  if (fu >= 1) fu = 0; if (fv >= 1) fv = 0;
  const px = Math.min(S - 1, Math.max(0, Math.floor((tile[0] + fu * tile[2]) * S)));
  const py = Math.min(SH - 1, Math.max(0, Math.floor((1 - (tile[1] + fv * tile[3])) * SH)));
  const i = (py * S + px) * 4; const D = atlas.data; // a getter (read on first use)
  out[0] = D[i]; out[1] = D[i + 1]; out[2] = D[i + 2];
  return out;
}

/** Seamless paper grain: smooth 6 px value noise + per-pixel noise (+ rare dust), wrap-safe. */
function grainTile(img, amp, rnd) {
  const w = img.width; const h = img.height; const d = img.data;
  const cx = Math.max(2, Math.round(w / 6)); const cy = Math.max(2, Math.round(h / 6));
  const grid = new Float32Array(cx * cy);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd() * 2 - 1;
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * cy; const y0 = Math.floor(fy); let ty = fy - y0; ty = ty * ty * (3 - 2 * ty); const y1 = (y0 + 1) % cy;
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cx; const x0 = Math.floor(fx); let tx = fx - x0; tx = tx * tx * (3 - 2 * tx); const x1 = (x0 + 1) % cx;
      const a = grid[y0 * cx + x0] + (grid[y0 * cx + x1] - grid[y0 * cx + x0]) * tx;
      const b = grid[y1 * cx + x0] + (grid[y1 * cx + x1] - grid[y1 * cx + x0]) * tx;
      let n = 0.55 * (a + (b - a) * ty) + 0.45 * (rnd() * 2 - 1);
      if (rnd() < 0.0012) n = -1;
      const k = 1 + amp * n; const i = (y * w + x) * 4;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
}

// ── painters ───────────────────────────────────────────────────────────
// Each returns (g, w, h, rnd) => void and must tile seamlessly when `repeat`.

const wrapCircle = (g, x, y, r, w, h) => {
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = x + ox * w; const cy = y + oy * h;
    if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  }
};
/** Run fn(ox, oy) for the tile and its 8 wrapped neighbours (drawing that crosses an edge reappears opposite). */
const wrap9 = (w, h, fn) => { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) fn(ox * w, oy * h); };
/** A wrapped filled rect. */
const wrapRect = (g, x, y, rw, rh, w, h) => { wrap9(w, h, (ox, oy) => { const X = x + ox; const Y = y + oy; if (X + rw < 0 || X > w || Y + rh < 0 || Y > h) return; g.fillRect(X, Y, rw, rh); }); };
/** A wrapped ellipse (fill or stroke already set up by the caller). */
const wrapEllipse = (g, x, y, rx, ry, rot, w, h, stroke) => {
  wrap9(w, h, (ox, oy) => {
    const X = x + ox; const Y = y + oy; const m = Math.max(rx, ry);
    if (X + m < 0 || X - m > w || Y + m < 0 || Y - m > h) return;
    g.beginPath(); g.ellipse(X, Y, rx, ry, rot, 0, Math.PI * 2); if (stroke) g.stroke(); else g.fill();
  });
};
/** hex colour jittered in brightness by ±amt (a fraction). */
const jit = (hex, amt, r) => { const [R, G, B] = hexToRgb(hex); const k = 1 + (r() * 2 - 1) * amt; const c = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${c(R)},${c(G)},${c(B)})`; };
/** Fine woven thread lines over the tile (period 4 px divides every tile size, so it tiles). */
export const threads = (g, w, h, a = 0.06, dir = 'v') => {
  g.save();
  g.globalAlpha = a; g.fillStyle = '#000';
  if (dir !== 'h') for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
  if (dir !== 'v') for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  g.fillStyle = '#fff';
  if (dir !== 'h') for (let x = 2; x < w; x += 4) g.fillRect(x, 0, 1, h);
  if (dir !== 'v') for (let y = 2; y < h; y += 4) g.fillRect(0, y, w, 1);
  g.restore();
};
/** Diagonal twill lines (period 4 px along x). */
export const twill = (g, w, h, a = 0.07) => {
  g.save(); g.globalAlpha = a; g.strokeStyle = '#000'; g.lineWidth = 1;
  for (let i = -h; i < w + h; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); }
  g.restore();
};

export const P = {
  solid: (c) => (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); },

  /** Vertical stripes (with fine woven threads). widths are relative; the set repeats `n` times across the tile. */
  stripes: ({ cols, widths, n = 1, weave = true }) => (g, w, h) => {
    const ws = widths || cols.map(() => 1);
    const tot = ws.reduce((s, x) => s + x, 0);
    let x = 0;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < cols.length; i++) {
        const sw = (ws[i] / tot) * (w / n);
        g.fillStyle = cols[i]; g.fillRect(Math.round(x), 0, Math.ceil(sw) + 1, h); x += sw;
      }
    }
    if (weave) threads(g, w, h, 0.07, 'v');
  },

  /** Horizontal bands (tape, deck chairs rotated, etc). */
  bands: ({ cols, widths, n = 1, weave = true }) => (g, w, h) => {
    const ws = widths || cols.map(() => 1);
    const tot = ws.reduce((s, x) => s + x, 0);
    let y = 0;
    for (let k = 0; k < n; k++) for (let i = 0; i < cols.length; i++) {
      const sh = (ws[i] / tot) * (h / n);
      g.fillStyle = cols[i]; g.fillRect(0, Math.round(y), w, Math.ceil(sh) + 1); y += sh;
    }
    if (weave) threads(g, w, h, 0.07, 'h');
  },

  /** Regency stripe wallpaper with sprigs, flocked dots and little diamonds between the stripes. */
  wallpaper: ({ bg, stripe, thin, sprig, leaf }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const n = 2; const cw = w / n;
    for (let k = 0; k < n; k++) {
      const x0 = k * cw;
      g.fillStyle = stripe; g.fillRect(x0 + cw * 0.06, 0, cw * 0.26, h);
      // flocked pinstripe dots inside the wide stripe
      g.fillStyle = shade(stripe, 0.25); g.globalAlpha = 0.55;
      for (let j = 0; j < 14; j++) { g.fillRect(x0 + cw * 0.09 + (j % 2) * cw * 0.1, (j + 0.5) * (h / 14), 2, 2); g.fillRect(x0 + cw * 0.2 + (j % 2) * cw * 0.07, (j + 0.2) * (h / 14), 2, 2); }
      g.globalAlpha = 1;
      g.fillStyle = thin; g.fillRect(x0 + cw * 0.40, 0, cw * 0.035, h); g.fillRect(x0 + cw * 0.025, 0, cw * 0.02, h); g.fillRect(x0 + cw * 0.34, 0, cw * 0.02, h);
      // little diamonds on the thin line
      g.fillStyle = shade(thin, -0.15);
      for (let j = 0; j < 7; j++) { const yy = (j + 0.5) * (h / 7); g.beginPath(); g.moveTo(x0 + cw * 0.4175, yy - 4); g.lineTo(x0 + cw * 0.4175 + 3, yy); g.lineTo(x0 + cw * 0.4175, yy + 4); g.lineTo(x0 + cw * 0.4175 - 3, yy); g.fill(); }
      // sprigs (half-drop)
      for (let j = 0; j < 2; j++) {
        const cx = x0 + cw * 0.68; const cy = (j + (k % 2) * 0.5) * (h / 2) + h / 8;
        g.fillStyle = leaf;
        for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 7, cy + 6, 7, 3.2, s * 0.6, 0, Math.PI * 2); g.fill(); }
        g.strokeStyle = shade(leaf, -0.35); g.lineWidth = 1; g.beginPath(); g.moveTo(cx, cy + 10); g.lineTo(cx, cy + 1); g.stroke();
        g.fillStyle = sprig; wrapCircle(g, cx, cy - 2, 6, w, h);
        g.fillStyle = shade(sprig, 0.45); wrapCircle(g, cx, cy - 2, 2.4, w, h);
        g.fillStyle = shade(sprig, -0.3); for (let a = 0; a < 5; a++) wrapCircle(g, cx + Math.cos(a * 1.26) * 4.6, cy - 2 + Math.sin(a * 1.26) * 4.6, 1, w, h);
      }
      // tiny leaf pairs in the bare field
      g.fillStyle = leaf; g.globalAlpha = 0.7;
      for (let j = 0; j < 4; j++) { const yy = (j + 0.25 + (k % 2) * 0.5) * (h / 4); g.beginPath(); g.ellipse(x0 + cw * 0.5 + 3, yy, 3.2, 1.4, -0.5, 0, Math.PI * 2); g.ellipse(x0 + cw * 0.5 - 3, yy, 3.2, 1.4, 0.5, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
    }
    void r;
  },

  /** Floorboards: planks of five tones with grain, knots, bevels, nail heads and staggered joints. */
  planks: ({ base, alt, seam, rows = 6 }) => (g, w, h, r) => {
    const rh = h / rows;
    const tones = [base, alt, mixHex(base, alt, 0.5), shade(base, 0.07), shade(alt, -0.06)];
    for (let j = 0; j < rows; j++) {
      const off = r() * w; const y0 = j * rh;
      for (let k = 0; k < 2; k++) {
        const x0 = off + k * (w / 2); const pw = w / 2;
        const tone = tones[r.int(tones.length)];
        g.fillStyle = tone; wrapRect(g, x0, y0, pw, rh, w, h);
        // grain streaks along the plank
        g.strokeStyle = seam; g.lineWidth = 1;
        for (let i = 0; i < 9; i++) {
          const yy = y0 + 3 + r() * (rh - 6); const len = 14 + r() * 40; const sx = x0 + r() * (pw - len); const wob = (r() - 0.5) * 3;
          g.globalAlpha = 0.1 + r() * 0.14;
          wrap9(w, h, (ox, oy) => { g.beginPath(); g.moveTo(sx + ox, yy + oy); g.quadraticCurveTo(sx + len / 2 + ox, yy + wob + oy, sx + len + ox, yy + oy); g.stroke(); });
        }
        g.globalAlpha = 1;
        // knot
        if (r() < 0.32) {
          const kx = x0 + pw * (0.2 + r() * 0.6); const ky = y0 + rh * (0.3 + r() * 0.4);
          g.strokeStyle = shade(tone, -0.28); g.lineWidth = 1; g.globalAlpha = 0.8;
          for (let q = 3; q >= 1; q--) wrapEllipse(g, kx, ky, q * 2.6, q * 1.4, 0, w, h, true);
          g.fillStyle = shade(tone, -0.4); wrapEllipse(g, kx, ky, 1.6, 1, 0, w, h);
          g.globalAlpha = 1;
        }
        // top bevel highlight + nail heads at both ends
        g.fillStyle = 'rgba(255,255,255,0.16)'; wrapRect(g, x0, y0 + 2, pw, 1, w, h);
        g.fillStyle = shade(seam, 0.1);
        for (const nx of [x0 + 6, x0 + pw - 6]) for (const ny of [y0 + rh * 0.28, y0 + rh * 0.72]) wrapCircle(g, nx, ny, 0.9, w, h);
        // end-joint
        g.fillStyle = seam; wrapRect(g, x0, y0, 2, rh, w, h);
        g.fillStyle = 'rgba(255,255,255,0.12)'; wrapRect(g, x0 + 2, y0, 1, rh, w, h);
      }
      g.fillStyle = seam; g.fillRect(0, y0, w, 2);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y0 + 2, w, 1);
    }
  },

  /** Kilim rug (not repeating): border, stepped diamonds, zig-zags, woven weft lines and fringe. */
  kilim: ({ field, border, a, b, c, ink }) => (g, w, h) => {
    g.fillStyle = border; g.fillRect(0, 0, w, h);
    const m = w * 0.07;
    g.fillStyle = ink; g.fillRect(m * 0.5, m * 0.5, w - m, h - m);
    g.fillStyle = border; g.fillRect(m * 0.75, m * 0.75, w - m * 1.5, h - m * 1.5);
    // zigzag border
    g.fillStyle = a;
    const zz = 14;
    for (let i = 0; i < zz; i++) {
      const x0 = m + (i / zz) * (w - 2 * m); const x1 = m + ((i + 0.5) / zz) * (w - 2 * m); const x2 = m + ((i + 1) / zz) * (w - 2 * m);
      for (const [yb, dir] of [[m * 1.9, -1], [h - m * 1.9, 1]]) {
        g.beginPath(); g.moveTo(x0, yb); g.lineTo(x1, yb + dir * m * 0.8); g.lineTo(x2, yb); g.closePath(); g.fill();
      }
    }
    // side zigzags
    g.fillStyle = b;
    const zv = 16;
    for (let i = 0; i < zv; i++) {
      const y0 = m * 2 + (i / zv) * (h - 4 * m); const y1 = m * 2 + ((i + 0.5) / zv) * (h - 4 * m); const y2 = m * 2 + ((i + 1) / zv) * (h - 4 * m);
      for (const [xb, dir] of [[m * 1.45, 1], [w - m * 1.45, -1]]) { g.beginPath(); g.moveTo(xb, y0); g.lineTo(xb + dir * m * 0.45, y1); g.lineTo(xb, y2); g.closePath(); g.fill(); }
    }
    g.fillStyle = field; g.fillRect(m * 2, m * 2.1, w - m * 4, h - m * 4.2);
    // field: tiny woven dots
    g.fillStyle = shade(field, -0.12);
    for (let j = 0; j < 40; j++) for (let i = 0; i < 28; i++) if ((i + j) % 2 === 0) g.fillRect(m * 2 + 3 + i * ((w - m * 4 - 6) / 28), m * 2.1 + 3 + j * ((h - m * 4.2 - 6) / 40), 2, 2);
    // diamonds
    const cx = w / 2;
    const rows = [h * 0.32, h * 0.5, h * 0.68];
    rows.forEach((cy, k) => {
      const big = k === 1 ? 1.25 : 0.9;
      for (const [s, col] of [[1, ink], [0.82, k === 1 ? a : b], [0.55, c], [0.3, ink], [0.16, a]]) {
        const rx = w * 0.3 * big * s; const ry = h * 0.11 * big * s;
        g.fillStyle = col; g.beginPath(); g.moveTo(cx, cy - ry); g.lineTo(cx + rx, cy); g.lineTo(cx, cy + ry); g.lineTo(cx - rx, cy); g.closePath(); g.fill();
      }
      for (const sx of [-1, 1]) {
        const x = cx + sx * w * 0.36;
        g.fillStyle = b; g.beginPath(); g.moveTo(x, cy - h * 0.05); g.lineTo(x + w * 0.05, cy); g.lineTo(x, cy + h * 0.05); g.lineTo(x - w * 0.05, cy); g.closePath(); g.fill();
        g.fillStyle = ink; g.fillRect(x - 2, cy - 2, 4, 4);
      }
    });
    // weft lines + worn patches
    g.save(); g.globalAlpha = 0.09; g.fillStyle = '#000'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1); g.fillStyle = '#fff'; for (let y = 2; y < h; y += 4) g.fillRect(0, y, w, 1); g.restore();
    g.fillStyle = ink; for (let x = 0; x < w; x += 6) { g.fillRect(x, 0, 2, 3); g.fillRect(x, h - 3, 2, 3); }
  },

  /** Polka dots in a staggered grid, printed slightly off-register (a darker offset behind each dot). */
  dots: ({ bg, fg, n = 4, r = 0.18 }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const s = w / n;
    g.fillStyle = shade(bg, -0.14);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) wrapCircle(g, (i + (j % 2) * 0.5) * s + s / 4 + 1.4, j * s + s / 2 + 1.4, s * r, w, h);
    g.fillStyle = fg;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) wrapCircle(g, (i + (j % 2) * 0.5) * s + s / 4, j * s + s / 2, s * r, w, h);
    g.fillStyle = shade(fg, -0.1); g.globalAlpha = 0.5;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) wrapCircle(g, (i + (j % 2) * 0.5) * s + s / 4 + s * r * 0.3, j * s + s / 2 + s * r * 0.3, s * r * 0.35, w, h);
    g.globalAlpha = 1;
    threads(g, w, h, 0.045, 'both');
  },

  /** Gingham / buffalo check. */
  check: ({ a, b, n = 4 }) => (g, w, h) => {
    g.fillStyle = a; g.fillRect(0, 0, w, h);
    const s = w / n;
    g.fillStyle = mixHex(a, b, 0.5);
    for (let i = 0; i < n; i++) { g.fillRect(i * s, 0, s / 2, h); g.fillRect(0, i * s, w, s / 2); }
    g.fillStyle = b;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g.fillRect(i * s, j * s, s / 2, s / 2);
    threads(g, w, h, 0.07, 'both');
  },

  /** Checkerboard tiles: each tile a hair different, glazed highlight, grout and a few scuffs. */
  checker: ({ a, b, n = 4, grout }) => (g, w, h, r) => {
    const s = w / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const c = (i + j) % 2 ? a : b; g.fillStyle = jit(c, 0.035, r); g.fillRect(i * s, j * s, s, s);
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(i * s + 2, j * s + 2, s - 4, 2); g.fillRect(i * s + 2, j * s + 2, 2, s - 4);
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(i * s + 2, j * s + s - 3, s - 4, 1.5); g.fillRect(i * s + s - 3, j * s + 2, 1.5, s - 4);
    }
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1;
    for (let i = 0; i < 7; i++) { const x = r() * w; const y = r() * h; wrap9(w, h, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + (r() - 0.5) * 9, y + oy + (r() - 0.5) * 9); g.stroke(); }); }
    if (grout) { g.fillStyle = grout; for (let i = 0; i < n; i++) { g.fillRect(i * s - 0.75, 0, 1.5, h); g.fillRect(0, i * s - 0.75, w, 1.5); } g.fillRect(w - 0.75, 0, 1.5, h); g.fillRect(0, h - 0.75, w, 1.5); }
  },

  /** Houndstooth-ish tweed: two-tone broken check with twill. */
  houndstooth: ({ a, b, n = 6 }) => (g, w, h) => {
    g.fillStyle = a; g.fillRect(0, 0, w, h);
    const s = w / n;
    g.fillStyle = b;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * s; const y = j * s;
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x + s / 2, y); g.lineTo(x + s, y + s / 2); g.lineTo(x + s, y + s); g.lineTo(x + s / 2, y + s / 2); g.lineTo(x + s / 4, y + s * 0.75); g.lineTo(x, y + s / 2);
      g.closePath(); g.fill();
    }
    twill(g, w, h, 0.1);
  },

  /** Chevrons (knit). */
  chevron: ({ cols, n = 3 }) => (g, w, h) => {
    const band = h / (n * cols.length);
    for (let k = -1; k < n * cols.length + 2; k++) {
      g.fillStyle = cols[((k % cols.length) + cols.length) % cols.length];
      g.beginPath();
      const y = k * band;
      g.moveTo(0, y); g.lineTo(w / 2, y + band * 1.5); g.lineTo(w, y); g.lineTo(w, y + band); g.lineTo(w / 2, y + band * 2.5); g.lineTo(0, y + band);
      g.closePath(); g.fill();
    }
    // knit stitches: tiny v marks
    g.save(); g.globalAlpha = 0.1; g.strokeStyle = '#000'; g.lineWidth = 1;
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2, y + 3); g.lineTo(x + 4, y); g.stroke(); }
    g.restore();
  },

  /** Tintable basket weave (grey tones, multiplied by the vertex colour): three threads per cell. */
  weave: ({ n = 8, lo = 0.84 } = {}) => (g, w, h) => {
    const L = Math.round(255 * lo); const M = Math.round(255 * (1 + lo) / 2);
    g.fillStyle = `rgb(${L - 18},${L - 18},${L - 18})`; g.fillRect(0, 0, w, h);
    const s = w / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const vert = (i + j) % 2;
      for (let t = 0; t < 3; t++) {
        const v = t === 1 ? 255 : M + 6;
        g.fillStyle = `rgb(${v},${v},${v})`;
        if (vert) g.fillRect(i * s + 1 + t * ((s - 2) / 3), j * s + 1, (s - 2) / 3 - 0.8, s - 2);
        else g.fillRect(i * s + 1, j * s + 1 + t * ((s - 2) / 3), s - 2, (s - 2) / 3 - 0.8);
      }
    }
  },

  /** Tintable wood grain: wavy streaks of varied weight, fine pores and ringed knots. */
  wood: ({ n = 7 } = {}) => (g, w, h, r) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const y0 = (i + 0.5) * (h / n); const amp = 3 + r() * 6; const ph = r() * 6; const lw = 1.5 + r() * 2.8; const v = 200 + Math.floor(r() * 34);
      g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = lw;
      for (const dy of [-h, 0, h]) {
        g.beginPath();
        for (let x = 0; x <= w; x += 6) { const y = y0 + dy + Math.sin((x / w) * Math.PI * 2 * 2 + ph) * amp + Math.sin((x / w) * Math.PI * 2 * 5 + ph * 2) * amp * 0.25; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
      }
    }
    // fine pores
    g.fillStyle = 'rgb(212,212,212)';
    for (let i = 0; i < 70; i++) { const x = r() * w; const y = r() * h; wrapRect(g, x, y, 3 + r() * 6, 1, w, h); }
    // knots
    for (let i = 0; i < 2; i++) {
      const x = r() * w; const y = r() * h;
      g.strokeStyle = 'rgb(196,196,196)'; g.lineWidth = 1.2;
      for (let q = 4; q >= 1; q--) wrapEllipse(g, x, y, q * 3.2, q * 1.7, 0, w, h, true);
      g.fillStyle = 'rgb(184,184,184)'; wrapEllipse(g, x, y, 2.2, 1.2, 0, w, h);
    }
  },

  /** Book spine (tintable, not repeating): gilt bands, a title block, small ornament and a worn top edge. */
  spine: ({ band = '#f6e7b8', style = 0 } = {}) => (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgb(205,205,205)';
    g.fillRect(0, h * 0.1, w, h * 0.04); g.fillRect(0, h * 0.86, w, h * 0.04);
    if (style === 1) {
      g.fillRect(0, h * 0.16, w, h * 0.02); g.fillRect(0, h * 0.82, w, h * 0.02);
      g.fillStyle = band; g.fillRect(w * 0.15, h * 0.3, w * 0.7, h * 0.4);
      g.fillStyle = 'rgb(200,200,200)'; g.fillRect(w * 0.25, h * 0.4, w * 0.5, h * 0.05); g.fillRect(w * 0.25, h * 0.52, w * 0.5, h * 0.05);
    } else if (style === 2) {
      g.fillStyle = band; g.fillRect(w * 0.1, h * 0.2, w * 0.8, h * 0.08);
      g.fillStyle = 'rgb(214,214,214)'; for (let i = 0; i < 4; i++) g.fillRect(w * 0.3, h * (0.38 + i * 0.1), w * 0.4, h * 0.04);
    } else {
      g.fillStyle = band; g.fillRect(w * 0.2, h * 0.3, w * 0.6, h * 0.22);
      g.fillStyle = 'rgb(214,214,214)'; g.fillRect(w * 0.3, h * 0.62, w * 0.4, h * 0.06);
      g.fillStyle = 'rgb(224,224,224)'; g.beginPath(); g.arc(w / 2, h * 0.76, w * 0.12, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgb(230,230,230)'; g.fillRect(0, 0, w, h * 0.03);
  },

  /** Hedge leaves: overlapping leaf shapes in four greens with midribs, over a dark underlayer. */
  leafy: ({ base, light, dark, n = 70 }) => (g, w, h, r) => {
    g.fillStyle = dark; g.fillRect(0, 0, w, h);
    g.fillStyle = shade(dark, -0.3); for (let i = 0; i < n * 0.6; i++) wrapCircle(g, r() * w, r() * h, w * 0.07 * (0.6 + r() * 0.6), w, h);
    for (const [col, rad, cnt, rib] of [[shade(base, -0.12), 0.1, n * 0.8, false], [base, 0.085, n, true], [light, 0.055, n * 0.8, true], [shade(light, 0.25), 0.03, n * 0.5, false]]) {
      for (let i = 0; i < cnt; i++) {
        const x = r() * w; const y = r() * h; const rr = w * rad * (0.7 + r() * 0.6); const a = r() * Math.PI;
        g.fillStyle = col; wrapEllipse(g, x, y, rr * 1.15, rr * 0.62, a, w, h);
        if (rib) {
          g.strokeStyle = shade(col, -0.28); g.lineWidth = 1;
          wrap9(w, h, (ox, oy) => { g.beginPath(); g.moveTo(x + ox - Math.cos(a) * rr * 0.95, y + oy - Math.sin(a) * rr * 0.95); g.lineTo(x + ox + Math.cos(a) * rr * 0.95, y + oy + Math.sin(a) * rr * 0.95); g.stroke(); });
        }
      }
    }
  },

  /** Lawn: mowing stripes, blades and clover flecks. */
  lawn: ({ a, b, fleck }) => (g, w, h, r) => {
    g.fillStyle = a; g.fillRect(0, 0, w / 2, h); g.fillStyle = b; g.fillRect(w / 2, 0, w / 2, h);
    g.lineWidth = 1;
    for (let i = 0; i < 360; i++) {
      const x = r() * w; const y = r() * h; const c = (x % w) < w / 2 ? b : a; const up = r() < 0.5;
      g.strokeStyle = up ? shade(c, 0.22) : shade(c, -0.2); g.globalAlpha = 0.55;
      const dx = (r() - 0.5) * 3; const len = 3 + r() * 5;
      wrap9(w, h, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + dx, y + oy - len); g.stroke(); });
    }
    g.globalAlpha = 1;
    g.fillStyle = fleck;
    for (let i = 0; i < 50; i++) { g.globalAlpha = 0.5; wrapCircle(g, r() * w, r() * h, 1.6 + r() * 2, w, h); }
    // clover trios and tiny daisies
    g.globalAlpha = 0.85; g.fillStyle = shade(b, -0.22);
    for (let i = 0; i < 6; i++) { const x = r() * w; const y = r() * h; for (let k = 0; k < 3; k++) wrapCircle(g, x + Math.cos(k * 2.1) * 2.6, y + Math.sin(k * 2.1) * 2.6, 1.8, w, h); }
    g.fillStyle = '#fbf7ee'; for (let i = 0; i < 4; i++) wrapCircle(g, r() * w, r() * h, 1.6, w, h);
    g.globalAlpha = 1;
  },

  soil: ({ base, speck, stone }) => (g, w, h, r) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = shade(base, 0.08); for (let i = 0; i < 40; i++) wrapCircle(g, r() * w, r() * h, 3 + r() * 5, w, h);
    g.fillStyle = speck; for (let i = 0; i < 140; i++) wrapCircle(g, r() * w, r() * h, 1 + r() * 2.5, w, h);
    g.strokeStyle = shade(speck, -0.2); g.lineWidth = 1;
    for (let i = 0; i < 6; i++) { const x = r() * w; const y = r() * h; wrap9(w, h, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.bezierCurveTo(x + ox + 6, y + oy - 3, x + ox + 10, y + oy + 4, x + ox + 16, y + oy + 1); g.stroke(); }); }
    for (let i = 0; i < 10; i++) {
      const x = r() * w; const y = r() * h; const rr = 3 + r() * 4;
      g.fillStyle = stone; wrapCircle(g, x, y, rr, w, h);
      g.fillStyle = shade(stone, 0.3); wrapCircle(g, x - rr * 0.3, y - rr * 0.3, rr * 0.4, w, h);
    }
  },

  /** Bricks: each its own tone, bevelled, speckled, the odd chipped corner, sandy mortar. */
  bricks: ({ brick, alt, mortar, rows = 8, cols = 4 }) => (g, w, h, r) => {
    g.fillStyle = mortar; g.fillRect(0, 0, w, h);
    g.fillStyle = shade(mortar, -0.18); g.globalAlpha = 0.5; for (let i = 0; i < 140; i++) g.fillRect(r() * w, r() * h, 1, 1); g.globalAlpha = 1;
    const bh = h / rows; const bw = w / cols;
    for (let j = 0; j < rows; j++) for (let i = -1; i < cols; i++) {
      const x = i * bw + (j % 2) * bw / 2; const y = j * bh;
      const tone = r() < 0.3 ? alt : mixHex(brick, alt, r() * 0.35);
      g.fillStyle = jit(tone, 0.05, r); wrapRect(g, x + 2, y + 2, bw - 4, bh - 4, w, h);
      g.fillStyle = 'rgba(255,255,255,0.2)'; wrapRect(g, x + 2, y + 2, bw - 4, 1.5, w, h);
      g.fillStyle = 'rgba(0,0,0,0.2)'; wrapRect(g, x + 2, y + bh - 3.5, bw - 4, 1.5, w, h);
      g.fillStyle = 'rgba(0,0,0,0.12)'; for (let k = 0; k < 5; k++) wrapRect(g, x + 4 + r() * (bw - 10), y + 4 + r() * (bh - 9), 1.5, 1.5, w, h);
      g.fillStyle = 'rgba(255,255,255,0.1)'; for (let k = 0; k < 3; k++) wrapRect(g, x + 4 + r() * (bw - 10), y + 4 + r() * (bh - 9), 2, 1.5, w, h);
      if (r() < 0.12) { g.fillStyle = mortar; wrapRect(g, x + bw - 8, y + 2, 6, 4, w, h); }
    }
  },

  /** Flagstone (not repeating): irregular cobbles with cracks, blotches and moss. */
  flag: ({ base, dark, light }) => (g, w, h, r) => {
    g.fillStyle = dark; g.fillRect(0, 0, w, h);
    const N = 4; const seeds = []; // seeds[j * N + i]: one per grid cell, so a pixel only checks its 3 × 3 cells
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) seeds.push([(i + 0.2 + r() * 0.6) * w / N, (j + 0.2 + r() * 0.6) * h / N, r()]);
    const img = g.getImageData(0, 0, w, h); const d = img.data;
    const cb = [base, light, shade(base, -0.07), shade(light, -0.06)].map((c) => hexToRgb(c)); const dk = hexToRgb(dark);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let d1 = 1e9; let d2 = 1e9; let k1 = 0;
      const ci = Math.floor((x / w) * N); const cj = Math.floor((y / h) * N);
      for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) {
        const ii = ci + oi; const jj = cj + oj; const k = ((jj + N) % N) * N + ((ii + N) % N);
        const dx = x - (seeds[k][0] + Math.floor(ii / N) * w); const dy = y - (seeds[k][1] + Math.floor(jj / N) * h); const dd = dx * dx + dy * dy;
        if (dd < d1) { d2 = d1; d1 = dd; k1 = k; } else if (dd < d2) d2 = dd;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1); const i = (y * w + x) * 4;
      const c = edge < 3 ? dk : cb[Math.floor(seeds[k1][2] * 4)];
      const sh = edge < 3 ? 1 : edge < 6 ? 0.92 : 1;
      d[i] = c[0] * sh; d[i + 1] = c[1] * sh; d[i + 2] = c[2] * sh; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = '#7fa05a'; g.globalAlpha = 0.5; for (let i = 0; i < 14; i++) wrapCircle(g, r() * w, r() * h, 1 + r() * 2, w, h); g.globalAlpha = 1;
  },

  /** Paint splatters on a cloth (tiles): blobs with satellite drops, drips and a halftone speckle. */
  splatter: ({ bg, cols, n = 26 }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[i % cols.length];
      const x = r() * w; const y = r() * h; const s = 4 + r() * 16;
      wrapCircle(g, x, y, s, w, h);
      for (let k = 0; k < 6; k++) { const a = r() * Math.PI * 2; const d = s * (1.2 + r() * 1.6); wrapCircle(g, x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + r() * s * 0.25, w, h); }
      if (r() < 0.4) wrapRect(g, x - 1.5, y, 3, s * (1.6 + r()), w, h);
      g.fillStyle = shade(cols[i % cols.length], 0.35); g.globalAlpha = 0.5; wrapCircle(g, x - s * 0.3, y - s * 0.3, s * 0.3, w, h); g.globalAlpha = 1;
    }
    g.fillStyle = 'rgba(0,0,0,0.06)'; for (let i = 0; i < 60; i++) wrapCircle(g, r() * w, r() * h, 1, w, h);
  },

  /** Colour-swatch wall: grid of paint chips with a name strip (repeating). */
  swatches: ({ bg, cols, nx = 4, ny = 4 }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const sx = w / nx; const sy = h / ny;
    let k = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = cols[k++ % cols.length];
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(i * sx + sx * 0.1 + 1.5, j * sy + sy * 0.08 + 1.5, sx * 0.8, sy * 0.66);
      g.fillStyle = c; g.fillRect(i * sx + sx * 0.1, j * sy + sy * 0.08, sx * 0.8, sy * 0.66);
      g.fillStyle = shade(c, -0.12); g.fillRect(i * sx + sx * 0.1, j * sy + sy * 0.08 + sy * 0.4, sx * 0.8, sy * 0.26);
      g.fillStyle = shade(c, 0.3); g.fillRect(i * sx + sx * 0.1, j * sy + sy * 0.08, sx * 0.8, sy * 0.1);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(i * sx + sx * 0.1, j * sy + sy * 0.8, sx * 0.5, 2); g.fillRect(i * sx + sx * 0.1, j * sy + sy * 0.88, sx * 0.3, 1.5);
      g.fillStyle = '#d9d2c4'; g.beginPath(); g.arc(i * sx + sx * 0.5, j * sy + sy * 0.04, 1.4, 0, Math.PI * 2); g.fill(); // pin
    }
  },

  /** Abstract paintings (not repeating). style: blocks | circles | waves | sunset | stripes. Canvas weave on top. */
  art: ({ style, cols, bg }) => (g, w, h, r) => {
    g.fillStyle = bg || '#f3ece0'; g.fillRect(0, 0, w, h);
    if (style === 'blocks') {
      const xs = [0, 0.32, 0.38, 0.8, 1].map((x) => x * w); const ys = [0, 0.25, 0.6, 0.66, 1].map((y) => y * h);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        g.fillStyle = (i * 3 + j) % 4 === 0 ? cols[(i + j) % cols.length] : '#f3ece0';
        g.fillRect(xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j]);
      }
      g.fillStyle = '#1d1b22';
      for (const x of xs.slice(1, -1)) g.fillRect(x - 3, 0, 6, h);
      for (const y of ys.slice(1, -1)) g.fillRect(0, y - 3, w, 6);
    } else if (style === 'circles') {
      for (let i = 0; i < 7; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath(); g.arc(w * (0.2 + r() * 0.6), h * (0.2 + r() * 0.6), w * (0.08 + r() * 0.2), 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(w * (0.3 + r() * 0.4), h * (0.3 + r() * 0.4), w * (0.05 + r() * 0.1), 0, Math.PI * 2); g.stroke(); }
    } else if (style === 'waves') {
      for (let i = 0; i < 6; i++) {
        g.fillStyle = cols[i % cols.length]; g.beginPath(); g.moveTo(0, h);
        for (let x = 0; x <= w; x += 6) g.lineTo(x, h * (0.15 + i * 0.15) + Math.sin(x / w * 6.28 * 1.5 + i) * h * 0.05);
        g.lineTo(w, h); g.closePath(); g.fill();
      }
    } else if (style === 'sunset') {
      cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, (i / cols.length) * h * 0.7, w, h); });
      g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(w * 0.5, h * 0.62, w * 0.2, Math.PI, 0); g.fill();
      g.fillStyle = cols[cols.length - 1]; g.fillRect(0, h * 0.62, w, h * 0.38);
    } else {
      cols.forEach((c, i) => { g.fillStyle = c; g.fillRect((i / cols.length) * w, 0, w / cols.length + 1, h); });
    }
    // canvas weave + a dab or two of impasto
    g.save(); g.globalAlpha = 0.05; g.fillStyle = '#000'; for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h); for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1); g.restore();
    g.fillStyle = 'rgba(255,255,255,0.18)'; for (let i = 0; i < 5; i++) g.fillRect(r() * w, r() * h, 6 + r() * 14, 2);
  },

  /** A window onto a sunny day (not repeating). */
  window: ({ sky, cloud, frame, hill }) => (g, w, h) => {
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = shade(sky, 0.25); g.fillRect(0, h * 0.5, w, h * 0.2);
    g.fillStyle = shade(hill, 0.2); g.beginPath(); g.moveTo(0, h * 0.8); g.quadraticCurveTo(w * 0.2, h * 0.5, w * 0.45, h * 0.72); g.lineTo(w * 0.45, h); g.lineTo(0, h); g.fill();
    g.fillStyle = hill; g.beginPath(); g.moveTo(0, h); g.quadraticCurveTo(w * 0.3, h * 0.55, w * 0.65, h * 0.8); g.quadraticCurveTo(w * 0.85, h * 0.7, w, h * 0.75); g.lineTo(w, h); g.closePath(); g.fill();
    g.fillStyle = shade(hill, -0.2); for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(w * (0.1 + i * 0.15), h * (0.86 + (i % 2) * 0.05), 5, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = cloud; for (const [x, y, s] of [[0.3, 0.25, 1], [0.7, 0.4, 0.7]]) { g.beginPath(); g.ellipse(w * x, h * y, w * 0.14 * s, h * 0.05 * s, 0, 0, Math.PI * 2); g.ellipse(w * (x + 0.07), h * (y - 0.03), w * 0.09 * s, h * 0.05 * s, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = frame; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10); g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h); g.fillRect(w / 2 - 5, 0, 10, h); g.fillRect(0, h / 2 - 5, w, 10);
    g.fillStyle = shade(frame, -0.12); g.fillRect(0, h - 10, w, 3); g.fillRect(w / 2 + 1, 0, 3, h); g.fillRect(0, h / 2 + 1, w, 3);
  },

  /** TV screen (not repeating). */
  screen: ({ bg, glare }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = glare; g.beginPath(); g.moveTo(w * 0.55, 0); g.lineTo(w * 0.75, 0); g.lineTo(w * 0.45, h); g.lineTo(w * 0.25, h); g.closePath(); g.fill();
  },

  /** Paint-can / jar label (not repeating, wraps around a cylinder). */
  label: ({ bg, band, text }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = band; g.fillRect(0, h * 0.3, w, h * 0.4);
    g.fillStyle = text; g.fillRect(w * 0.1, h * 0.45, w * 0.3, h * 0.1); g.fillRect(w * 0.6, h * 0.45, w * 0.3, h * 0.1);
    g.fillStyle = shade(band, -0.2); g.fillRect(0, h * 0.62, w, h * 0.08);
    g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
    g.fillStyle = 'rgba(0,0,0,0.08)'; for (let i = 0; i < 5; i++) g.fillRect(w * (0.1 + i * 0.17), h * 0.12, w * 0.1, 2);
  },

  /** Terracotta rings (tintable), with a darker rim and a glaze streak. */
  rings: ({ n = 3 } = {}) => (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgb(222,222,222)';
    for (let i = 0; i < n; i++) g.fillRect(0, (i + 0.4) * (h / n), w, h / n * 0.2);
    g.fillStyle = 'rgb(236,236,236)'; for (let i = 0; i < n; i++) g.fillRect(0, (i + 0.4) * (h / n) + h / n * 0.2, w, 1);
    g.fillStyle = 'rgb(214,214,214)'; for (let i = 0; i < 5; i++) g.fillRect((i * 0.21 + 0.05) * w, h * 0.1, 3, h * 0.8);
  },

  /** Drop cloth folds (tiles): crumpled creases, dabs of colour and weave. */
  cloth: ({ bg, fold, cols }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fold; g.lineWidth = 3;
    for (let i = 0; i < 5; i++) { const y = (i + 0.5) * h / 5; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 10, w * 0.6, y - 10, w, y); g.stroke(); }
    g.lineWidth = 1.2; g.globalAlpha = 0.6;
    for (let i = 0; i < 9; i++) { const x = r() * w; const y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30); g.stroke(); }
    g.globalAlpha = 1;
    for (let i = 0; i < 18; i++) { g.fillStyle = cols[i % cols.length]; const x = r() * w; const y = r() * h; const rr = 2 + r() * 8; wrapCircle(g, x, y, rr, w, h); if (r() < 0.5) wrapRect(g, x - 1, y, 2, rr * 2.4, w, h); }
    threads(g, w, h, 0.05, 'both');
  },

  /** Herringbone parquet: every block its own tone, with a grain line and bevel. */
  herringbone: ({ a, b, seam }) => (g, w, h, r) => {
    g.fillStyle = seam; g.fillRect(0, 0, w, h);
    const s = w / 6;
    for (let j = -2; j < 8; j++) for (let i = -2; i < 8; i++) {
      const x = i * s; const y = j * s * 2 + (i % 2) * s;
      g.fillStyle = jit((i + j) % 2 ? a : b, 0.05, r);
      g.save(); g.translate(x, y); g.rotate(i % 2 ? Math.PI / 4 : -Math.PI / 4); g.fillRect(-s * 0.7, -s * 0.33, s * 1.4 - 2, s * 0.66 - 2);
      g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(-s * 0.6, -s * 0.05, s * 1.1, 1); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(-s * 0.7, -s * 0.33, s * 1.4 - 2, 1.5);
      g.restore();
    }
  },

  /** Scattered flowers over a leafy ground colour (flower bed): petals with a centre and a dark outline ring. */
  blooms: ({ bg, cols, leaf, n = 40 }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = shade(bg, -0.15); for (let i = 0; i < n; i++) wrapCircle(g, r() * w, r() * h, 3 + r() * 5, w, h);
    g.fillStyle = leaf; for (let i = 0; i < n; i++) wrapEllipse(g, r() * w, r() * h, 5 + r() * 5, 2.6 + r() * 2, r() * 3, w, h);
    g.strokeStyle = shade(leaf, -0.3); g.lineWidth = 1;
    for (let i = 0; i < n * 0.6; i++) { const x = r() * w; const y = r() * h; wrap9(w, h, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + 7, y + oy - 3); g.stroke(); }); }
    for (let i = 0; i < n; i++) {
      const x = r() * w; const y = r() * h; const c = cols[i % cols.length]; const big = 3.4 + r() * 1.6;
      g.fillStyle = shade(c, -0.3); for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; wrapCircle(g, x + Math.cos(a) * 4.2, y + Math.sin(a) * 4.2, big + 0.8, w, h); }
      g.fillStyle = c; for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; wrapCircle(g, x + Math.cos(a) * 4, y + Math.sin(a) * 4, big, w, h); }
      g.fillStyle = '#ffd23f'; wrapCircle(g, x, y, 2.1, w, h);
      g.fillStyle = shade('#ffd23f', -0.35); wrapCircle(g, x + 0.6, y + 0.6, 0.8, w, h);
    }
  },

  /** Plaster / painted wall (tintable greys): mottled trowel marks, hairline cracks, scuffs. */
  plaster: ({ base = 245, mottle = 0.05 } = {}) => (g, w, h, r) => {
    g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const v = r() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${mottle * (0.5 + r())})`;
      wrapEllipse(g, r() * w, r() * h, 10 + r() * 24, 6 + r() * 14, r() * 3, w, h);
    }
    g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { const x = r() * w; const y = r() * h; const a = r() * 6; wrap9(w, h, (ox, oy) => { g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + Math.cos(a) * 14, y + oy + Math.sin(a) * 14 + 4, x + ox + Math.cos(a) * 26, y + oy + Math.sin(a) * 26); g.stroke(); }); }
  },

  /** Painted steel (tintable greys): brushed streaks, rivet rows and seams. */
  metal: ({ panels = 2 } = {}) => (g, w, h, r) => {
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.05)'; for (let i = 0; i < 60; i++) wrapRect(g, r() * w, r() * h, 20 + r() * 50, 1, w, h);
    g.fillStyle = 'rgba(255,255,255,0.3)'; for (let i = 0; i < 40; i++) wrapRect(g, r() * w, r() * h, 20 + r() * 50, 1, w, h);
    const ph = h / panels;
    for (let j = 0; j < panels; j++) {
      g.fillStyle = 'rgb(205,205,205)'; g.fillRect(0, j * ph, w, 2);
      g.fillStyle = 'rgb(252,252,252)'; g.fillRect(0, j * ph + 2, w, 1);
      g.fillStyle = 'rgb(214,214,214)'; for (let i = 0; i < 8; i++) wrapCircle(g, (i + 0.5) * w / 8, j * ph + 8, 1.6, w, h);
      g.fillStyle = 'rgb(255,255,255)'; for (let i = 0; i < 8; i++) wrapCircle(g, (i + 0.5) * w / 8 - 0.5, j * ph + 7.5, 0.7, w, h);
    }
  },

  /** Busy repeating rug: a diamond lattice with dotted lozenges and a stitched edge line (colours a, b, c on ground). */
  trellis: ({ ground, a, b, c, ink }) => (g, w, h) => {
    g.fillStyle = ground; g.fillRect(0, 0, w, h);
    const n = 2; const sx = w / n; const sy = h / n;
    const dia = (cx, cy, rx, ry, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(cx, cy - ry); g.lineTo(cx + rx, cy); g.lineTo(cx, cy + ry); g.lineTo(cx - rx, cy); g.closePath(); g.fill(); };
    wrap9(w, h, (ox, oy) => {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const cx = (i + 0.5) * sx + ox; const cy = (j + 0.5) * sy + oy;
        dia(cx, cy, sx * 0.48, sy * 0.48, ink); dia(cx, cy, sx * 0.42, sy * 0.42, (i + j) % 2 ? a : b); dia(cx, cy, sx * 0.26, sy * 0.26, ink); dia(cx, cy, sx * 0.2, sy * 0.2, c);
        dia(cx, cy, sx * 0.08, sy * 0.08, (i + j) % 2 ? b : a);
        dia(cx + sx / 2, cy, sx * 0.1, sy * 0.1, a); dia(cx, cy + sy / 2, sx * 0.1, sy * 0.1, b);
      }
    });
    g.save(); g.globalAlpha = 0.08; g.fillStyle = '#000'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1); g.restore();
  },

  /** Round braided rug / stripes of rope (not repeating): concentric rings of three yarns. */
  braid: ({ cols }) => (g, w, h) => {
    g.fillStyle = cols[0]; g.fillRect(0, 0, w, h);
    const R = w / 2; const rings = 11;
    for (let i = rings; i >= 0; i--) {
      const rr = (R * (i + 1)) / (rings + 1); g.fillStyle = cols[i % cols.length]; g.beginPath(); g.arc(w / 2, h / 2, rr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1.2; g.beginPath(); g.arc(w / 2, h / 2, rr, 0, Math.PI * 2); g.stroke();
      const ticks = 10 + i * 6; g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 1;
      for (let t = 0; t < ticks; t++) { const a = (t / ticks) * Math.PI * 2; g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * (rr - R / 14), h / 2 + Math.sin(a) * (rr - R / 14)); g.lineTo(w / 2 + Math.cos(a + 0.18) * rr, h / 2 + Math.sin(a + 0.18) * rr); g.stroke(); }
    }
  },

  /** Subway / wall tile (tintable-agnostic): staggered tiles with a glaze highlight and grout. */
  tiles: ({ a, b, grout, rows = 8, cols = 4 }) => (g, w, h, r) => {
    g.fillStyle = grout; g.fillRect(0, 0, w, h);
    const th = h / rows; const tw = w / cols;
    for (let j = 0; j < rows; j++) for (let i = -1; i < cols; i++) {
      const x = i * tw + (j % 2) * tw / 2; const y = j * th;
      g.fillStyle = jit(r() < 0.15 ? b : a, 0.03, r); wrapRect(g, x + 1.5, y + 1.5, tw - 3, th - 3, w, h);
      g.fillStyle = 'rgba(255,255,255,0.35)'; wrapRect(g, x + 2.5, y + 2.5, tw - 5, 2, w, h); wrapRect(g, x + 2.5, y + 2.5, 2, th - 5, w, h);
      g.fillStyle = 'rgba(0,0,0,0.1)'; wrapRect(g, x + 2.5, y + th - 4, tw - 5, 1.5, w, h);
    }
  },
};
