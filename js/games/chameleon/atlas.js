// Procedural pattern atlas: every patterned surface of a map is painted (deterministically)
// into one 1024² canvas. Tiles repeat in the shader (fract + textureGrad), so each tile is
// drawn seamless and surrounded by an 8 px wrap-around gutter. A CPU copy of the pixels is
// kept for the eyedropper and the stamp tool.
import { seeded, mixHex, shade } from './util.js';

const PAD = 8;
const SIZES = { S: 48, M: 112, L: 240, XL: 496 };

/** size: width in px; height: 1024 or 2048 (two 1024² pages stacked in one texture for big maps). */
export function createAtlas(size = 1024, height = size) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, height);
  const reqs = [];
  const tiles = {}; // key -> [u0, v0, du, dv]
  const rects = {}; // key -> { x, y, w, h, repeat }

  function add(key, painter, { size: sz = 'L', repeat = true, w, h } = {}) {
    const iw = w || SIZES[sz] || SIZES.L; const ih = h || iw;
    reqs.push({ key, painter, iw, ih, repeat });
  }

  /** Paint every tile (all at once). finishSteps() is the same work one tile per step (it
   *  yields after each tile), so a map build can be spread over frames (maps.js buildMapAsync). */
  function finish() { const it = finishSteps(); for (;;) { const s = it.next(); if (s.done) return s.value; } }
  function* finishSteps() {
    add('white', (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }, { size: 'S', repeat: true });
    // shelf packing, tallest first
    const order = [...reqs].sort((a, b) => b.ih + PAD * 2 - (a.ih + PAD * 2) || b.iw - a.iw);
    let x = 0; let y = 0; let shelf = 0;
    for (const r of order) {
      const W = r.iw + PAD * 2; const H = r.ih + PAD * 2;
      if (x + W > size) { x = 0; y += shelf; shelf = 0; }
      if (y + H > height) { console.warn('atlas full, dropping', r.key); continue; }
      const ix = x + PAD; const iy = y + PAD; const w = r.iw; const h = r.ih;
      // maps pass (perf): paint straight into the (CPU-backed) atlas, clipped to the tile, and
      // copy the gutters with putImageData. The old tmp canvas + 9 clipped drawImage blits per
      // tile (and self-drawImage of the whole atlas for clamped gutters) were 25-225 ms a map;
      // this is 8-40 ms with the same pixels (± rounding on anti-aliased edges).
      ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, w, h); ctx.clip(); ctx.translate(ix, iy);
      try { r.painter(ctx, w, h, seeded(r.key)); } catch (e) { console.error('atlas painter', r.key, e); }
      ctx.restore();
      const img = ctx.getImageData(ix, iy, w, h);
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
      x += W; shelf = Math.max(shelf, H);
      yield r.key;
    }
    // The CPU copy for the eyedropper / stamp / blend score is read on first use (or by
    // warm() in idle time after a map switch): a 4-8 MB getImageData no longer sits in the
    // switch itself, and a cached map that is never sampled never pays for it.
    let data = null;
    return {
      canvas, size, width: size, height, tiles, rects, used: y + shelf,
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

// ── painters ───────────────────────────────────────────────────────────
// Each returns (g, w, h, rnd) => void and must tile seamlessly when `repeat`.

const wrapCircle = (g, x, y, r, w, h) => {
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = x + ox * w; const cy = y + oy * h;
    if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  }
};

