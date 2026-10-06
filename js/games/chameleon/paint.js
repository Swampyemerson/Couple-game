// Body paint: a 128×128 RGBA buffer (uploaded as a DataTexture) edited in 3D through the
// avatar's texel map. Brush dabs, region fill, stamp-from-surface, undo, and the network codec:
// median-cut quantisation to ≤ 32 colours (in place, so both players see the same pixels),
// then palette + byte ops (short run / long run / copy-row-above), base64, FNV-1a checksum.
import { TEX, REGIONS } from './avatar.js';
import { fnv, bytesToB64, b64ToBytes } from './util.js';
import { sampleAtlas } from './atlas.js';

const N = TEX * TEX;
const UNDO_MAX = 24;
const BLACK = [0, 0, 0];

export function createPaint(THREE, kit) {
  const data = new Uint8Array(N * 4).fill(255);
  const texture = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const { part, lpos, lnrm, list } = kit.texels;
  const wpos = new Float32Array(N * 3);
  const wnrm = new Float32Array(N * 3);
  const undo = [];
  let dirty = false;
  let version = 0;
  const tmp = [0, 0, 0];

  /** Recompute world-space texel positions from the avatar meshes (call when the pose settles). */
  function updateWorld(meshes) {
    const els = meshes.map((m) => { m.updateWorldMatrix(true, false); return m.matrixWorld.elements; });
    for (let k = 0; k < list.length; k++) {
      const i = list[k]; const e = els[part[i]];
      const x = lpos[i * 3]; const y = lpos[i * 3 + 1]; const z = lpos[i * 3 + 2];
      wpos[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      wpos[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      wpos[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = lnrm[i * 3]; const ny = lnrm[i * 3 + 1]; const nz = lnrm[i * 3 + 2];
      let ax = e[0] * nx + e[4] * ny + e[8] * nz; let ay = e[1] * nx + e[5] * ny + e[9] * nz; let az = e[2] * nx + e[6] * ny + e[10] * nz;
      const L = Math.hypot(ax, ay, az) || 1; ax /= L; ay /= L; az /= L;
      wnrm[i * 3] = ax; wnrm[i * 3 + 1] = ay; wnrm[i * 3 + 2] = az;
    }
  }

  function snapshot() {
    undo.push(data.slice());
    if (undo.length > UNDO_MAX) undo.shift();
  }

  function touch() { dirty = true; version++; }

  /**
   * One brush dab at world point (hx,hy,hz). view = direction camera→hit (skips texels facing
   * away so you paint what you see). hard: crisp edge; else soft falloff with flow.
   */
  function dab(hx, hy, hz, vx, vy, vz, radius, rgb, hard, flow = 0.4) {
    const r2 = radius * radius;
    let hit = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const dx = wpos[i * 3] - hx; const dy = wpos[i * 3 + 1] - hy; const dz = wpos[i * 3 + 2] - hz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const facing = wnrm[i * 3] * vx + wnrm[i * 3 + 1] * vy + wnrm[i * 3 + 2] * vz;
      if (facing > 0.35) continue;
      let a;
      if (hard) a = d2 > r2 * 0.82 ? 0.5 : 1;
      else { const t = 1 - Math.sqrt(d2) / radius; a = Math.min(1, t * t * 1.6) * flow; }
      const o = i * 4;
      data[o] = Math.round(data[o] + (rgb[0] - data[o]) * a);
      data[o + 1] = Math.round(data[o + 1] + (rgb[1] - data[o + 1]) * a);
      data[o + 2] = Math.round(data[o + 2] + (rgb[2] - data[o + 2]) * a);
      hit++;
    }
    if (hit) touch();
    return hit;
  }

  /** Fill one region ('body' | 'head' | 'tail' | 'legs') or 'all'. */
  function fill(region, rgb) {
    const parts = region === 'all' ? null : REGIONS[region];
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (parts && !parts.includes(part[i])) continue;
      const o = i * 4; data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2];
    }
    if (!parts) for (let i = 0; i < N; i++) if (part[i] < 0) { const o = i * 4; data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; }
    touch();
  }

  /** Paint texels whose (world) normal points along `dir` with rgb (used for seeker bellies). */
  function tintFacing(dirx, diry, dirz, minDot, rgb, region = 'body') {
    const parts = REGIONS[region];
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (parts && !parts.includes(part[i])) continue;
      const d = lnrm[i * 3] * dirx + lnrm[i * 3 + 1] * diry + lnrm[i * 3 + 2] * dirz;
      if (d < minDot) continue;
      const o = i * 4; data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2];
    }
    touch();
  }

  /**
   * Stamp: project the surface pattern under the avatar onto every texel that faces away from
   * that surface. surf = { q:[x,y,z], n:[x,y,z] (unit, out of the surface), uvAt(x,y,z,out2),
   * tile, vc:[r,g,b] 0..1, atlas, shadeAt(x,y,z) -> factor }.
   */
  function stamp(surf) {
    const [qx, qy, qz] = surf.q; const [nx, ny, nz] = surf.n;
    const uv = [0, 0];
    let hit = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const facing = wnrm[i * 3] * nx + wnrm[i * 3 + 1] * ny + wnrm[i * 3 + 2] * nz;
      if (facing < -0.25) continue;
      const px = wpos[i * 3]; const py = wpos[i * 3 + 1]; const pz = wpos[i * 3 + 2];
      const dist = (px - qx) * nx + (py - qy) * ny + (pz - qz) * nz;
      const sx = px - nx * dist; const sy = py - ny * dist; const sz = pz - nz * dist;
      surf.uvAt(sx, sy, sz, uv);
      sampleAtlas(surf.atlas, surf.tile, uv[0], uv[1], tmp);
      const sh = surf.shadeAt ? surf.shadeAt(sx, sy, sz) : 0;
      const br = surf.blobRgb || BLACK;
      const a = facing < 0 ? 1 + facing / 0.25 : 1;
      const o = i * 4;
      const r = tmp[0] * surf.vc[0] * (1 - sh) + br[0] * sh; const g = tmp[1] * surf.vc[1] * (1 - sh) + br[1] * sh; const b = tmp[2] * surf.vc[2] * (1 - sh) + br[2] * sh;
      data[o] = Math.round(data[o] + (r - data[o]) * a);
      data[o + 1] = Math.round(data[o + 1] + (g - data[o + 1]) * a);
      data[o + 2] = Math.round(data[o + 2] + (b - data[o + 2]) * a);
      hit++;
    }
    if (hit) touch();
    return hit;
  }

  /** Colour of the body at a texel uv (for picking colours off yourself). */
  function colorAtUV(u, v, out) {
    const x = Math.min(TEX - 1, Math.max(0, Math.floor(u * TEX))); const y = Math.min(TEX - 1, Math.max(0, Math.floor(v * TEX)));
    const o = (y * TEX + x) * 4; out[0] = data[o]; out[1] = data[o + 1]; out[2] = data[o + 2];
    return out;
  }

  function flush() {
    if (!dirty) return false;
    dirty = false;
    texture.needsUpdate = true;
    return true;
  }

  return {
    data, texture, wpos, wnrm,
    get version() { return version; },
    get canUndo() { return undo.length > 0; },
    updateWorld, snapshot, dab, fill, stamp, tintFacing, colorAtUV, flush,
    undo() { const s = undo.pop(); if (!s) return false; data.set(s); touch(); return true; },
    clearUndo() { undo.length = 0; },
    reset(rgb = [255, 255, 255]) { for (let i = 0; i < N; i++) { data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255; } undo.length = 0; touch(); },
    hash() { return fnv(data); },
    quantize(max = 32) { return quantize(data, max); },
    encode() { return encode(data); },
    decode(b64) { const ok = decodeInto(b64, data); touch(); return ok; },
    dispose() { texture.dispose(); },
  };
}

