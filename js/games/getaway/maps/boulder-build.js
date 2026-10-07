// Boulder for Getaway: build(THREE, kit) — everything visual except the engine's road ribbons,
// curbs + sidewalks and its breakable props: terrain, sidewalk corners, lots and plazas, Boulder
// Creek, buildings, walls, rails, rocks, fences, parked cars, bus stops, gantries, power lines,
// street furniture and the decor forest. One merged mesh per 200 m chunk (one material: vertex
// colours over the facade atlas, plus the engine's per-vertex surface codes where it has them —
// brick, tile, grass, water, rock …), so a chunk costs one draw call.
import { BOUNDS, OPEN, WATER, CREEK, CREEK_HW, US36, usPt, footX } from './boulder-data.js';
import { layout, smoothedRoads, height, HEIGHT_GRID, zoneAt, mulberry, isFarMtn } from './boulder-layout.js';
import { makeAtlas, tileUV, T } from './boulder-atlas.js';

// ── merged-geometry buffer ───────────────────────────────────────────────────
const WHITE_UV = (() => { const [u0, v0, u1, v1] = tileUV(T.white); return [(u0 + u1) / 2, (v0 + v1) / 2]; })();
class Buf {
  constructor() { this.cap = 2048; this.icap = 4096; this.v = 0; this.ni = 0; this.fxv = 0; this._alloc(); }
  _alloc() { this.P = new Float32Array(this.cap * 3); this.N = new Float32Array(this.cap * 3); this.C = new Float32Array(this.cap * 3); this.U = new Float32Array(this.cap * 2); this.F = new Float32Array(this.cap); this.I = new Uint32Array(this.icap); }
  grow(nv, ni) {
    if (this.v + nv > this.cap) {
      let c = this.cap; while (this.v + nv > c) c *= 2;
      const o = { P: this.P, N: this.N, C: this.C, U: this.U, F: this.F }; this.cap = c;
      this.P = new Float32Array(c * 3); this.P.set(o.P); this.N = new Float32Array(c * 3); this.N.set(o.N); this.C = new Float32Array(c * 3); this.C.set(o.C);
      this.U = new Float32Array(c * 2); this.U.set(o.U); this.F = new Float32Array(c); this.F.set(o.F);
    }
    if (this.ni + ni > this.icap) { let c = this.icap; while (this.ni + ni > c) c *= 2; const a = new Uint32Array(c); a.set(this.I); this.I = a; this.icap = c; }
  }
  vert(x, y, z, nx, ny, nz, c, u, w, f) {
    const k = this.v++; const k3 = k * 3;
    this.P[k3] = x; this.P[k3 + 1] = y; this.P[k3 + 2] = z; this.N[k3] = nx; this.N[k3 + 1] = ny; this.N[k3 + 2] = nz;
    this.C[k3] = c[0]; this.C[k3 + 1] = c[1]; this.C[k3 + 2] = c[2]; this.U[k * 2] = u; this.U[k * 2 + 1] = w; this.F[k] = f;
  }
  /** Quad a→b→c→d, colour [r,g,b], uv rect or null; `hint` = which side is the front. */
  quad(a, b, c, d, col, uv, hint) {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = d[0] - a[0]; const vy = d[1] - a[1]; const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    let flip = false;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { flip = true; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.grow(4, 6); const v = this.v; const f = this.fxv;
    const u0 = uv ? uv[0] : WHITE_UV[0]; const v0 = uv ? uv[1] : WHITE_UV[1]; const u1 = uv ? uv[2] : WHITE_UV[0]; const v1 = uv ? uv[3] : WHITE_UV[1];
    this.vert(a[0], a[1], a[2], nx, ny, nz, col, u0, v0, f); this.vert(b[0], b[1], b[2], nx, ny, nz, col, u1, v0, f);
    this.vert(c[0], c[1], c[2], nx, ny, nz, col, u1, v1, f); this.vert(d[0], d[1], d[2], nx, ny, nz, col, u0, v1, f);
    const I = this.I; let n = this.ni;
    if (flip) { I[n++] = v; I[n++] = v + 2; I[n++] = v + 1; I[n++] = v; I[n++] = v + 3; I[n++] = v + 2; } else { I[n++] = v; I[n++] = v + 1; I[n++] = v + 2; I[n++] = v; I[n++] = v + 2; I[n++] = v + 3; }
    this.ni = n;
  }
  tri(a, b, c, col, hint, uvs) {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    let flip = false;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { flip = true; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.grow(3, 3); const v = this.v; const f = this.fxv;
    const U = uvs || [WHITE_UV[0], WHITE_UV[1], WHITE_UV[0], WHITE_UV[1], WHITE_UV[0], WHITE_UV[1]];
    this.vert(a[0], a[1], a[2], nx, ny, nz, col, U[0], U[1], f); this.vert(b[0], b[1], b[2], nx, ny, nz, col, U[2], U[3], f); this.vert(c[0], c[1], c[2], nx, ny, nz, col, U[4], U[5], f);
    const I = this.I; let n = this.ni;
    if (flip) { I[n++] = v; I[n++] = v + 2; I[n++] = v + 1; } else { I[n++] = v; I[n++] = v + 1; I[n++] = v + 2; }
    this.ni = n;
  }
  /** Indexed mesh with per-vertex normals (smooth), e.g. terrain. */
  mesh(pos, nrm, cols, idx) {
    const nv = pos.length / 3; this.grow(nv, idx.length); const v = this.v;
    for (let k = 0; k < nv; k++) { const c = [cols[k * 3], cols[k * 3 + 1], cols[k * 3 + 2]]; this.vert(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2], c, WHITE_UV[0], WHITE_UV[1], this.fxv); }
    for (let k = 0; k < idx.length; k++) this.I[this.ni++] = v + idx[k];
  }
  /** Ink outline (inverted hull) for what was added since (v0, i0): vertices pushed out along
   *  their averaged normals by `ol`, winding reversed, unlit ink colour (fx 1). */
  hull(v0, i0, ol, ink) {
    const v1 = this.v; const i1 = this.ni; const nv = v1 - v0; const acc = new Map(); const P = this.P; const N = this.N;
    const keys = new Float64Array(nv);
    for (let q = 0; q < nv; q++) {
      const k3 = (v0 + q) * 3; const key = Math.round(P[k3] * 40) * 73856093 + Math.round(P[k3 + 1] * 40) * 19349663 + Math.round(P[k3 + 2] * 40) * 83492791;
      keys[q] = key; let e = acc.get(key); if (!e) { e = [0, 0, 0]; acc.set(key, e); } e[0] += N[k3]; e[1] += N[k3 + 1]; e[2] += N[k3 + 2];
    }
    this.grow(nv, i1 - i0); const base = this.v;
    for (let q = 0; q < nv; q++) {
      const k3 = (v0 + q) * 3; const e = acc.get(keys[q]); const l = Math.hypot(e[0], e[1], e[2]) || 1;
      this.vert(P[k3] + e[0] / l * ol, P[k3 + 1] + e[1] / l * ol, P[k3 + 2] + e[2] / l * ol, -N[k3], -N[k3 + 1], -N[k3 + 2], ink, WHITE_UV[0], WHITE_UV[1], 1);
    }
    const I = this.I;
    for (let k = i0; k < i1; k += 3) { I[this.ni++] = base + I[k] - v0; I[this.ni++] = base + I[k + 2] - v0; I[this.ni++] = base + I[k + 1] - v0; }
  }
  get tris() { return this.ni / 3; }
}

// ── colour helpers ─────────────────────────────────────────────────────────────
const CC = new Map();
function rgb(hex) {
  let c = CC.get(hex); if (c) return c;
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; CC.set(hex, c); return c;
}
const shade = (c, k) => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function vnoise(x, z) { // cheap value noise in [0, 1]
  const xi = Math.floor(x); const zi = Math.floor(z); const xf = x - xi; const zf = z - zi;
  const h = (a, b) => { let n = Math.imul(a, 374761393) + Math.imul(b, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const s = (t) => t * t * (3 - 2 * t); const u = s(xf); const v = s(zf);
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v;
}

// ground colours by district
const GROUND = {
  mtn: '#7d8f57', chautauqua: '#aeaa64', mesa: '#b3aa72', downtown: '#bcb6a9', eastpearl: '#b8b3a6', westpearl: '#90a866',
  twentyninth: '#b9b4a7', junction: '#b2aea1', civic: '#7dab58', campus: '#80ac5b', commercial: '#b1ac9c', east: '#98ad70',
  whittier: '#84ac5a', westres: '#84ac5a', hill: '#87ac5c', southres: '#8cad5f', martin: '#8aac5d', eastres: '#8cad5f',
  willvill: '#8aac5d', valmont: '#a7a666', none: '#97aa66',
};

// ── geometry primitives ─────────────────────────────────────────────────────────
const UNIT = { ico: null, cone7: null };
function ico() {
  if (UNIT.ico) return UNIT.ico;
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((q) => q / l); });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  UNIT.ico = { v, f }; return UNIT.ico;
}

export async function buildBoulder(THREE, kit = {}) {
  const t0 = performance.now(); const TT = {}; let tl = t0; const TR = {}; let trPrev = 0; const mark = (k) => { const n = performance.now(); TT[k] = Math.round(n - tl); tl = n; let t = 0; for (const bb of bufs.values()) if (bb) t += bb.ni / 3; TR[k] = Math.round(t - trPrev); trPrev = t; };
  const slice = typeof kit.slice === 'function' ? () => kit.slice() : () => null;
  const quality = kit.quality || 'high';
  const low = quality === 'low';
  const L = layout();
  const sm = smoothedRoads();
  const rnd = mulberry(0x5EED1855);
  const root = new THREE.Group(); root.name = 'boulder';
  const dark = !!kit.dark;
  const lamp = typeof kit.lamp === 'function' ? (x, y, z) => { try { kit.lamp(x, y, z); } catch (e) { /* optional */ } } : () => {};
  const gH = typeof kit.height === 'function' ? kit.height : height; // the engine's ground (road ribbons sit on it)
  // surface codes (graphics v2): feature-detected; an older engine gets plain shading
  const FXN = { plain: 0, ink: 1, windows: 2, glow: 3, shop: 11, tower: 12, road: 5, paint: 6, glass: 7, chrome: 8, trim: 9, brick: 13, stucco: 14, tile: 15, shingle: 16, concrete: 17, grass: 18, dirt: 19, water: 24, metal: 25, wood: 26, rock: 27, foliage: 28, lot: 29 };
  const F = {}; for (const k of Object.keys(FXN)) F[k] = kit.FX ? (kit.FX[k] != null ? kit.FX[k] : 0) : (k === 'ink' ? 1 : k === 'glow' ? 3 : 0);
  const canvas = makeAtlas({ night: dark });
  let tex = null;
  if (canvas) {
    tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    if (THREE.sRGBEncoding && kit.srgb) tex.encoding = THREE.sRGBEncoding;
  }
  // the engine's toon material, cloned so the atlas stays ours
  let mat = null;
  if (typeof kit.toon === 'function') {
    try {
      const base = kit.toon(null, { vertexColors: true });
      mat = base.clone();
      mat.onBeforeCompile = base.onBeforeCompile; mat.customProgramCacheKey = base.customProgramCacheKey;
      mat.defines = { ...(base.defines || {}) }; mat.userData = { ...base.userData };
    } catch (e) { mat = null; }
  }
  if (!mat) mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.vertexColors = true; if (tex) mat.map = tex; mat.needsUpdate = true;
  const INK = kit.ink ? kit.ink.slice(0, 3) : [0.13, 0.11, 0.14];
  const OL = low ? 0 : 0.11;
  // night: build() darkens map colours (flush); engine palette colours are pre-compensated here
  const engineCol = (c) => (dark ? [Math.min(1, Math.max(0, (c[0] - 0.035) / 0.5)), Math.min(1, Math.max(0, (c[1] - 0.035) / 0.5)), Math.min(1, Math.max(0, (c[2] - 0.07) / 0.52))] : c);

  // chunk buffers
  const bufs = new Map(); const own = new Map();
  const groupAt = (x, z) => {
    if (typeof kit.chunk === 'function') { const g = kit.chunk(x, z); if (g) return g; }
    const k = `${Math.floor(x / 200)},${Math.floor(z / 200)}`; let g = own.get(k);
    if (!g) { g = new THREE.Group(); g.name = 'boulder-chunk-' + k; own.set(k, g); root.add(g); }
    return g;
  };
  const B = (x, z) => { const g = groupAt(x, z); let b = bufs.get(g); if (!b) { b = new Buf(); bufs.set(g, b); } return b; };
  /** Run fn with buf's current surface code set to fx. */
  const withFx = (buf, fx, fn) => { const o = buf.fxv; buf.fxv = fx; fn(); buf.fxv = o; };

  // ── terrain (8 m grid from the levelled height grid; coarser where it is flat) ───────────
  const HG = HEIGHT_GRID; const g = HG.g;
  const creekD = (x, z) => { let d = Infinity; for (let k = 0; k < CREEK.length - 1; k++) { const [ax, az] = CREEK[k]; const [bx, bz] = CREEK[k + 1]; const dx = bx - ax; const dz = bz - az; const L2 = dx * dx + dz * dz; let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t)); } return d; };
  const PAVED = { downtown: 1, eastpearl: 1, twentyninth: 1, junction: 1, commercial: 1 };
  const groundCol = (x, z, y, zn) => {
    let c = rgb(GROUND[zn] || GROUND.none);
    const n = vnoise(x / 37, z / 37) * 0.6 + vnoise(x / 11, z / 11) * 0.4;
    c = shade(c, 0.92 + n * 0.14);
    if (zn === 'mtn') { const f = Math.min(1, Math.max(0, (y - 25) / 60)); c = mix(c, rgb('#56704a'), f * 0.7 * (0.6 + n * 0.6)); }
    if (zn === 'chautauqua' || zn === 'mesa') c = mix(c, rgb('#c9b56f'), n * 0.45); // the dry-grass meadow under the Flatirons
    return c;
  };
  const x0 = BOUNDS.x0 - 32; const z0 = BOUNDS.z0 - 32; const x1 = BOUNDS.x1 + 32; const z1 = BOUNDS.z1 + 32;
  const i0 = Math.max(0, Math.floor((x0 - HG.HX0) / HG.HC)); const i1 = Math.min(HG.HW - 1, Math.ceil((x1 - HG.HX0) / HG.HC));
  const j0 = Math.max(0, Math.floor((z0 - HG.HZ0) / HG.HC)); const j1 = Math.min(HG.HH - 1, Math.ceil((z1 - HG.HZ0) / HG.HC));
  const BLK = 25;
  let terrTris = 0;
  for (let bj = j0; bj < j1; bj += BLK) {
    for (let bi = i0; bi < i1; bi += BLK) {
      const ie = Math.min(i1, bi + BLK); const je = Math.min(j1, bj + BLK);
      let lo = Infinity; let hi = -Infinity; let nearCreek = false;
      for (let j = bj; j <= je; j++) for (let i = bi; i <= ie; i++) { const h = g[j * HG.HW + i]; lo = Math.min(lo, h); hi = Math.max(hi, h); }
      const cxm = HG.HX0 + (bi + ie) / 2 * HG.HC; const czm = HG.HZ0 + (bj + je) / 2 * HG.HC;
      if (Math.abs(czm - 155) < 130) nearCreek = true;
      const step = hi - lo < 0.15 && !nearCreek ? (low ? 5 : 4) : hi - lo < 0.3 && !nearCreek ? (low ? 5 : 3) : (hi - lo < 1.5 && !nearCreek) || low ? 2 : 1;
      const buf = B(cxm, czm);
      const cols = Math.ceil((ie - bi) / step) + 1; const rows = Math.ceil((je - bj) / step) + 1;
      const H = (i, j) => g[Math.min(HG.HH - 1, j) * HG.HW + Math.min(HG.HW - 1, i)];
      buf.grow(cols * rows, (cols - 1) * (rows - 1) * 6);
      const v0 = buf.v;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = Math.min(ie, bi + c * step); const j = Math.min(je, bj + r * step);
        const x = HG.HX0 + i * HG.HC; const z = HG.HZ0 + j * HG.HC; const y = H(i, j);
        const dx = H(i + 1, j) - H(Math.max(0, i - 1), j); const dz = H(i, j + 1) - H(i, Math.max(0, j - 1));
        const nl = Math.hypot(dx, 2 * HG.HC, dz);
        const zn = zoneAt(x, z);
        buf.vert(x, y - 0.02, z, -dx / nl, 2 * HG.HC / nl, -dz / nl, groundCol(x, z, y, zn), WHITE_UV[0], WHITE_UV[1], PAVED[zn] ? F.plain : F.grass);
      }
      const P3 = buf.P; let added = 0;
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
        const a = v0 + r * cols + c;
        const xm = P3[a * 3] + step * HG.HC / 2; const zm = P3[a * 3 + 2] + step * HG.HC / 2;
        if (nearCreek && creekD(xm, zm) < 8.5) continue;
        if (xm < footX(zm) - 40 && isFarMtn(xm - step * 4, zm) && isFarMtn(xm + step * 4, zm)) continue; // the backdrop draws the far flank
        const I = buf.I; let n = buf.ni;
        I[n++] = a; I[n++] = a + cols; I[n++] = a + 1; I[n++] = a + 1; I[n++] = a + cols; I[n++] = a + cols + 1; buf.ni = n; added += 2;
      }
      terrTris += added;
    }
    await slice();
  }
  mark('terrain');

  // ── Boulder Creek: water, cobble banks, grass shoulders, rocks and willow clumps ─────────
  {
    const pts = CREEK; const W = rgb('#3f7f9c'); const bank = rgb('#9e8b6d'); const grass = rgb('#7fae55'); const willow = rgb('#7c9a4c');
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k]; const [bx, bz] = pts[k + 1]; const len = Math.hypot(bx - ax, bz - az); const n = Math.max(1, Math.ceil(len / 12));
      for (let q = 0; q < n; q++) {
        const p0 = [ax + (bx - ax) * q / n, az + (bz - az) * q / n]; const p1 = [ax + (bx - ax) * (q + 1) / n, az + (bz - az) * (q + 1) / n];
        const nx = -(bz - az) / len; const nz = (bx - ax) / len;
        const at = (p, o, dy) => [p[0] + nx * o, height(p[0] + nx * o, p[1] + nz * o) + dy, p[1] + nz * o];
        const buf = B((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
        const yw = -0.75;
        withFx(buf, F.water, () => buf.quad(at(p0, -CREEK_HW, yw), at(p1, -CREEK_HW, yw), at(p1, CREEK_HW, yw), at(p0, CREEK_HW, yw), W, null, [0, 1, 0]));
        for (const s of [-1, 1]) {
          withFx(buf, F.dirt, () => buf.quad(at(p0, s * CREEK_HW, yw - 0.15), at(p1, s * CREEK_HW, yw - 0.15), at(p1, s * 7, -0.04), at(p0, s * 7, -0.04), bank, null, [0, 1, 0]));
          withFx(buf, F.grass, () => buf.quad(at(p0, s * 7, -0.04), at(p1, s * 7, -0.04), at(p1, s * 16, -0.05), at(p0, s * 16, -0.05), grass, null, [0, 1, 0]));
        }
        if (rnd() < 0.45) { const o = (rnd() * 2 - 1) * 4.2; const [rx, ry, rz] = at(p0, o, -0.62); withFx(buf, F.rock, () => blob(buf, rx, ry, rz, 0.55 + rnd() * 0.8, 0.5, rgb(rnd() < 0.5 ? '#b3a28a' : '#9d8f7c'))); }
        if (!low && rnd() < 0.3) { const s = rnd() < 0.5 ? -1 : 1; const [wx, wy, wz] = at(p0, s * (5.5 + rnd() * 2), -0.1); withFx(buf, F.foliage, () => blob(buf, wx, wy + 0.6, wz, 1.2 + rnd() * 0.7, 0.75, shade(willow, 0.9 + rnd() * 0.2))); }
      }
    }
  }
  for (const w of WATER.slice(1)) {
    const c = w.poly.reduce((a, p) => [a[0] + p[0] / w.poly.length, a[1] + p[1] / w.poly.length], [0, 0]);
    const buf = B(c[0], c[1]); const y = height(c[0], c[1]) + 0.06;
    const tr = THREE.ShapeUtils.triangulateShape(w.poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
    withFx(buf, F.water, () => { for (const [a, b2, c2] of tr) buf.tri([w.poly[a][0], y, w.poly[a][1]], [w.poly[b2][0], y, w.poly[b2][1]], [w.poly[c2][0], y, w.poly[c2][1]], rgb('#3f7f9c'), [0, 1, 0]); });
  }
  mark('creek');

  // ── lots, plazas, the mall's pavers, driveways ──────────────────────────────────────
  {
    let k = 0;
    for (const o of [...OPEN, ...L.lots]) {
      const poly = o.poly; const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
      const paint = o.paint || 'asphalt';
      const colr = paint === 'brick' ? rgb('#a3806e') : paint === 'dirt' ? rgb('#a88d68') : paint === 'concrete' ? rgb('#c9c6bf') : rgb('#56585c');
      const fx = paint === 'brick' ? F.brick : paint === 'dirt' ? F.dirt : paint === 'concrete' ? F.concrete : F.lot;
      const lift = paint === 'brick' ? 0.12 : o.drive ? 0.03 : 0.025;
      const buf = B(c[0], c[1]);
      const Y = (x, z) => height(x, z) + lift;
      if (poly.length === 4 && paint === 'brick') { // big plazas: tessellate so the paving follows the ground
        const xs = poly.map((p) => p[0]); const zs = poly.map((p) => p[1]);
        const ax = Math.min(...xs); const bx = Math.max(...xs); const az = Math.min(...zs); const bz = Math.max(...zs);
        for (let x = ax; x < bx - 0.01; x += 20) for (let z = az; z < bz - 0.01; z += 20) {
          const xe = Math.min(bx, x + 20); const ze = Math.min(bz, z + 20); const bb = B((x + xe) / 2, (z + ze) / 2);
          withFx(bb, fx, () => bb.quad([x, Y(x, ze), ze], [xe, Y(xe, ze), ze], [xe, Y(xe, z), z], [x, Y(x, z), z], colr, null, [0, 1, 0]));
        }
        continue;
      }
      const tr = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
      withFx(buf, fx, () => { for (const [a, b2, c2] of tr) buf.tri([poly[a][0], Y(poly[a][0], poly[a][1]), poly[a][1]], [poly[b2][0], Y(poly[b2][0], poly[b2][1]), poly[b2][1]], [poly[c2][0], Y(poly[c2][0], poly[c2][1]), poly[c2][1]], colr, [0, 1, 0]); });
      if (++k % 200 === 0) await slice();
    }
    if (!low) { // stall stripes (laid out with the parked cars in boulder-layout.js)
      const W2 = rgb('#e6e2d6');
      for (const [ax, az, bx, bz] of L.stripes) {
        const l = Math.hypot(bx - ax, bz - az) || 1; const nx = -(bz - az) / l * 0.06; const nz = (bx - ax) / l * 0.06;
        const ya = height(ax, az) + 0.04; const yb = height(bx, bz) + 0.04;
        B((ax + bx) / 2, (az + bz) / 2).quad([ax + nx, ya, az + nz], [bx + nx, yb, bz + nz], [bx - nx, yb, bz - nz], [ax - nx, ya, az - nz], W2, null, [0, 1, 0]);
      }
    }
  }
  await slice();
  mark('lots');

  // ── sidewalk corners: the engine draws curbs + sidewalks (roads[i].sidewalk) but leaves them
  // out next to junctions; fill those corners so downtown's sidewalks wrap round the blocks ──
  if (Array.isArray(kit.roads) && typeof kit.nearestRoad === 'function' && kit.palette && !low) {
    const R2 = kit.roads; const CURB = 0.16;
    const curbC = engineCol(kit.palette.curb || [0.8, 0.79, 0.76]); const walkC = engineCol(kit.palette.sidewalk || [0.76, 0.75, 0.72]); const faceC = shade(curbC, 0.88);
    const curbed = (o) => (o.kind === 'street' || o.kind === 'arterial') && !o.bridge;
    const nq = { road: -1, d: Infinity };
    const idxOf = new Map(R2.map((o, i) => [o, i]));
    for (let ri = 0; ri < R2.length; ri++) {
      const r = R2[ri]; const walk = r.sidewalk || 0;
      if (!curbed(r) || walk < 2.15) continue; // downtown, campus, commercial and the arterials
      if (ri % 8 === 0) await slice();
      const n = r.n; const hw = r.hw; const lift = r.kind === 'arterial' ? 0.045 : 0.04;
      const filt = (o) => o !== r && !o.bridge;
      const nx = new Float64Array(n); const nz = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const ia = i > 0 ? i - 1 : r.closed ? n - 2 : 0; const ib = i < n - 1 ? i + 1 : r.closed ? 1 : n - 1;
        let tx = r.x[ib] - r.x[ia]; let tz = r.z[ib] - r.z[ia]; const tl2 = Math.hypot(tx, tz) || 1; tx /= tl2; tz /= tl2; nx[i] = -tz; nz[i] = tx;
      }
      const join = new Uint8Array(n);
      for (let i = 0; i < n - 1; i++) {
        kit.nearestRoad((r.x[i] + r.x[i + 1]) / 2, (r.z[i] + r.z[i + 1]) / 2, nq, hw + 22, filt);
        if (nq.road >= 0 && nq.d < R2[nq.road].hw + Math.max(2.5, hw * 0.5)) join[i] = 1;
      }
      const noCurb = (i) => join[i] || (i > 0 && join[i - 1]) || (i < n - 2 && join[i + 1]);
      // is (x, z) on another road's asphalt, or inside a lower-index curbed road's sidewalk band?
      const blocked = (x, z) => {
        kit.nearestRoad(x, z, nq, 30, filt); if (nq.road < 0) return false;
        const o = R2[nq.road];
        if (nq.d < o.hw + 0.4) return true;
        if (curbed(o) && (o.sidewalk || 0) > 0 && idxOf.get(o) < ri && nq.d < o.hw + 0.35 + o.sidewalk + 0.05) return true;
        return false;
      };
      for (let i = 0; i < n - 1; i++) {
        if (!noCurb(i)) continue;
        const ax = r.x[i]; const az = r.z[i]; const bx = r.x[i + 1]; const bz = r.z[i + 1];
        const segL = Math.hypot(bx - ax, bz - az); const m = Math.max(1, Math.round(segL / 1.25));
        const buf = B((ax + bx) / 2, (az + bz) / 2);
        for (const sd of [-1, 1]) {
          const P = (t, o) => { const px = ax + (bx - ax) * t + (nx[i] + (nx[i + 1] - nx[i]) * t) * o * sd; const pz = az + (bz - az) * t + (nz[i] + (nz[i + 1] - nz[i]) * t) * o * sd; return [px, pz]; };
          const yE = (t) => { const e = P(t, hw); return gH(e[0], e[1]); };
          // walk the segment in ~1.25 m steps; draw each unblocked run as one strip
          const ok = new Uint8Array(m);
          for (let j = 0; j < m; j++) { const tm = (j + 0.5) / m; const cIn = P(tm, hw + 0.18); const cOut = P(tm, hw + 0.35 + walk * 0.5); ok[j] = blocked(cIn[0], cIn[1]) || blocked(cOut[0], cOut[1]) ? 0 : 1; }
          for (let j = 0; j < m;) {
            if (!ok[j]) { j++; continue; }
            let e = j; while (e < m && ok[e]) e++;
            const t0 = j / m; const t1 = e / m; j = e;
            const ya = yE(t0); const yb = yE(t1);
            const q = (o0, o1, colr) => {
              const a0 = P(t0, o0); const b0 = P(t1, o0); const b1 = P(t1, o1); const a1 = P(t0, o1);
              buf.fxv = F.concrete; buf.quad([a0[0], ya + CURB, a0[1]], [b0[0], yb + CURB, b0[1]], [b1[0], yb + CURB, b1[1]], [a1[0], ya + CURB, a1[1]], colr, null, [0, 1, 0]); buf.fxv = 0;
            };
            q(hw, hw + 0.35, curbC);
            q(hw + 0.35, hw + 0.35 + walk, walkC);
            { const a0 = P(t0, hw); const b0 = P(t1, hw); buf.fxv = F.concrete; buf.quad([a0[0], ya + lift, a0[1]], [b0[0], yb + lift, b0[1]], [b0[0], yb + CURB, b0[1]], [a0[0], ya + CURB, a0[1]], faceC, null, [-(nx[i]) * sd, 0, -(nz[i]) * sd]); buf.fxv = 0; }
          }
        }
      }
    }
  }
  mark('sidewalks');

  // ── bike lanes (Folsom, 30th, Valmont, Pearl): a solid line + a stencil every ~55 m ─────
  if (!low) {
    const W2 = rgb('#eceae2'); const lift = 0.045 + 0.032;
    for (const r of sm.list.filter((o) => o.src.bike && !o.bridge)) {
      const off = r.hw - 1.75;
      for (const sd of [-1, 1]) {
        let lastStencil = -1e9;
        for (let k = 0; k < r.n - 1; k++) {
          const ax = r.x[k]; const az = r.z[k]; const bx = r.x[k + 1]; const bz = r.z[k + 1]; const l = Math.hypot(bx - ax, bz - az) || 1;
          const nx = -(bz - az) / l * sd; const nz = (bx - ax) / l * sd;
          const mx = (ax + bx) / 2 + nx * off; const mz = (az + bz) / 2 + nz * off;
          if (sm.clearance(mx, mz, (o) => o !== r && !o.bridge) < 3) continue;
          const yA = (x, z, o) => { const e1 = gH(x - nx * r.hw, z - nz * r.hw); const e2 = gH(x + nx * r.hw, z + nz * r.hw); return e1 + (e2 - e1) * ((o + r.hw) / (2 * r.hw)) + lift; };
          const p = (x, z, o) => [x + nx * o, yA(x, z, o), z + nz * o];
          const buf = B(mx, mz);
          buf.fxv = F.road;
          buf.quad(p(ax, az, off - 0.07), p(bx, bz, off - 0.07), p(bx, bz, off + 0.07), p(ax, az, off + 0.07), W2, null, [0, 1, 0]);
          if (r.cum[k] - lastStencil > 55 && sd > 0 === (k % 2 === 0)) { // a bike-lane diamond in the lane
            lastStencil = r.cum[k];
            const cx = (ax + bx) / 2; const cz = (az + bz) / 2; const o = off + 0.85; const tx = (bx - ax) / l; const tz = (bz - az) / l;
            const D = (u, v) => { const x = cx + tx * u + nx * (o + v); const z = cz + tz * u + nz * (o + v); return [x, yA(cx + tx * u, cz + tz * u, o + v), z]; };
            buf.quad(D(-1.3, 0), D(0, -0.38), D(1.3, 0), D(0, 0.38), W2, null, [0, 1, 0]);
          }
          buf.fxv = 0;
        }
      }
    }
  }
  await slice();

  // ── buildings ────────────────────────────────────────────────────────────────────
  const AWN = ['#2f6f5e', '#8e2f2f', '#2f4f7f', '#b0802e', '#5b4a6b', '#3d6b3a', '#3a3a40'].map(rgb);
  let bc = 0;
  for (const b of L.buildings) {
    const buf = B(b.x, b.z); const v0 = buf.v; const i0 = buf.ni;
    drawBuilding(buf, b);
    if (OL && b.style !== 'stands' && !b.tower && (b.landmark || b.home || (b.w * b.d > 520 && /brick|sandstone|hotel|school|courthouse|theater/.test(b.style)))) buf.hull(v0, i0, OL * (b.w > 30 || b.h > 14 ? 1.6 : 1), INK);
    if (++bc % 100 === 0) await slice();
  }
  mark('buildings');
  // ── props: walls, rails, rocks, fences, bus stops, gantries, power lines, the mall, the home ──
  { let k = 0; for (const p of L.props) { drawProp(p); if (++k % 150 === 0) await slice(); } }
  await slice();
  // ── parked cars (their collision boxes are kind 'car' solids) ─────────────────────────
  { let k = 0; for (const c of L.parked) { drawCar(B(c.x, c.z), c); if (++k % 300 === 0) await slice(); } }
  mark('props');
  // ── decor trees (backyards, the foothill forest, the mesa's ponderosas) ──────────────────
  {
    const decor = L.decor.filter((d, i) => !d.far && (!low || i % 3 === 0 || d.solid));
    let k = 0;
    for (const d of decor) {
      drawTree(B(d.x, d.z), d);
      if (++k % 400 === 0) await slice();
    }
  }
  await slice();
  // Flagstaff summit: the stone amphitheatre inside the loop
  {
    const c = [-628, 836]; const y = height(c[0], c[1]);
    withFx(B(c[0], c[1]), F.rock, () => { for (let a = 0; a < 7; a++) { const ang = Math.PI * (0.15 + a * 0.12); boxW(B(c[0], c[1]), c[0] + Math.cos(ang) * 14, y, c[1] - Math.sin(ang) * 11, 5, 0.7, 1.2, -ang + Math.PI / 2, rgb('#b48a6e')); } });
  }
  mark('decor');

  // flush: one mesh per chunk
  let tris = 0; let meshes = 0;
  const free = function freeArray() { this.array = null; };
  for (const [grp, buf] of [...bufs]) {
    if (!buf || !buf.v) continue;
    const geo = new THREE.BufferGeometry();
    const nv = buf.v;
    if (dark) { // night: pull every colour towards the night sky (the ink outlines stay ink)
      const C = buf.C; const Fx = buf.F;
      for (let k = 0; k < nv; k++) if (Fx[k] !== 1 && Fx[k] !== 3) { const k3 = k * 3; C[k3] = C[k3] * 0.5 + 0.035; C[k3 + 1] = C[k3 + 1] * 0.5 + 0.035; C[k3 + 2] = C[k3 + 2] * 0.52 + 0.07; }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(buf.P.slice(0, nv * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(buf.N.slice(0, nv * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(buf.U.slice(0, nv * 2), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(buf.C.slice(0, nv * 3), 3));
    geo.setAttribute('fx', new THREE.BufferAttribute(buf.F.slice(0, nv), 1));
    geo.setIndex(new THREE.BufferAttribute(nv > 65535 ? buf.I.slice(0, buf.ni) : Uint16Array.from(buf.I.subarray(0, buf.ni)), 1));
    geo.computeBoundingSphere();
    // memory: once on the GPU, the CPU copies of everything but positions can go (a context loss
    // rebuilds the whole map, see world.js `released`)
    if (kit.release !== false) { for (const k of ['normal', 'uv', 'color', 'fx']) geo.getAttribute(k).onUpload(free); geo.index.onUpload(free); }
    const m = new THREE.Mesh(geo, mat); m.name = 'boulder-chunk'; m.userData.noMerge = true;
    if (grp.position && (grp.position.x || grp.position.y || grp.position.z)) m.position.set(-grp.position.x, -grp.position.y, -grp.position.z);
    m.matrixAutoUpdate = false; m.updateMatrix();
    grp.add(m); tris += buf.tris; meshes++;
    bufs.set(grp, null);
    if (meshes % 12 === 0) await slice();
  }
  mark('flush');
  root.userData.stats = { TT, TR, tris, meshes, terrTris, buildMs: Math.round(performance.now() - t0), layoutMs: Math.round(L.ms), solids: L.solids.length, buildings: L.buildings.length, parked: L.parked.length };
  return root;

  // ── helpers (hoisted) ─────────────────────────────────────────────────────────────
  function boxW(buf, x, y, z, w, h, d, rot, col, o = {}) {
    // box centred at (x, z) with base y; rot as THREE rotation.y; o.uv per face {front, side, top}
    const c = Math.cos(rot); const s = Math.sin(rot);
    const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const hw = w / 2; const hd = d / 2;
    const faces = [
      [[P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, h, -hd), P(-hw, h, -hd)], [-s * 1, 0, -c], o.front, 'f'],
      [[P(hw, 0, hd), P(-hw, 0, hd), P(-hw, h, hd), P(hw, h, hd)], [s, 0, c], o.back || o.side, 'b'],
      [[P(hw, 0, -hd), P(hw, 0, hd), P(hw, h, hd), P(hw, h, -hd)], [c, 0, -s], o.side, 's'],
      [[P(-hw, 0, hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(-hw, h, hd)], [-c, 0, s], o.side, 's'],
    ];
    for (const [q, n, uv, kind] of faces) {
      if (o.skip && o.skip.includes(kind)) continue;
      buf.quad(q[0], q[1], q[2], q[3], o.sideCol && kind !== 'f' ? o.sideCol : (o.frontCol && kind === 'f' ? o.frontCol : col), uv || null, n);
    }
    if (o.top !== false) buf.quad(P(-hw, h, -hd), P(hw, h, -hd), P(hw, h, hd), P(-hw, h, hd), o.topCol || shade(col, 0.92), o.topUV || null, [0, 1, 0]);
  }
  function blob(buf, x, y, z, r, sy, col) {
    const { v, f } = ico();
    for (const [a, b2, c2] of f) {
      const pa = [x + v[a][0] * r, y + v[a][1] * r * sy, z + v[a][2] * r];
      const pb = [x + v[b2][0] * r, y + v[b2][1] * r * sy, z + v[b2][2] * r];
      const pc = [x + v[c2][0] * r, y + v[c2][1] * r * sy, z + v[c2][2] * r];
      const m = [(v[a][0] + v[b2][0] + v[c2][0]), (v[a][1] + v[b2][1] + v[c2][1]), (v[a][2] + v[b2][2] + v[c2][2])];
      const k = 0.88 + 0.2 * Math.max(0, m[1] / 3);
      buf.tri(pa, pb, pc, shade(col, k), m);
    }
  }
  /** A cheap leafy clump: a jittered octahedron (8 triangles). */
  function clump(buf, x, y, z, r, sy, col, seed) {
    const j = (k) => 0.82 + 0.36 * (((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1);
    const a0 = seed * 6.2831;
    const ring = []; for (let k = 0; k < 4; k++) { const a = a0 + k * Math.PI / 2; ring.push([x + Math.cos(a) * r * j(k), y + (j(k + 4) - 1) * r * 0.3 * sy, z + Math.sin(a) * r * j(k)]); }
    const top = [x + (j(9) - 1) * r * 0.4, y + r * sy * j(10), z + (j(11) - 1) * r * 0.4]; const bot = [x, y - r * sy * 0.62, z];
    for (let k = 0; k < 4; k++) {
      const a = ring[k]; const b2 = ring[(k + 1) % 4]; const mx = (a[0] + b2[0]) / 2 - x; const mz = (a[2] + b2[2]) / 2 - z;
      buf.tri(a, b2, top, shade(col, 1.04), [mx, r * 0.6, mz]);
      buf.tri(b2, a, bot, shade(col, 0.8), [mx, -r * 0.5, mz]);
    }
  }
  function cone(buf, x, y, z, r, h, sides, col, rot = 0) {
    for (let i = 0; i < sides; i++) {
      const a0 = rot + i / sides * Math.PI * 2; const a1 = rot + (i + 1) / sides * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r]; const p1 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
      const am = (a0 + a1) / 2;
      buf.tri(p0, p1, [x, y + h, z], shade(col, 0.86 + 0.18 * Math.max(0, Math.cos(am - 2.4))), [Math.cos(am), r / h, Math.sin(am)]);
    }
  }
  function prism(buf, x, y, z, r, h, sides, col) {
    for (let i = 0; i < sides; i++) {
      const a0 = i / sides * Math.PI * 2; const a1 = (i + 1) / sides * Math.PI * 2; const am = (a0 + a1) / 2;
      buf.quad([x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a1) * r, y + h, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y + h, z + Math.sin(a0) * r], col, null, [Math.cos(am), 0, Math.sin(am)]);
    }
  }
  function drawTree(buf, d) {
    const s = d.s; const y = d.y; const c = d.c;
    if (d.type === 'pine') { // Douglas fir: two stacked cones
      const g1 = mix(rgb('#2f5a3a'), rgb('#4a7346'), c);
      prism(buf, d.x, y - 0.3, d.z, 0.26 * s, 2.2 * s, 4, rgb('#5a4030'));
      withFx(buf, F.foliage, () => { cone(buf, d.x, y + 1.4 * s, d.z, 2.4 * s, 5.2 * s, low ? 5 : 7, g1, c * 3); if (!low) cone(buf, d.x, y + 4.1 * s, d.z, 1.7 * s, 4.4 * s, 6, shade(g1, 1.1), c * 5); });
    } else if (d.type === 'ponderosa') { // a tall orange-barked trunk, an open, clumpy crown
      const g1 = mix(rgb('#3d5f37'), rgb('#557a43'), c);
      prism(buf, d.x, y - 0.3, d.z, 0.3 * s, 6.2 * s, 4, rgb('#7a4e33'));
      withFx(buf, F.foliage, () => {
        clump(buf, d.x, y + 7.2 * s, d.z, 2.6 * s, 0.9, g1, c);
        clump(buf, d.x + 1.1 * s * Math.cos(c * 9), y + 5.6 * s, d.z + 1.1 * s * Math.sin(c * 9), 2.2 * s, 0.75, shade(g1, 0.92), c + 0.37);
        if (!low) clump(buf, d.x - 0.8 * s * Math.cos(c * 7), y + 8.9 * s, d.z - 0.8 * s * Math.sin(c * 7), 1.6 * s, 0.9, shade(g1, 1.08), c + 0.71);
      });
    } else if (d.type === 'spruce') { // Colorado blue spruce: one narrow blue-green cone
      const g1 = mix(rgb('#4c6b62'), rgb('#5f7f6c'), c);
      prism(buf, d.x, y - 0.3, d.z, 0.22 * s, 1.2 * s, 4, rgb('#4a3a2e'));
      withFx(buf, F.foliage, () => cone(buf, d.x, y + 0.5 * s, d.z, 1.9 * s, 7.6 * s, 7, g1, c * 4));
    } else if (d.type === 'ash') { // green ash / maple: a rounded two-clump crown
      const g1 = mix(rgb('#5b8a3e'), rgb('#7aa24c'), c);
      prism(buf, d.x, y - 0.3, d.z, 0.3 * s, 3.6 * s, 4, rgb('#6b5a48'));
      withFx(buf, F.foliage, () => { clump(buf, d.x, y + 5.6 * s, d.z, 3.1 * s, 0.85, g1, c); clump(buf, d.x + 1.3 * s, y + 4.6 * s, d.z - 0.6 * s, 2.3 * s, 0.8, shade(g1, 0.9), c + 0.5); });
    } else { // a broad backyard elm / cottonwood
      const g1 = mix(rgb('#4f8a3c'), rgb('#76a048'), c);
      prism(buf, d.x, y - 0.3, d.z, 0.3 * s, 3.4 * s, 4, rgb('#6b4f3a'));
      withFx(buf, F.foliage, () => blob(buf, d.x, y + 5.4 * s, d.z, 3.4 * s, 0.85, g1));
    }
  }
  /** A sandstone outcrop / boulder: a chamfered block that fills its collision box (w × d, rot)
   *  without poking out of it; the top is inset, jittered and can lean like a Flatiron slab. */
  function rockBlock(buf, x, y, z, w, d, h, rot, col, lean = 0, seed = 0.5) {
    const c = Math.cos(rot); const s = Math.sin(rot);
    const W = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const hw = w / 2; const hd = d / 2; const ch = Math.min(hw, hd) * 0.42;
    const ring = [[-hw + ch, -hd], [hw - ch, -hd], [hw, -hd + ch], [hw, hd - ch], [hw - ch, hd], [-hw + ch, hd], [-hw, hd - ch], [-hw, -hd + ch]];
    const k = 0.64; const sh = lean * hw * 0.22;
    const jit = (i) => 0.74 + 0.26 * (((Math.sin((seed + i) * 91.7) * 43758.5) % 1 + 1) % 1);
    const bot = ring.map(([lx, lz]) => { const p = W(lx, lz); return [p[0], y - 0.5, p[1]]; });
    const top = ring.map(([lx, lz], i) => { const p = W(lx * k + sh, lz * k); return [p[0], y + h * jit(i) * (1 - Math.max(0, lx / hw) * lean * 0.35), p[1]]; });
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8; const m = W((ring[i][0] + ring[j][0]) / 2, (ring[i][1] + ring[j][1]) / 2); const nx = m[0] - x; const nz = m[1] - z;
      buf.quad(bot[i], bot[j], top[j], top[i], shade(col, 0.9 + 0.12 * (i % 3) / 2), null, [nx, 0.2, nz]);
    }
    const tc = top.reduce((a, p) => [a[0] + p[0] / 8, a[1] + p[1] / 8, a[2] + p[2] / 8], [0, 0, 0]); tc[1] += h * 0.05;
    for (let i = 0; i < 8; i++) buf.tri(top[i], top[(i + 1) % 8], tc, shade(col, 1.08), [0, 1, 0]);
  }
  /** A low-poly parked car (~36 triangles), nose along local +z. */
  function drawCar(buf, cr) {
    const { x, z, rot, shape } = cr; const y = cr.y; const w = cr.w; const d = cr.d;
    const paint = rgb(cr.color || '#888888'); const glass = rgb('#26303a'); const tyre = rgb('#1c1c1f');
    const c = Math.cos(rot); const s = Math.sin(rot);
    const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const hw = w / 2; const hd = d / 2;
    const tall = shape === 'suv' || shape === 'van'; const bodyT = tall ? 1.05 : 0.82; const yb = 0.3;
    // lower body (paint), no underside
    buf.fxv = F.paint;
    boxW(buf, x, y + yb, z, w, bodyT - yb + (tall ? 0.05 : 0), d, rot, paint, { topCol: shade(paint, 1.02) });
    // greenhouse: glass sides, painted roof
    const cabL = shape === 'pickup' ? d * 0.3 : shape === 'van' ? d * 0.78 : d * 0.5; const cabZ = shape === 'pickup' ? d * 0.08 : shape === 'van' ? -d * 0.06 : -d * 0.06;
    const cabH = tall ? 0.68 : 0.52; const yb2 = y + bodyT + (tall ? 0.05 : 0);
    const inF = shape === 'van' ? 0.12 : 0.42; const inR = shape === 'wagon' || shape === 'suv' || shape === 'van' ? 0.08 : 0.28;
    const b0 = [P(-hw + 0.08, bodyT, cabZ - cabL / 2), P(hw - 0.08, bodyT, cabZ - cabL / 2), P(hw - 0.08, bodyT, cabZ + cabL / 2), P(-hw + 0.08, bodyT, cabZ + cabL / 2)].map((p) => [p[0], yb2, p[2]]);
    const t0 = [P(-hw + 0.24, 0, cabZ - cabL / 2 + inR), P(hw - 0.24, 0, cabZ - cabL / 2 + inR), P(hw - 0.24, 0, cabZ + cabL / 2 - inF), P(-hw + 0.24, 0, cabZ + cabL / 2 - inF)].map((p) => [p[0], yb2 + cabH, p[2]]);
    buf.fxv = F.glass;
    buf.quad(b0[0], b0[1], t0[1], t0[0], glass, null, [-s, 0.4, -c]); // rear
    buf.quad(b0[2], b0[3], t0[3], t0[2], glass, null, [s, 0.5, c]); // windscreen
    buf.quad(b0[1], b0[2], t0[2], t0[1], glass, null, [c, 0.2, -s]);
    buf.quad(b0[3], b0[0], t0[0], t0[3], glass, null, [-c, 0.2, s]);
    buf.fxv = F.paint;
    buf.quad(t0[0], t0[1], t0[2], t0[3], shade(paint, 1.05), null, [0, 1, 0]);
    // wheels: the outer faces show under the body
    buf.fxv = F.trim;
    for (const lz of [-hd + 0.82, hd - 0.85]) for (const sd of [-1, 1]) {
      const a = P(sd * (hw + 0.01), 0, lz - 0.34); const b2 = P(sd * (hw + 0.01), 0, lz + 0.34); const bt = P(sd * (hw + 0.01), 0.64, lz + 0.34); const at2 = P(sd * (hw + 0.01), 0.64, lz - 0.34);
      buf.quad(a, b2, bt, at2, tyre, null, [sd * c, 0, -sd * s]);
    }
    // lamps: tail (red) and head (pale) strips
    buf.fxv = 0;
    for (const sd of [-1, 1]) {
      const a = P(sd * (hw - 0.12), bodyT - 0.32, -hd - 0.01); const b2 = P(sd * (hw - 0.5), bodyT - 0.32, -hd - 0.01);
      buf.quad(b2, a, [a[0], a[1] + 0.16, a[2]], [b2[0], b2[1] + 0.16, b2[2]], rgb('#b3262b'), null, [-s, 0, -c]);
    }
  }

  function wallBands(buf, A, B2, y0, bands, col, outward, segW) {
    // bands: [{ h, tile }] bottom → top; repeats each tile per ~segW metres
    const len = Math.hypot(B2[0] - A[0], B2[1] - A[1]); const nseg = Math.max(1, Math.round(len / segW));
    let y = y0;
    for (const bd of bands) {
      const uv = bd.tile == null ? null : tileUV(bd.tile);
      for (let s = 0; s < nseg; s++) {
        const a = [A[0] + (B2[0] - A[0]) * s / nseg, A[1] + (B2[1] - A[1]) * s / nseg];
        const b2 = [A[0] + (B2[0] - A[0]) * (s + 1) / nseg, A[1] + (B2[1] - A[1]) * (s + 1) / nseg];
        buf.quad([a[0], y, a[1]], [b2[0], y, b2[1]], [b2[0], y + bd.h, b2[1]], [a[0], y + bd.h, a[1]], bd.col || col, uv, outward);
      }
      y += bd.h;
    }
  }

  function drawBuilding(buf, b) {
    const c = Math.cos(b.rot); const s = Math.sin(b.rot);
    const W = (lx, lz) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
    const hw = b.w / 2; const hd = b.d / 2; const y0 = b.y; const col = rgb(b.color); const st = b.style;
    const corners = [W(-hw, -hd), W(hw, -hd), W(hw, hd), W(-hw, hd)]; // front-left, front-right, back-right, back-left (local)
    const outN = [[-s, 0, -c], [c, 0, -s], [s, 0, c], [-c, 0, s]]; // front, right, back, left
    const faceEnds = [[corners[1], corners[0]], [corners[2], corners[1]], [corners[3], corners[2]], [corners[0], corners[3]]]; // left → right seen from outside
    const floors = Math.max(1, b.floors || Math.round(b.h / 3.6));
    const fh = b.h / floors;
    let R = null;
    const single = (front, side, seg = 30) => ({ fg: front, fu: front, sg: side, su: side, seg, whole: true });
    switch (st) {
      case 'brick': R = { fg: T.brickShop, fu: b.seed < 0.5 ? T.brickUpper : T.brickArch, sg: T.brickUpper, su: T.brickUpper, seg: 9.5 }; break;
      case 'brickB': R = { fg: T.stoneShop, fu: T.brickUpper, sg: T.brickUpper, su: T.brickUpper, seg: 9.5 }; break;
      case 'sandstone': R = { fg: T.stoneShop, fu: T.stoneUpper, sg: T.stoneUpper, su: T.stoneUpper, seg: 9.5 }; break;
      case 'cu': R = b.tower ? single(T.cuUpper, T.cuUpper, 6) : { fg: T.cuGround, fu: T.cuUpper, sg: T.cuUpper, su: T.cuUpper, seg: 11 }; break;
      case 'oldmain': case 'school': R = { fg: T.schoolUpper, fu: T.schoolUpper, sg: T.schoolUpper, su: T.schoolUpper, seg: 10 }; break;
      case 'hotel': R = { fg: T.brickShop, fu: T.hotelUpper, sg: T.hotelUpper, su: T.hotelUpper, seg: 9 }; break;
      case 'courthouse': case 'courthouseTower': R = single(T.courtUpper, T.courtUpper, 7.5); break;
      case 'shop': case 'shopB': R = { fg: T.shopFront, fu: T.officeUpper, sg: T.boxWall, su: T.officeUpper, seg: 12 }; break;
      case 'box': R = single(T.boxFront, T.boxWall, 40); break;
      case 'office': case 'arena': R = { fg: T.officeUpper, fu: T.officeUpper, sg: T.officeUpper, su: T.officeUpper, seg: 12 }; break;
      case 'glass': case 'pressbox': R = { fg: T.glassUpper, fu: T.glassUpper, sg: T.glassUpper, su: T.glassUpper, seg: 10 }; break;
      case 'apartment': case 'apartmentS': R = { fg: T.aptUpper, fu: T.aptUpper, sg: T.aptUpper, su: T.aptUpper, seg: 11 }; break;
      case 'tower': R = { fg: T.towerUpper, fu: T.towerUpper, sg: T.towerUpper, su: T.towerUpper, seg: 11 }; break;
      case 'house': R = floors > 1 ? single(T.house2Front, T.houseSide, 14) : single(T.houseFront, T.houseSide, 14); break;
      case 'victorian': R = single(T.vicFront, T.houseSide, 13); break;
      case 'ranch': R = single(T.ranchFront, T.ranchSide, 16); break;
      case 'home': R = single(T.homeFront, T.ranchSide, 20); break;
      case 'garage': R = single(T.garageFront, b.attached ? T.ranchSide : T.blank, 10); break;
      case 'cottage': case 'auditorium': R = single(T.cottageFront, T.cottageFront, 9); break;
      case 'teahouse': R = single(T.courtUpper, T.courtUpper, 6); break;
      case 'theater': R = single(T.theaterFront, T.blank, 24); break;
      case 'ncar': R = single(T.ncar, T.ncar, 7); break;
      case 'stands': return drawStands(buf, b);
      case 'bandshell': return drawShell(buf, b);
      default: R = single(T.blank, T.blank, 20);
    }
    // sides and back of multi-storey blocks: one quad per face with the engine's procedural surface
    // (blank brick party walls downtown, a window grid elsewhere — lit at night); the street front
    // keeps the painted atlas facade
    const brickish = /brick|sandstone|hotel|school|oldmain/.test(st);
    const sideFx = kit.FX && !R.whole ? (brickish ? F.brick : st === 'glass' || st === 'tower' ? F.tower : F.windows) : -1;
    for (let f = 0; f < 4; f++) {
      const [A, Bp] = faceEnds[f]; const front = f === 0;
      if (!front && sideFx >= 0) {
        const yb = y0 - 1.6; const sc = brickish ? shade(col, 0.97) : col;
        withFx(buf, sideFx, () => buf.quad([A[0], yb, A[1]], [Bp[0], yb, Bp[1]], [Bp[0], y0 + b.h, Bp[1]], [A[0], y0 + b.h, A[1]], sc, null, outN[f]));
        continue;
      }
      const bands = [];
      const yBase = y0 - 1.6; // the bottom band runs 1.6 m into the ground (slopes, no gaps)
      if (R.whole) bands.push({ h: b.h + 1.6, tile: front ? R.fg : R.sg });
      else for (let k = 0; k < floors; k++) bands.push({ h: fh + (k ? 0 : 1.6), tile: k === 0 ? (front ? R.fg : R.sg) : (front ? R.fu : R.su) });
      const segW = front ? R.seg : R.whole ? R.seg * 0.8 : R.seg * 1.5;
      wallBands(buf, A, Bp, yBase, bands, col, outN[f], R.whole && (st === 'home' || st === 'garage' || st === 'theater' || st === 'box') ? 999 : segW);
    }
    const top = y0 + b.h;
    const rc = rgb(b.roofColor || '#7d766b');
    if (b.roof === 'flat' || !b.roof) {
      buf.quad([corners[0][0], top, corners[0][1]], [corners[1][0], top, corners[1][1]], [corners[2][0], top, corners[2][1]], [corners[3][0], top, corners[3][1]], rc, null, [0, 1, 0]);
      if (/brick|sandstone|hotel|courthouse|school|theater/.test(st) && !low) { // cornice band
        const k = 0.35; const C = [W(-hw - k, -hd - k), W(hw + k, -hd - k), W(hw + k, hd + k), W(-hw - k, hd + k)];
        const cc = shade(col, 1.12);
        for (let f = 0; f < 4; f++) { if (f === 2) continue; const a = C[f]; const b2 = C[(f + 1) % 4]; buf.quad([a[0], top - 0.7, a[1]], [b2[0], top - 0.7, b2[1]], [b2[0], top + 0.5, b2[1]], [a[0], top + 0.5, a[1]], cc, null, outN[f]); }
        buf.quad([C[0][0], top + 0.5, C[0][1]], [C[1][0], top + 0.5, C[1][1]], [C[2][0], top + 0.5, C[2][1]], [C[3][0], top + 0.5, C[3][1]], shade(cc, 0.9), null, [0, 1, 0]);
      }
      // rooftop units (HVAC boxes) on the bigger flat roofs
      if (!low && b.w * b.d > 320 && !b.landmark && b.seed != null && b.seed > 0.3 && /downtown|eastpearl|twentyninth|junction|commercial|east|campus/.test(b.zone || '')) {
        const n = 1 + Math.floor(b.seed * 1.9);
        withFx(buf, F.metal, () => { for (let k = 0; k < n; k++) { const u = ((b.seed * 7.31 + k * 0.37) % 1) - 0.5; const v = ((b.seed * 3.17 + k * 0.53) % 1) - 0.5; const [ux, uz] = W(u * (b.w - 5), v * (b.d - 5)); boxW(buf, ux, top + (/brick|sandstone|hotel|school/.test(st) ? 0.5 : 0), uz, 2.2 + k * 0.6, 1.2 + (k % 2) * 0.5, 1.8, b.rot, rgb('#a3a6a8')); } });
      }
    } else if (b.roof === 'gable' || b.roof === 'hip' || b.roof === 'pagoda') {
      const ov = b.roof === 'pagoda' ? 1.4 : 0.45; const rh = b.roofH || 2.5;
      const alongX = b.w >= b.d; // ridge along the longer side
      const A = alongX ? hw + ov : hd + ov; const Bh = alongX ? hd + ov : hw + ov; // half length / half span
      const ridge = b.roof === 'gable' ? A : Math.max(0, A - Bh);
      const LP = (u, v, y) => { const q = alongX ? W(u, v) : W(v, u); return [q[0], y, q[1]]; };
      const tiled = /cu|oldmain|teahouse/.test(st) || rc[0] > 0.6;
      const e0 = LP(-A, -Bh, top); const e1 = LP(A, -Bh, top); const e2 = LP(A, Bh, top); const e3 = LP(-A, Bh, top);
      const r0 = LP(-ridge, 0, top + rh); const r1 = LP(ridge, 0, top + rh);
      const outF = alongX ? outN[0] : outN[3]; const outB = alongX ? outN[2] : outN[1];
      const endL = alongX ? outN[3] : outN[0]; const endR = alongX ? outN[1] : outN[2];
      withFx(buf, tiled ? F.tile : F.shingle, () => {
        buf.quad(e0, e1, r1, r0, rc, null, [outF[0], 1, outF[2]]);
        buf.quad(e2, e3, r0, r1, shade(rc, 0.9), null, [outB[0], 1, outB[2]]);
        if (b.roof !== 'gable') { buf.tri(e3, e0, r0, shade(rc, 0.95), [endL[0], 1, endL[2]]); buf.tri(e1, e2, r1, shade(rc, 0.85), [endR[0], 1, endR[2]]); }
      });
      if (b.roof === 'gable') {
        const g0 = LP(-A + ov, -Bh + ov, top); const g3 = LP(-A + ov, Bh - ov, top); const g1 = LP(A - ov, -Bh + ov, top); const g2 = LP(A - ov, Bh - ov, top);
        const q0 = LP(-A + ov, 0, top + rh * (Bh - ov) / Bh); const q1 = LP(A - ov, 0, top + rh * (Bh - ov) / Bh);
        buf.tri(g0, g3, q0, col, endL); buf.tri(g1, g2, q1, col, endR);
        buf.tri(e3, e0, r0, shade(rc, 0.75), endL); buf.tri(e1, e2, r1, shade(rc, 0.75), endR);
      }
    } else if (b.roof === 'spire' || b.roof === 'dome') {
      const rh = b.roofH || 4; const ap = [b.x, top + rh, b.z];
      const ring = b.roof === 'dome' ? 10 : 4; const rr = b.roof === 'dome' ? Math.min(hw, hd) * 1.1 : null;
      const P = []; for (let i = 0; i < ring; i++) { const a = i / ring * Math.PI * 2 + Math.PI / 4; if (rr) P.push([b.x + Math.cos(a) * rr, top, b.z + Math.sin(a) * rr]); else { const q = W(Math.sign(Math.cos(a)) * hw, Math.sign(Math.sin(a)) * hd); P.push([q[0], top, q[1]]); } }
      if (rr) buf.quad([corners[0][0], top, corners[0][1]], [corners[1][0], top, corners[1][1]], [corners[2][0], top, corners[2][1]], [corners[3][0], top, corners[3][1]], shade(col, 0.8), null, [0, 1, 0]);
      withFx(buf, rr ? F.metal : F.tile, () => { for (let i = 0; i < ring; i++) { const a = P[i]; const b2 = P[(i + 1) % ring]; const m = [(a[0] + b2[0]) / 2 - b.x, 0.6, (a[2] + b2[2]) / 2 - b.z]; buf.tri(a, b2, ap, shade(rc, 0.9 + 0.1 * (i % 2)), m); } });
    }
    // extras: awnings + blade signs downtown, porches, chimneys, portico, tower clock
    if ((st === 'brick' || st === 'brickB' || st === 'sandstone' || st === 'hotel') && b.seed > 0.35 && !low) {
      const ac = AWN[Math.floor(b.seed * 97) % AWN.length]; const nA = Math.max(1, Math.round(b.w / 9.5));
      for (let k = 0; k < nA; k++) {
        const u0 = -hw + (k + 0.12) * b.w / nA; const u1 = -hw + (k + 0.88) * b.w / nA;
        const p0 = W(u0, -hd); const p1 = W(u1, -hd); const p2 = W(u1, -hd - 1.6); const p3 = W(u0, -hd - 1.6);
        buf.quad([p0[0], y0 + 3.6, p0[1]], [p1[0], y0 + 3.6, p1[1]], [p2[0], y0 + 2.9, p2[1]], [p3[0], y0 + 2.9, p3[1]], ac, null, [outN[0][0], 1, outN[0][2]]);
        buf.quad([p3[0], y0 + 2.9, p3[1]], [p2[0], y0 + 2.9, p2[1]], [p2[0], y0 + 2.5, p2[1]], [p3[0], y0 + 2.5, p3[1]], shade(ac, 0.8), null, outN[0]);
      }
    }
    if ((st === 'brick' || st === 'sandstone' || st === 'brickB') && b.seed < 0.42 && b.h > 6 && !low) { // a projecting blade sign at the first floor
      const q = Math.floor(b.seed * 40) % 4; const [u0, v0, u1, v1] = tileUV(T.blade); const du = (u1 - u0) / 2; const dv = (v1 - v0) / 2;
      const uv = [u0 + (q % 2) * du, v1 - (Math.floor(q / 2) + 1) * dv, u0 + (q % 2 + 1) * du, v1 - Math.floor(q / 2) * dv];
      const side = b.seed < 0.21 ? -1 : 1; const ux = side * (hw - 0.8);
      const a = W(ux, -hd - 0.15); const e = W(ux, -hd - 1.15); const yA = y0 + 4.2; const yB = y0 + 6.2;
      const fx = dark ? F.glow : 0;
      withFx(buf, fx, () => {
        buf.quad([a[0], yA, a[1]], [e[0], yA, e[1]], [e[0], yB, e[1]], [a[0], yB, a[1]], [1, 1, 1], uv, [c * side, 0, -s * side]);
        buf.quad([e[0], yA, e[1]], [a[0], yA, a[1]], [a[0], yB, a[1]], [e[0], yB, e[1]], [1, 1, 1], uv, [-c * side, 0, s * side]);
      });
    }
    if (b.porch && !low) {
      const pw = Math.min(b.w * 0.55, 6); const [px, pz] = W(0, -hd - 1.1);
      boxW(buf, px, y0 - 0.2, pz, pw, 0.45, 2.2, b.rot, rgb('#cfc6b6'));
      for (const u of [-pw / 2 + 0.2, pw / 2 - 0.2]) { const [qx, qz] = W(u, -hd - 2.0); boxW(buf, qx, y0, qz, 0.2, 2.7, 0.2, b.rot, rgb('#f2eee6'), { top: false }); }
      const a = W(-pw / 2 - 0.2, -hd); const b2 = W(pw / 2 + 0.2, -hd); const c2 = W(pw / 2 + 0.2, -hd - 2.4); const d2 = W(-pw / 2 - 0.2, -hd - 2.4);
      withFx(buf, F.shingle, () => buf.quad([a[0], y0 + 3.0, a[1]], [b2[0], y0 + 3.0, b2[1]], [c2[0], y0 + 2.6, c2[1]], [d2[0], y0 + 2.6, d2[1]], rc, null, [0, 1, 0]));
      { const [lx, lz] = W(pw * 0.3, -hd - 0.12); withFx(buf, F.glow, () => boxW(buf, lx, y0 + 2.2, lz, 0.22, 0.3, 0.18, b.rot, rgb(dark ? '#ffd890' : '#efe6cf'), { skip: ['b'] })); lamp(lx, y0 + 2.35, lz); } // the porch light
    }
    if (b.chimney && b.roof && b.roof !== 'flat' && !low) { const [cx, cz] = W(hw * 0.55, hd * 0.2); withFx(buf, F.brick, () => boxW(buf, cx, top - 0.5, cz, 0.9, (b.roofH || 2.5) + 1.3, 0.9, b.rot, rgb('#8f5a46'))); }
    if (b.portico) { // Norlin: columns along the west face
      for (let k = -2; k <= 2; k++) { const [cx, cz] = W(-hw - 2.2, k * 4.4); prism(buf, cx, y0, cz, 0.55, b.h - 2, 8, rgb('#efe2cc')); }
      const a = W(-hw, -11); const b2 = W(-hw, 11); const c2 = W(-hw - 3.2, 11); const d2 = W(-hw - 3.2, -11);
      buf.quad([d2[0], y0 + b.h - 2, d2[1]], [c2[0], y0 + b.h - 2, c2[1]], [b2[0], y0 + b.h - 2, b2[1]], [a[0], y0 + b.h - 2, a[1]], rgb('#e6d6bd'), null, [0, 1, 0]);
      buf.quad([d2[0], y0 + b.h - 3.4, d2[1]], [c2[0], y0 + b.h - 3.4, c2[1]], [c2[0], y0 + b.h - 2, c2[1]], [d2[0], y0 + b.h - 2, d2[1]], rgb('#efe2cc'), null, [-c, 0, s]);
    }
    if (st === 'courthouseTower') { const [cx, cz] = W(0, -hd - 0.05); blobDisk(buf, cx, y0 + b.h - 3.2, cz, 1.6, outN[0], rgb('#fbf7ea')); }
    if (st === 'teahouse' && !low) { for (const [u, v] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) { const [qx, qz] = W(u, v); prism(buf, qx, y0, qz, 0.45, b.h, 6, rgb('#2f6f6a')); } }
  }
  function blobDisk(buf, x, y, z, r, n, col) {
    const ux = -n[2]; const uz = n[0]; const seg = 10;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2; const a1 = (i + 1) / seg * Math.PI * 2;
      buf.tri([x, y, z], [x + ux * Math.cos(a0) * r, y + Math.sin(a0) * r, z + uz * Math.cos(a0) * r], [x + ux * Math.cos(a1) * r, y + Math.sin(a1) * r, z + uz * Math.cos(a1) * r], col, n);
    }
  }
  function drawStands(buf, b) {
    // a seating wedge rising away from the field + a back wall; side tells which way is "out"
    const out = { west: [-1, 0], east: [1, 0], south: [0, 1] }[b.side] || [0, 1];
    const hw = b.w / 2; const hd = b.d / 2; const y0 = b.y; const h = b.h;
    const inner = out[0] ? [[b.x - out[0] * hw, b.z - hd], [b.x - out[0] * hw, b.z + hd]] : [[b.x - hw, b.z - out[1] * hd], [b.x + hw, b.z - out[1] * hd]];
    const outer = out[0] ? [[b.x + out[0] * hw, b.z - hd], [b.x + out[0] * hw, b.z + hd]] : [[b.x - hw, b.z + out[1] * hd], [b.x + hw, b.z + out[1] * hd]];
    const uv = tileUV(T.seats); const col = rgb('#f2eee6'); const conc = rgb(b.color);
    const len = Math.hypot(inner[1][0] - inner[0][0], inner[1][1] - inner[0][1]); const n = Math.max(1, Math.round(len / 12));
    for (let k = 0; k < n; k++) {
      const f0 = k / n; const f1 = (k + 1) / n;
      const I0 = [inner[0][0] + (inner[1][0] - inner[0][0]) * f0, inner[0][1] + (inner[1][1] - inner[0][1]) * f0]; const I1 = [inner[0][0] + (inner[1][0] - inner[0][0]) * f1, inner[0][1] + (inner[1][1] - inner[0][1]) * f1];
      const O0 = [outer[0][0] + (outer[1][0] - outer[0][0]) * f0, outer[0][1] + (outer[1][1] - outer[0][1]) * f0]; const O1 = [outer[0][0] + (outer[1][0] - outer[0][0]) * f1, outer[0][1] + (outer[1][1] - outer[0][1]) * f1];
      buf.quad([I0[0], y0 + 1.2, I0[1]], [I1[0], y0 + 1.2, I1[1]], [O1[0], y0 + h, O1[1]], [O0[0], y0 + h, O0[1]], col, uv, [-out[0], 1, -out[1]]);
      withFx(buf, F.concrete, () => {
        buf.quad([O0[0], y0 - 1, O0[1]], [O1[0], y0 - 1, O1[1]], [O1[0], y0 + h + 1.2, O1[1]], [O0[0], y0 + h + 1.2, O0[1]], conc, null, [out[0], 0, out[1]]);
        buf.quad([I0[0], y0 - 1, I0[1]], [I1[0], y0 - 1, I1[1]], [I1[0], y0 + 1.2, I1[1]], [I0[0], y0 + 1.2, I0[1]], shade(conc, 0.8), null, [-out[0], 0, -out[1]]);
      });
    }
    withFx(buf, F.concrete, () => { for (const e of [0, 1]) buf.quad([inner[e][0], y0 - 1, inner[e][1]], [outer[e][0], y0 - 1, outer[e][1]], [outer[e][0], y0 + h + 1.2, outer[e][1]], [inner[e][0], y0 + 1.2, inner[e][1]], shade(conc, 0.9), null, out[0] ? [0, 0, e ? 1 : -1] : [e ? 1 : -1, 0, 0]); });
  }
  function drawShell(buf, b) {
    // Central Park's bandshell: a stage filling the footprint, a quarter-dome shell at its back (+z)
    const y0 = b.y; const cx = b.x; const cz = b.z; const hw = b.w / 2; const hd = b.d / 2; const R0 = hw; const segs = 8; const col = rgb('#efe9dc');
    withFx(buf, F.concrete, () => boxW(buf, cx, y0, cz, b.w, 1.0, b.d, 0, rgb('#cbbfa9')));
    const back = cz + hd - 0.15; const depth = Math.min(4.6, b.d * 0.45);
    for (let i = 0; i < segs; i++) {
      const a0 = Math.PI * i / segs; const a1 = Math.PI * (i + 1) / segs;
      for (let j = 0; j < 3; j++) {
        const e0 = j / 3 * Math.PI / 2; const e1 = (j + 1) / 3 * Math.PI / 2;
        const P = (a, e) => [cx + Math.cos(a) * R0 * Math.cos(e), y0 + 1 + Math.sin(e) * 6, back - Math.sin(a) * depth * Math.cos(e)];
        const am = (a0 + a1) / 2;
        buf.quad(P(a0, e0), P(a1, e0), P(a1, e1), P(a0, e1), shade(col, 0.85 + 0.05 * j), null, [-Math.cos(am), -0.3, Math.sin(am)]);
        buf.quad(P(a1, e0), P(a0, e0), P(a0, e1), P(a1, e1), shade(col, 0.95), null, [Math.cos(am), 0.3, -Math.sin(am)]);
      }
    }
  }

  function drawProp(p) {
    const buf = B(p.x != null ? p.x : p.ax != null ? (p.ax + p.bx) / 2 : p.pts[0][0], p.z != null ? p.z : p.az != null ? (p.az + p.bz) / 2 : p.pts[0][1]);
    switch (p.type) {
      case 'jersey': case 'rail': case 'soundwall': {
        const L2 = Math.hypot(p.bx - p.ax, p.bz - p.az); const rot = Math.atan2(-(p.bz - p.az), p.bx - p.ax);
        const mx = (p.ax + p.bx) / 2; const mz = (p.az + p.bz) / 2; const y = Math.min(p.ya, p.yb);
        if (p.type === 'rail') {
          withFx(buf, F.metal, () => boxW(buf, mx, y + 0.45, mz, L2 + 0.1, 0.32, 0.12, rot, rgb('#b8bcbf'), { topCol: rgb('#d9dcdf') }));
          withFx(buf, F.wood, () => boxW(buf, p.ax, y - 0.2, p.az, 0.18, 0.9, 0.18, rot, rgb('#6f6a5e'), { top: false }));
        } else if (p.type === 'jersey') {
          withFx(buf, F.concrete, () => { boxW(buf, mx, y - 0.1, mz, L2 + 0.05, 0.45, p.thick, rot, rgb('#b3aea4')); boxW(buf, mx, y + 0.35, mz, L2 + 0.05, p.h - 0.35, p.thick * 0.5, rot, rgb('#aba69c')); });
        } else {
          withFx(buf, F.concrete, () => {
            boxW(buf, mx, y - 0.5, mz, L2 + 0.05, p.h + 0.5, p.thick, rot, rgb('#c2b9a8'));
            boxW(buf, p.ax, y - 0.5, p.az, 0.5, p.h + 0.8, p.thick + 0.25, rot, rgb('#b0a795')); // pilaster
            boxW(buf, mx, y + p.h, mz, L2 + 0.05, 0.22, p.thick + 0.14, rot, rgb('#d2cabb'), { skip: [] }); // cap
          });
        }
        break;
      }
      case 'rock': {
        const col = p.sand ? rgb('#c89a76') : mix(rgb('#a8705a'), rgb('#bf8f72'), ((p.rot * 7.13) % 1 + 1) % 1);
        const v0 = buf.v; const i0 = buf.ni;
        withFx(buf, F.rock, () => rockBlock(buf, p.x, p.y, p.z, p.w || p.s * 1.6, p.d || p.s * 1.3, p.h || p.s * 0.9, p.rot || 0, col, p.lean || 0, p.x * 0.013 + p.z * 0.007));
        if (OL && p.outcrop) buf.hull(v0, i0, OL, INK);
        break;
      }
      case 'planter': {
        const y = height(p.x, p.z) + 0.1;
        withFx(buf, F.brick, () => boxW(buf, p.x, y, p.z, p.w, 0.6, p.d, 0, rgb('#9a5f4c'), { top: false }));
        buf.quad([p.x - p.w / 2 + 0.15, y + 0.58, p.z + p.d / 2 - 0.15], [p.x + p.w / 2 - 0.15, y + 0.58, p.z + p.d / 2 - 0.15], [p.x + p.w / 2 - 0.15, y + 0.58, p.z - p.d / 2 + 0.15], [p.x - p.w / 2 + 0.15, y + 0.58, p.z - p.d / 2 + 0.15], rgb('#d9e6c6'), tileUV(T.flowers), [0, 1, 0]);
        break;
      }
      case 'bench': { const y = height(p.x, p.z) + 0.1; withFx(buf, F.wood, () => { boxW(buf, p.x, y + 0.4, p.z, 2.2, 0.1, 0.55, p.rot, rgb('#7a5a3a')); boxW(buf, p.x, y + 0.5, p.z + 0.25, 2.2, 0.4, 0.08, p.rot, rgb('#6f5236')); }); withFx(buf, F.metal, () => boxW(buf, p.x, y, p.z, 0.12, 0.4, 0.5, p.rot, rgb('#3a3a3a'), { top: false })); break; }
      case 'kiosk': { const y = height(p.x, p.z) + 0.1; boxW(buf, p.x, y, p.z, 1.6, 2.5, 1.6, 0, rgb('#2f5d50'), { front: tileUV(T.busAd), back: tileUV(T.busAd), frontCol: [1, 1, 1] }); withFx(buf, F.metal, () => cone(buf, p.x, y + 2.5, p.z, 1.15, 0.7, 6, rgb('#2a4a40'))); break; }
      case 'mallLamp': {
        const y = height(p.x, p.z) + 0.1;
        withFx(buf, F.metal, () => { prism(buf, p.x, y, p.z, 0.12, 4.0, 6, rgb('#2e3b33')); cone(buf, p.x, y + 4.45, p.z, 0.3, 0.35, 6, rgb('#2e3b33')); });
        withFx(buf, F.glow, () => blob(buf, p.x, y + 4.2, p.z, 0.27, 1.1, rgb(dark ? '#fff1c9' : '#f4efe2')));
        lamp(p.x, y + 4.2, p.z);
        break;
      }
      case 'grate': { const y = height(p.x, p.z) + 0.19; buf.quad([p.x - 0.7, y, p.z + 0.7], [p.x + 0.7, y, p.z + 0.7], [p.x + 0.7, y, p.z - 0.7], [p.x - 0.7, y, p.z - 0.7], rgb('#3d3b38'), null, [0, 1, 0]); break; }
      case 'fence': {
        const y = height(p.x, p.z);
        withFx(buf, F.wood, () => boxW(buf, p.x, y - 0.1, p.z, 0.1, 1.75, p.len, p.rot, rgb(p.col), { topCol: shade(rgb(p.col), 0.8) }));
        break;
      }
      case 'busstop': {
        const c = Math.cos(p.rot); const s = Math.sin(p.rot); const W = (lx, lz) => [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
        const y = height(p.x, p.z); const glass = rgb('#9db4bf');
        withFx(buf, F.glass, () => { const [bx, bz] = W(0, 0.68); boxW(buf, bx, y + 0.25, bz, 3.7, 2.0, 0.06, p.rot, glass, { top: false }); for (const sd of [-1, 1]) { const [sx, sz] = W(sd * 1.82, 0.05); boxW(buf, sx, y + 0.25, sz, 0.06, 2.0, 1.3, p.rot, glass, { top: false }); } });
        withFx(buf, F.metal, () => {
          boxW(buf, p.x, y + 2.45, p.z, 4.0, 0.12, 1.7, p.rot, rgb('#3d4a52'));
          for (const [lx, lz] of [[-1.85, -0.75], [1.85, -0.75], [-1.85, 0.75], [1.85, 0.75]]) { const [qx, qz] = W(lx, lz); boxW(buf, qx, y, qz, 0.08, 2.45, 0.08, p.rot, rgb('#3d4a52'), { top: false }); }
        });
        { const [ax, az] = W(1.5, 0.62); boxW(buf, ax, y + 0.3, az, 1.1, 1.9, 0.08, p.rot, [1, 1, 1], { front: tileUV(T.busAd), frontCol: [1, 1, 1], sideCol: rgb('#3d4a52') }); }
        withFx(buf, F.wood, () => { const [qx, qz] = W(-0.4, 0.35); boxW(buf, qx, y + 0.45, qz, 2.0, 0.08, 0.42, p.rot, rgb('#7a5a3a')); });
        lamp(p.x, y + 2.3, p.z);
        break;
      }
      case 'gantry': {
        const yv = (v) => height(...usPt(p.u, v));
        const y0 = Math.max(yv(p.v0), yv(p.v1));
        const rotA = Math.atan2(-US36.dz, US36.dx); // local +x along US-36 (SE)
        withFx(buf, F.metal, () => {
          for (const v of [p.v0, p.v1]) { const [x, z] = usPt(p.u, v); boxW(buf, x, yv(v) - 0.3, z, 0.55, 8.9 + (y0 - yv(v)), 0.55, rotA, rgb('#8d9296')); }
          const [ma, mb] = usPt(p.u, 0); const span = p.v1 - p.v0 + 0.6;
          boxW(buf, ma, y0 + 7.5, mb, 0.7, 0.9, span, rotA, rgb('#9aa0a4')); // the truss (local z runs across the road, NE)
        });
        // the signs: SE-bound (v < 0) faces NW traffic coming from −u; NW-bound faces +u
        for (const [v, tile, face] of [[-6.2, T.gantryA, -1], [6.2, T.gantryB, 1]]) {
          const [x, z] = usPt(p.u + face * 0.45, v);
          const rot = face < 0 ? Math.atan2(US36.dx, US36.dz) : Math.atan2(-US36.dx, -US36.dz); // the front (local −z) looks along −u / +u
          boxW(buf, x, y0 + 5.4, z, 8.8, 2.6, 0.18, rot, rgb('#1f6b45'), { front: tileUV(tile), frontCol: [1, 1, 1] });
        }
        break;
      }
      case 'power': {
        const wood = rgb('#6b5440'); const wire = [0.12, 0.12, 0.13];
        const pts = p.pts;
        for (let k = 0; k < pts.length; k++) {
          const [x, z, y] = pts[k]; const q = B(x, z);
          const nb = pts[k + 1] || pts[k - 1]; const dx = nb[0] - x; const dz = nb[1] - z; const l = Math.hypot(dx, dz) || 1;
          const arm = Math.atan2(dx, dz) + Math.PI / 2;
          withFx(q, F.wood, () => { prism(q, x, y - 0.3, z, 0.15, 9.3, 5, wood); boxW(q, x, y + 8.25, z, 0.14, 0.14, 2.3, arm, shade(wood, 0.9)); });
          if (k === pts.length - 1) break;
          const [x2, z2, y2] = pts[k + 1]; if (Math.hypot(x2 - x, z2 - z) > 46) continue;
          const ux = -dz / l; const uz = dx / l; // across the line
          q.fxv = F.ink;
          for (const o of [-1.0, 0, 1.0]) {
            const segs = 3; let prev = null;
            for (let j = 0; j <= segs; j++) {
              const t = j / segs; const sag = 0.55 * 4 * t * (1 - t);
              const px = x + (x2 - x) * t + ux * o; const pz = z + (z2 - z) * t + uz * o; const py = y + (y2 - y) * t + 8.38 - sag;
              if (prev) {
                q.quad([prev[0], prev[1] - 0.025, prev[2]], [px, py - 0.025, pz], [px, py + 0.025, pz], [prev[0], prev[1] + 0.025, prev[2]], wire, null, [ux, 0, uz]);
                q.quad([prev[0] - ux * 0.025, prev[1], prev[2] - uz * 0.025], [px - ux * 0.025, py, pz - uz * 0.025], [px + ux * 0.025, py, pz + uz * 0.025], [prev[0] + ux * 0.025, prev[1], prev[2] + uz * 0.025], wire, null, [0, -1, 0]);
              }
              prev = [px, py, pz];
            }
          }
          q.fxv = 0;
        }
        break;
      }
      case 'busker': {
        const y = height(p.x, p.z) + 0.1; const skin = rgb('#d9a882');
        if (p.act === 'box') {
          withFx(buf, F.glass, () => boxW(buf, p.x, y, p.z, 0.9, 0.9, 0.9, 0.3, rgb('#cfe6f2')));
          prism(buf, p.x, y + 0.9, p.z, 0.22, 0.75, 6, rgb('#c84a3a')); blob(buf, p.x, y + 1.85, p.z, 0.2, 1, skin);
        } else if (p.act === 'piano') {
          boxW(buf, p.x, y, p.z, 1.6, 1.25, 0.7, 0, rgb('#2b2522')); boxW(buf, p.x, y + 0.8, p.z - 0.5, 1.5, 0.08, 0.3, 0, rgb('#f2f0ea'));
          prism(buf, p.x, y, p.z - 1.1, 0.24, 1.0, 6, rgb('#3b5fa0')); blob(buf, p.x, y + 1.3, p.z - 1.1, 0.2, 1, skin);
        } else if (p.act === 'juggler') {
          prism(buf, p.x, y, p.z, 0.25, 1.2, 6, rgb('#e0b44e')); blob(buf, p.x, y + 1.45, p.z, 0.21, 1, skin);
          for (let k = 0; k < 3; k++) blob(buf, p.x + (k - 1) * 0.35, y + 2.0 + (k % 2) * 0.3, p.z, 0.09, 1, rgb(['#e94f64', '#2f8f8f', '#f08a3c'][k]));
          boxW(buf, p.x + 0.9, y, p.z + 0.5, 0.6, 0.5, 0.6, 0.4, rgb('#7a3b2b'));
        } else {
          prism(buf, p.x, y, p.z, 0.24, 1.2, 6, rgb('#3d6b3a')); blob(buf, p.x, y + 1.45, p.z, 0.2, 1, skin);
          boxW(buf, p.x + 0.8, y, p.z + 0.4, 1.0, 0.15, 0.4, 0.2, rgb('#2b2522'));
        }
        break;
      }
      case 'field': {
        const y = height(p.x, p.z) + 0.08; const uv = tileUV(T.turf);
        const x0 = p.x - p.w / 2; const z0 = p.z - p.d / 2;
        if (p.plain) { withFx(buf, F.grass, () => buf.quad([x0, y, z0 + p.d], [x0 + p.w, y, z0 + p.d], [x0 + p.w, y, z0], [x0, y, z0], rgb('#5c9f48'), null, [0, 1, 0])); for (const f of [0.02, 0.5, 0.98]) { const xx = x0 + p.w * f; buf.quad([xx - 0.15, y + 0.01, z0 + p.d], [xx + 0.15, y + 0.01, z0 + p.d], [xx + 0.15, y + 0.01, z0], [xx - 0.15, y + 0.01, z0], rgb('#ffffff'), null, [0, 1, 0]); } break; }
        for (let k = 0; k < 10; k++) { const za = z0 + p.d * k / 10; const zb = z0 + p.d * (k + 1) / 10; buf.quad([x0, y, zb], [x0 + p.w, y, zb], [x0 + p.w, y, za], [x0, y, za], k === 0 || k === 9 ? rgb('#2b2b2b') : rgb(k % 2 ? '#5aa646' : '#4f9a3e'), k === 0 || k === 9 ? null : uv, [0, 1, 0]); }
        for (let k = 1; k < 10; k++) { const zz = z0 + p.d * k / 10; buf.quad([x0 + 2, y + 0.01, zz + 0.2], [x0 + p.w - 2, y + 0.01, zz + 0.2], [x0 + p.w - 2, y + 0.01, zz - 0.2], [x0 + 2, y + 0.01, zz - 0.2], rgb('#ffffff'), null, [0, 1, 0]); }
        buf.quad([p.x - 6, y + 0.02, p.z + 6], [p.x + 6, y + 0.02, p.z + 6], [p.x + 6, y + 0.02, p.z - 6], [p.x - 6, y + 0.02, p.z - 6], rgb('#cfb87c'), null, [0, 1, 0]);
        break;
      }
      case 'quadPaths': { // the quad's crossing flagstone paths
        const y = height(p.x, p.z) + 0.08; const col = rgb('#cdbb9c'); const hw2 = p.w / 2; const hd2 = p.d / 2; const t = 1.6;
        const strip = (ax, az, bx, bz) => { const l = Math.hypot(bx - ax, bz - az); const nx = -(bz - az) / l * t; const nz = (bx - ax) / l * t; buf.quad([ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz], col, null, [0, 1, 0]); };
        withFx(buf, F.concrete, () => { strip(p.x - hw2, p.z - hd2, p.x + hw2, p.z + hd2); strip(p.x - hw2, p.z + hd2, p.x + hw2, p.z - hd2); strip(p.x - hw2, p.z, p.x + hw2, p.z); });
        break;
      }
      case 'homeDetail': {
        const c = Math.cos(p.rot); const s = Math.sin(p.rot); const y = height(p.x, p.z);
        const W = (lx, lz) => [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
        // walkway from the driveway to the front door, flower beds, a picket fence on the side yard, a hoop
        const wv = [W(-7.5, -5.0), W(4.6, -5.0), W(4.6, -6.3), W(-7.5, -6.3)];
        withFx(buf, F.concrete, () => buf.quad([wv[0][0], y + 0.09, wv[0][1]], [wv[1][0], y + 0.09, wv[1][1]], [wv[2][0], y + 0.09, wv[2][1]], [wv[3][0], y + 0.09, wv[3][1]], rgb('#cfcbc2'), null, [0, 1, 0]));
        for (const [u, w2] of [[-2.2, 5.2], [6.6, 4.2]]) { const [fx, fz] = W(u, -5.7); withFx(buf, F.wood, () => boxW(buf, fx, y, fz, w2, 0.35, 1.1, p.rot, rgb('#7a5a3a'), { top: false })); const a = W(u - w2 / 2 + 0.08, -5.18); const b2 = W(u + w2 / 2 - 0.08, -5.18); const c2 = W(u + w2 / 2 - 0.08, -6.22); const d2 = W(u - w2 / 2 + 0.08, -6.22); buf.quad([d2[0], y + 0.34, d2[1]], [c2[0], y + 0.34, c2[1]], [b2[0], y + 0.34, b2[1]], [a[0], y + 0.34, a[1]], rgb('#e6eedc'), tileUV(T.flowers), [0, 1, 0]); }
        for (let k = 0; k < 9; k++) { const [fx, fz] = W(8.2, -4.6 + k * 1.2); boxW(buf, fx, y, fz, 0.12, 1.0, 0.1, p.rot, rgb('#f4f1ea'), { top: false }); }
        { const [fx, fz] = W(8.2, 0.2); boxW(buf, fx, y + 0.45, fz, 0.06, 0.12, 9.8, p.rot, rgb('#f4f1ea')); }
        { const [hx, hz] = W(-13.6, -3.4); withFx(buf, F.metal, () => boxW(buf, hx, y, hz, 0.15, 3.2, 0.15, p.rot, rgb('#4a4a4a'), { top: false })); boxW(buf, hx, y + 3.0, hz, 1.2, 0.8, 0.06, p.rot, rgb('#ffffff')); }
        { const a = W(1.2, -5.0); const b2 = W(5.6, -5.0); const c2 = W(5.6, -7.0); const d2 = W(1.2, -7.0);
          withFx(buf, F.shingle, () => buf.quad([a[0], y + 3.0, a[1]], [b2[0], y + 3.0, b2[1]], [c2[0], y + 2.6, c2[1]], [d2[0], y + 2.6, d2[1]], rgb('#4b4f5a'), null, [0, 1, 0]));
          const [lx, lz] = W(5.4, -6.9); boxW(buf, lx, y, lz, 0.14, 2.6, 0.14, p.rot, rgb('#f4f1ea'), { top: false });
          const [gx, gz] = W(1.4, -6.9); boxW(buf, gx, y, gz, 0.14, 2.6, 0.14, p.rot, rgb('#f4f1ea'), { top: false });
          const [px, pz] = W(4.6, -5.12); withFx(buf, F.glow, () => blob(buf, px, y + 2.2, pz, 0.16, 1, rgb('#ffd27a'))); lamp(px, y + 2.3, pz); }
        break;
      }
      default:
    }
  }
}