export const P = {
  solid: (c) => (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); },

  /** Vertical stripes. widths are relative; the set repeats `n` times across the tile. */
  stripes: ({ cols, widths, n = 1 }) => (g, w, h) => {
    const ws = widths || cols.map(() => 1);
    const tot = ws.reduce((s, x) => s + x, 0);
    let x = 0;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < cols.length; i++) {
        const sw = (ws[i] / tot) * (w / n);
        g.fillStyle = cols[i]; g.fillRect(Math.round(x), 0, Math.ceil(sw) + 1, h); x += sw;
      }
    }
  },

  /** Horizontal bands (tape, deck chairs rotated, etc). */
  bands: ({ cols, widths, n = 1 }) => (g, w, h) => {
    const ws = widths || cols.map(() => 1);
    const tot = ws.reduce((s, x) => s + x, 0);
    let y = 0;
    for (let k = 0; k < n; k++) for (let i = 0; i < cols.length; i++) {
      const sh = (ws[i] / tot) * (h / n);
      g.fillStyle = cols[i]; g.fillRect(0, Math.round(y), w, Math.ceil(sh) + 1); y += sh;
    }
  },

  /** Regency stripe wallpaper with little sprigs between the stripes. */
  wallpaper: ({ bg, stripe, thin, sprig, leaf }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const n = 2; const cw = w / n;
    for (let k = 0; k < n; k++) {
      const x0 = k * cw;
      g.fillStyle = stripe; g.fillRect(x0 + cw * 0.06, 0, cw * 0.26, h);
      g.fillStyle = thin; g.fillRect(x0 + cw * 0.40, 0, cw * 0.035, h); g.fillRect(x0 + cw * 0.025, 0, cw * 0.02, h); g.fillRect(x0 + cw * 0.34, 0, cw * 0.02, h);
      // sprigs (half-drop)
      for (let j = 0; j < 2; j++) {
        const cx = x0 + cw * 0.68; const cy = (j + (k % 2) * 0.5) * (h / 2) + h / 8;
        g.fillStyle = leaf;
        for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * 7, cy + 6, 7, 3.2, s * 0.6, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = sprig; wrapCircle(g, cx, cy - 2, 6, w, h);
        g.fillStyle = shade(sprig, 0.45); wrapCircle(g, cx, cy - 2, 2.4, w, h);
      }
    }
  },

  /** Floorboards: rows of planks with staggered joints. */
  planks: ({ base, alt, seam, rows = 6 }) => (g, w, h, r) => {
    const rh = h / rows;
    for (let j = 0; j < rows; j++) {
      const off = r() * w;
      const tones = [base, alt, mixHex(base, alt, 0.5)];
      for (let k = -1; k < 2; k++) {
        g.fillStyle = tones[(j + k + 3) % 3];
        g.fillRect(off + k * (w / 2), j * rh, w / 2, rh);
        g.fillRect(off + k * (w / 2) - w, j * rh, w / 2, rh);
      }
      g.fillStyle = seam;
      for (let k = -1; k < 2; k++) { const sx = (off + k * (w / 2)) % w; g.fillRect(sx < 0 ? sx + w : sx, j * rh, 2, rh); }
      g.fillRect(0, j * rh, w, 2);
      // grain flecks
      g.globalAlpha = 0.18; g.fillStyle = seam;
      for (let i = 0; i < 5; i++) g.fillRect(r() * w, j * rh + 4 + r() * (rh - 8), 10 + r() * 24, 1.5);
      g.globalAlpha = 1;
    }
  },

  /** Kilim rug (not repeating): border, stepped diamonds, zig-zags, tassel ends. */
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
    g.fillStyle = field; g.fillRect(m * 2, m * 2.1, w - m * 4, h - m * 4.2);
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
      }
    });
  },

  /** Polka dots in a staggered grid. */
  dots: ({ bg, fg, n = 4, r = 0.18 }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    const s = w / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) wrapCircle(g, (i + (j % 2) * 0.5) * s + s / 4, j * s + s / 2, s * r, w, h);
  },

  /** Gingham / buffalo check. */
  check: ({ a, b, n = 4 }) => (g, w, h) => {
    g.fillStyle = a; g.fillRect(0, 0, w, h);
    const s = w / n;
    g.fillStyle = mixHex(a, b, 0.5);
    for (let i = 0; i < n; i++) { g.fillRect(i * s, 0, s / 2, h); g.fillRect(0, i * s, w, s / 2); }
    g.fillStyle = b;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g.fillRect(i * s, j * s, s / 2, s / 2);
  },

  /** Checkerboard tiles. */
  checker: ({ a, b, n = 4, grout }) => (g, w, h) => {
    const s = w / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * s, j * s, s, s); }
    if (grout) { g.fillStyle = grout; for (let i = 0; i < n; i++) { g.fillRect(i * s, 0, 1.5, h); g.fillRect(0, i * s, w, 1.5); } }
  },

  /** Houndstooth-ish tweed: two-tone broken check. */
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
  },

  /** Chevrons. */
  chevron: ({ cols, n = 3 }) => (g, w, h) => {
    const band = h / (n * cols.length);
    for (let k = -1; k < n * cols.length + 2; k++) {
      g.fillStyle = cols[((k % cols.length) + cols.length) % cols.length];
      g.beginPath();
      const y = k * band;
      g.moveTo(0, y); g.lineTo(w / 2, y + band * 1.5); g.lineTo(w, y); g.lineTo(w, y + band); g.lineTo(w / 2, y + band * 2.5); g.lineTo(0, y + band);
      g.closePath(); g.fill();
    }
  },

  /** Tintable basket weave (grey tones, multiplied by the vertex colour). */
  weave: ({ n = 8, lo = 0.84 } = {}) => (g, w, h) => {
    const L = Math.round(255 * lo); const M = Math.round(255 * (1 + lo) / 2);
    g.fillStyle = `rgb(${M},${M},${M})`; g.fillRect(0, 0, w, h);
    const s = w / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      g.fillStyle = (i + j) % 2 ? '#ffffff' : `rgb(${L},${L},${L})`;
      if ((i + j) % 2) g.fillRect(i * s + 1, j * s + s * 0.2, s - 2, s * 0.6); else g.fillRect(i * s + s * 0.2, j * s + 1, s * 0.6, s - 2);
    }
  },

  /** Tintable wood grain. */
  wood: ({ n = 7 } = {}) => (g, w, h, r) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgb(226,226,226)'; g.lineWidth = 3;
    for (let i = 0; i < n; i++) {
      const y0 = (i + 0.5) * (h / n); const amp = 3 + r() * 5; const ph = r() * 6;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) { const y = y0 + Math.sin((x / w) * Math.PI * 2 * 2 + ph) * amp; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgb(214,214,214)';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(r() * w, r() * h, 6, 3, 0, 0, Math.PI * 2); g.fill(); }
  },

  /** Book spine (tintable, not repeating): gilt bands top and bottom + a title block. */
  spine: ({ band = '#f6e7b8' } = {}) => (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgb(205,205,205)';
    g.fillRect(0, h * 0.1, w, h * 0.04); g.fillRect(0, h * 0.86, w, h * 0.04);
    g.fillStyle = band; g.fillRect(w * 0.2, h * 0.3, w * 0.6, h * 0.22);
    g.fillStyle = 'rgb(214,214,214)'; g.fillRect(w * 0.3, h * 0.62, w * 0.4, h * 0.06);
  },

  /** Hedge leaves: overlapping blobs in three greens. */
  leafy: ({ base, light, dark, n = 70 }) => (g, w, h, r) => {
    g.fillStyle = dark; g.fillRect(0, 0, w, h);
    for (const [col, rad, cnt] of [[base, 0.11, n], [light, 0.06, n * 0.8], [shade(light, 0.25), 0.03, n * 0.5]]) {
      g.fillStyle = col;
      for (let i = 0; i < cnt; i++) wrapCircle(g, r() * w, r() * h, w * rad * (0.6 + r() * 0.6), w, h);
    }
  },

  /** Lawn: mowing stripes and clover flecks. */
  lawn: ({ a, b, fleck }) => (g, w, h, r) => {
    g.fillStyle = a; g.fillRect(0, 0, w / 2, h); g.fillStyle = b; g.fillRect(w / 2, 0, w / 2, h);
    g.fillStyle = fleck;
    for (let i = 0; i < 60; i++) { g.globalAlpha = 0.5; wrapCircle(g, r() * w, r() * h, 1.6 + r() * 2, w, h); }
    g.globalAlpha = 1;
  },

  soil: ({ base, speck, stone }) => (g, w, h, r) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = speck; for (let i = 0; i < 120; i++) wrapCircle(g, r() * w, r() * h, 1 + r() * 2.5, w, h);
    g.fillStyle = stone; for (let i = 0; i < 10; i++) wrapCircle(g, r() * w, r() * h, 3 + r() * 4, w, h);
  },

  bricks: ({ brick, alt, mortar, rows = 8, cols = 4 }) => (g, w, h, r) => {
    g.fillStyle = mortar; g.fillRect(0, 0, w, h);
    const bh = h / rows; const bw = w / cols;
    for (let j = 0; j < rows; j++) for (let i = -1; i < cols; i++) {
      const x = i * bw + (j % 2) * bw / 2;
      g.fillStyle = r() < 0.3 ? alt : brick;
      g.fillRect(x + 2, j * bh + 2, bw - 4, bh - 4);
    }
  },

  /** Flagstone (not repeating). */
  flag: ({ base, dark, light }) => (g, w, h, r) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = light; for (let i = 0; i < 14; i++) { g.beginPath(); g.ellipse(r() * w, r() * h, 6 + r() * 14, 4 + r() * 8, r() * 3, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = dark; g.lineWidth = 2; g.beginPath(); g.moveTo(w * 0.2, h * 0.1); g.lineTo(w * 0.45, h * 0.5); g.lineTo(w * 0.4, h * 0.9); g.stroke();
  },

  /** Paint splatters on a cloth (tiles). */
  splatter: ({ bg, cols, n = 26 }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[i % cols.length];
      const x = r() * w; const y = r() * h; const s = 4 + r() * 16;
      wrapCircle(g, x, y, s, w, h);
      for (let k = 0; k < 6; k++) { const a = r() * Math.PI * 2; const d = s * (1.2 + r() * 1.6); wrapCircle(g, x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + r() * s * 0.25, w, h); }
    }
  },

  /** Colour-swatch wall: grid of chips (repeating). */
  swatches: ({ bg, cols, nx = 4, ny = 4 }) => (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const sx = w / nx; const sy = h / ny;
    let k = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      g.fillStyle = cols[k++ % cols.length];
      g.fillRect(i * sx + sx * 0.1, j * sy + sy * 0.08, sx * 0.8, sy * 0.66);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(i * sx + sx * 0.1, j * sy + sy * 0.8, sx * 0.5, 2);
    }
  },

  /** Abstract paintings (not repeating). style: blocks | circles | waves | sunset | stripes */
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
  },

  /** A window onto a sunny day (not repeating). */
  window: ({ sky, cloud, frame, hill }) => (g, w, h) => {
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = hill; g.beginPath(); g.moveTo(0, h); g.quadraticCurveTo(w * 0.3, h * 0.55, w * 0.65, h * 0.8); g.quadraticCurveTo(w * 0.85, h * 0.7, w, h * 0.75); g.lineTo(w, h); g.closePath(); g.fill();
    g.fillStyle = cloud; for (const [x, y, s] of [[0.3, 0.25, 1], [0.7, 0.4, 0.7]]) { g.beginPath(); g.ellipse(w * x, h * y, w * 0.14 * s, h * 0.05 * s, 0, 0, Math.PI * 2); g.ellipse(w * (x + 0.07), h * (y - 0.03), w * 0.09 * s, h * 0.05 * s, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = frame; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10); g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h); g.fillRect(w / 2 - 5, 0, 10, h); g.fillRect(0, h / 2 - 5, w, 10);
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
  },

  /** Terracotta rings (tintable). */
  rings: ({ n = 3 } = {}) => (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgb(222,222,222)';
    for (let i = 0; i < n; i++) g.fillRect(0, (i + 0.4) * (h / n), w, h / n * 0.2);
  },

  /** Drop cloth folds (tiles). */
  cloth: ({ bg, fold, cols }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fold; g.lineWidth = 3;
    for (let i = 0; i < 5; i++) { const y = (i + 0.5) * h / 5; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 10, w * 0.6, y - 10, w, y); g.stroke(); }
    for (let i = 0; i < 18; i++) { g.fillStyle = cols[i % cols.length]; wrapCircle(g, r() * w, r() * h, 2 + r() * 8, w, h); }
  },

  /** Herringbone parquet. */
  herringbone: ({ a, b, seam }) => (g, w, h) => {
    g.fillStyle = seam; g.fillRect(0, 0, w, h);
    const s = w / 6;
    for (let j = -2; j < 8; j++) for (let i = -2; i < 8; i++) {
      const x = i * s; const y = j * s * 2 + (i % 2) * s;
      g.fillStyle = (i + j) % 2 ? a : b;
      g.save(); g.translate(x, y); g.rotate(i % 2 ? Math.PI / 4 : -Math.PI / 4); g.fillRect(-s * 0.7, -s * 0.33, s * 1.4 - 2, s * 0.66 - 2); g.restore();
    }
  },

  /** Scattered confetti-like flowers over a ground colour (flower bed). */
  blooms: ({ bg, cols, leaf, n = 40 }) => (g, w, h, r) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = leaf; for (let i = 0; i < n; i++) wrapCircle(g, r() * w, r() * h, 4 + r() * 6, w, h);
    for (let i = 0; i < n; i++) {
      const x = r() * w; const y = r() * h; const c = cols[i % cols.length];
      g.fillStyle = c; for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; wrapCircle(g, x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3.4, w, h); }
      g.fillStyle = '#ffd23f'; wrapCircle(g, x, y, 2, w, h);
    }
  },
};