// ── quantisation (median cut) ──────────────────────────────────────────
export function quantize(data, max = 32) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  let palette;
  if (counts.size <= max) {
    palette = [...counts.keys()];
  } else {
    const cols = [...counts.entries()].map(([c, n]) => [(c >> 16) & 255, (c >> 8) & 255, c & 255, n]);
    let boxes = [cols];
    const range = (b) => {
      let best = -1; let ch = 0;
      for (let k = 0; k < 3; k++) { let lo = 255; let hi = 0; for (const c of b) { if (c[k] < lo) lo = c[k]; if (c[k] > hi) hi = c[k]; } if (hi - lo > best) { best = hi - lo; ch = k; } }
      return [best, ch];
    };
    while (boxes.length < max) {
      // split the box with the largest (range × population)
      let bi = -1; let score = -1; let bch = 0;
      boxes.forEach((b, i) => { if (b.length < 2) return; const [rg, ch] = range(b); const pop = b.reduce((s, c) => s + c[3], 0); const sc = rg * Math.sqrt(pop); if (sc > score) { score = sc; bi = i; bch = ch; } });
      if (bi < 0 || score <= 0) break;
      const b = boxes[bi].sort((x, y) => x[bch] - y[bch]);
      const tot = b.reduce((s, c) => s + c[3], 0);
      let acc = 0; let cut = 1;
      for (let i = 0; i < b.length; i++) { acc += b[i][3]; if (acc >= tot / 2) { cut = Math.min(b.length - 1, Math.max(1, i + 1)); break; } }
      boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
    }
    palette = boxes.map((b) => {
      let r = 0; let g = 0; let bl = 0; let n = 0;
      for (const c of b) { r += c[0] * c[3]; g += c[1] * c[3]; bl += c[2] * c[3]; n += c[3]; }
      return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(bl / n);
    });
    palette = [...new Set(palette)];
  }
  const pr = palette.map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);
  const lut = new Map();
  const idx = new Uint8Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let k = lut.get(c);
    if (k === undefined) {
      let best = 1e9; k = 0;
      for (let j = 0; j < pr.length; j++) { const dr = pr[j][0] - data[i]; const dg = pr[j][1] - data[i + 1]; const db = pr[j][2] - data[i + 2]; const d = dr * dr * 2 + dg * dg * 4 + db * db * 3; if (d < best) { best = d; k = j; } }
      lut.set(c, k);
    }
    idx[p] = k;
    data[i] = pr[k][0]; data[i + 1] = pr[k][1]; data[i + 2] = pr[k][2]; data[i + 3] = 255;
  }
  return { palette: pr, idx };
}

// ── codec ──────────────────────────────────────────────────────────────
/** Encode an already-quantised (≤ 32 colours) RGBA buffer. Returns { b64, sum, bytes }. */
export function encode(data) {
  const q = quantize(data, 32); // idempotent on quantised data: exact palette
  const { palette, idx } = q;
  const W = TEX; const H = TEX; const n = W * H;
  const out = [1, W, H, palette.length];
  for (const c of palette) out.push(c[0], c[1], c[2]);
  let p = 0;
  while (p < n) {
    let r = 1; while (p + r < n && idx[p + r] === idx[p] && r < 256) r++;
    let c = 0;
    if (p >= W) { while (p + c < n && idx[p + c] === idx[p + c - W] && c < 8192) c++; }
    if (c >= 2 && c >= r) {
      if (c <= 64) out.push(0x80 | (c - 1));
      else { const L = c - 1; out.push(0xe0 | (L >> 8), L & 255); }
      p += c;
    } else if (r <= 4) {
      out.push((idx[p] << 2) | (r - 1)); p += r;
    } else {
      out.push(0xc0 | idx[p], r - 1); p += r;
    }
  }
  const bytes = Uint8Array.from(out);
  return { b64: bytesToB64(bytes), sum: fnv(data), bytes: bytes.length };
}

/** Decode into an RGBA buffer. Returns the checksum of the result (or -1 on a malformed stream). */
export function decodeInto(b64, data) {
  let bytes;
  try { bytes = b64ToBytes(b64); } catch { return -1; }
  if (bytes[0] !== 1) return -1;
  const W = bytes[1]; const H = bytes[2]; const np = bytes[3];
  if (W !== TEX || H !== TEX || np < 1 || np > 32) return -1;
  const pal = [];
  let q = 4;
  for (let i = 0; i < np; i++) { pal.push([bytes[q], bytes[q + 1], bytes[q + 2]]); q += 3; }
  const n = W * H;
  const idx = new Uint8Array(n);
  let p = 0;
  while (p < n && q < bytes.length) {
    const b = bytes[q++];
    if (b < 0x80) { const k = b >> 2; const r = (b & 3) + 1; for (let i = 0; i < r && p < n; i++) idx[p++] = k; }
    else if (b < 0xc0) { const c = (b & 0x3f) + 1; for (let i = 0; i < c && p < n; i++, p++) idx[p] = idx[p - W]; }
    else if (b < 0xe0) { const k = b & 0x1f; const r = bytes[q++] + 1; for (let i = 0; i < r && p < n; i++) idx[p++] = k; }
    else { const c = (((b & 0x1f) << 8) | bytes[q++]) + 1; for (let i = 0; i < c && p < n; i++, p++) idx[p] = idx[p - W]; }
  }
  if (p !== n) return -1;
  for (let i = 0; i < n; i++) { const c = pal[idx[i]] || pal[0]; data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255; }
  return fnv(data);
}
