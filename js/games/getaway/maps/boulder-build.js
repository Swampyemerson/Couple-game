// Boulder for Getaway: build(THREE, kit) — everything visual except the engine's road ribbons
// and its breakable props: terrain, sidewalks, lots and plazas, Boulder Creek, buildings, walls,
// rails, rocks, street furniture and the decor forest. One merged mesh per 200 m chunk (one
// material: vertex colours over the facade atlas), so a chunk costs one draw call.
import { BOUNDS, OPEN, WATER, CREEK, CREEK_HW, MALL, footX } from './boulder-data.js';
import { layout, smoothedRoads, height, HEIGHT_GRID, zoneAt, SIDEWALK, mulberry } from './boulder-layout.js';
import { makeAtlas, tileUV, T } from './boulder-atlas.js';

// ── merged-geometry buffer ───────────────────────────────────────────────────
const WHITE_UV = (() => { const [u0, v0, u1, v1] = tileUV(T.white); return [(u0 + u1) / 2, (v0 + v1) / 2]; })();
class Buf {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.f = []; this.v = 0; this.fxv = 0; }
  _fx(k) { for (let q = 0; q < k; q++) this.f.push(this.fxv); }
  /** Ink outline (inverted hull) for the vertices/triangles added since (v0, i0): positions
   *  pushed out along their averaged normals by `ol`, winding reversed, unlit ink colour. */
  hull(v0, i0, ol, ink) {
    const v1 = this.v; const i1 = this.i.length; const acc = new Map(); const key = (q) => `${Math.round(this.p[q * 3] * 50)},${Math.round(this.p[q * 3 + 1] * 50)},${Math.round(this.p[q * 3 + 2] * 50)}`;
    for (let q = v0; q < v1; q++) { const k = key(q); let e = acc.get(k); if (!e) { e = [0, 0, 0]; acc.set(k, e); } e[0] += this.n[q * 3]; e[1] += this.n[q * 3 + 1]; e[2] += this.n[q * 3 + 2]; }
    const base = this.v;
    for (let q = v0; q < v1; q++) {
      const e = acc.get(key(q)); const l = Math.hypot(e[0], e[1], e[2]) || 1;
      this.p.push(this.p[q * 3] + e[0] / l * ol, this.p[q * 3 + 1] + e[1] / l * ol, this.p[q * 3 + 2] + e[2] / l * ol);
      this.n.push(-this.n[q * 3], -this.n[q * 3 + 1], -this.n[q * 3 + 2]); this.c.push(ink[0], ink[1], ink[2]); this.u.push(WHITE_UV[0], WHITE_UV[1]); this.f.push(1);
    }
    for (let k = i0; k < i1; k += 3) this.i.push(base + this.i[k] - v0, base + this.i[k + 2] - v0, base + this.i[k + 1] - v0);
    this.v += v1 - v0;
  }
  /** Quad a→b→c→d (counter-clockwise seen from `hint`'s side), colour [r,g,b], uv rect or null. */
  quad(a, b, c, d, col, uv, hint) {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = d[0] - a[0]; const vy = d[1] - a[1]; const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    let flip = false;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { flip = true; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const v = this.v;
    for (const p of [a, b, c, d]) { this.p.push(p[0], p[1], p[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
    this._fx(4);
    if (uv) this.u.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
    else for (let k = 0; k < 4; k++) this.u.push(WHITE_UV[0], WHITE_UV[1]);
    if (flip) this.i.push(v, v + 2, v + 1, v, v + 3, v + 2); else this.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.v += 4;
  }
  tri(a, b, c, col, hint, uvs) {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    let flip = false;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { flip = true; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const v = this.v;
    for (const p of [a, b, c]) { this.p.push(p[0], p[1], p[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
    this._fx(3);
    if (uvs) this.u.push(...uvs); else for (let k = 0; k < 3; k++) this.u.push(WHITE_UV[0], WHITE_UV[1]);
    if (flip) this.i.push(v, v + 2, v + 1); else this.i.push(v, v + 1, v + 2);
    this.v += 3;
  }
  /** Indexed mesh with per-vertex normals (smooth), e.g. terrain or tree blobs. */
  mesh(pos, nrm, cols, idx) {
    const v = this.v;
    for (let k = 0; k < pos.length; k += 3) { this.p.push(pos[k], pos[k + 1], pos[k + 2]); this.n.push(nrm[k], nrm[k + 1], nrm[k + 2]); this.c.push(cols[k], cols[k + 1], cols[k + 2]); this.u.push(WHITE_UV[0], WHITE_UV[1]); this.f.push(this.fxv); }
    for (const q of idx) this.i.push(v + q);
    this.v += pos.length / 3;
  }
  get tris() { return this.i.length / 3; }
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
  mtn: '#86985a', chautauqua: '#b5b862', mesa: '#bdb276', downtown: '#cdc5b6', eastpearl: '#c7c1b3', westpearl: '#a9bd78',
  twentyninth: '#c9c3b5', junction: '#bdb9aa', civic: '#86bd5c', campus: '#8cc062', commercial: '#bcb7a5', east: '#b3b69a',
  whittier: '#8fbf5f', westres: '#8fbf5f', hill: '#93bf62', southres: '#9cc066', martin: '#98bf63', eastres: '#9cc066',
  willvill: '#98bf63', valmont: '#b1b36a', none: '#a3bd6a',
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
  const t0 = performance.now();
  const slice = typeof kit.slice === 'function' ? () => kit.slice() : () => null;
  const quality = kit.quality || 'high';
  const low = quality === 'low';
  const L = layout();
  const sm = smoothedRoads();
  const rnd = mulberry(0x5EED1855);
  const root = new THREE.Group(); root.name = 'boulder';
  const dark = !!kit.dark;
  const canvas = makeAtlas({ night: dark });
  let tex = null;
  if (canvas) {
    tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    if (THREE.sRGBEncoding && kit.srgb) tex.encoding = THREE.sRGBEncoding;
  }
  // the engine's toon material (3-band light, halftone, fog), cloned so the atlas stays ours
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

  // chunk buffers
  const bufs = new Map(); const own = new Map();
  const groupAt = (x, z) => {
    if (typeof kit.chunk === 'function') { const g = kit.chunk(x, z); if (g) return g; }
    const k = `${Math.floor(x / 200)},${Math.floor(z / 200)}`; let g = own.get(k);
    if (!g) { g = new THREE.Group(); g.name = 'boulder-chunk-' + k; own.set(k, g); root.add(g); }
    return g;
  };
  const B = (x, z) => { const g = groupAt(x, z); let b = bufs.get(g); if (!b) { b = new Buf(); bufs.set(g, b); } return b; };

  // ── terrain (8 m grid from the levelled height grid; 16 m where it is flat) ───────────
  const HG = HEIGHT_GRID; const g = HG.g;
  const creekD = (x, z) => { let d = Infinity; for (let k = 0; k < CREEK.length - 1; k++) { const [ax, az] = CREEK[k]; const [bx, bz] = CREEK[k + 1]; const dx = bx - ax; const dz = bz - az; const L2 = dx * dx + dz * dz; let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t)); } return d; };
  const groundCol = (x, z, y) => {
    const zn = zoneAt(x, z); let c = rgb(GROUND[zn] || GROUND.none);
    const n = vnoise(x / 37, z / 37) * 0.6 + vnoise(x / 11, z / 11) * 0.4;
    c = shade(c, 0.9 + n * 0.18);
    if (zn === 'mtn') { const f = Math.min(1, Math.max(0, (y - 25) / 60)); c = mix(c, rgb('#5f7a4a'), f * 0.7 * (0.6 + n * 0.6)); }
    if (zn === 'chautauqua' || zn === 'mesa') c = mix(c, rgb('#d4c27a'), n * 0.35);
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
      const step = (hi - lo < 0.25 && !nearCreek && !low) || low ? 2 : 1;
      const buf = B(cxm, czm);
      const pos = []; const nrm = []; const col = []; const idx = [];
      const cols = Math.ceil((ie - bi) / step) + 1; const rows = Math.ceil((je - bj) / step) + 1;
      const H = (i, j) => g[Math.min(HG.HH - 1, j) * HG.HW + Math.min(HG.HW - 1, i)];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = Math.min(ie, bi + c * step); const j = Math.min(je, bj + r * step);
        const x = HG.HX0 + i * HG.HC; const z = HG.HZ0 + j * HG.HC; const y = H(i, j);
        const dx = H(i + 1, j) - H(Math.max(0, i - 1), j); const dz = H(i, j + 1) - H(i, Math.max(0, j - 1));
        const nl = Math.hypot(dx, 2 * HG.HC, dz);
        pos.push(x, y - 0.02, z); nrm.push(-dx / nl, 2 * HG.HC / nl, -dz / nl);
        const cc = groundCol(x, z, y); col.push(cc[0], cc[1], cc[2]);
      }
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        if (nearCreek) { const xm = pos[a * 3] + step * HG.HC / 2; const zm = pos[a * 3 + 2] + step * HG.HC / 2; if (creekD(xm, zm) < 8.5) continue; }
        idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
      buf.mesh(pos, nrm, col, idx); terrTris += idx.length / 3;
    }
    await slice();
  }

  // ── Boulder Creek: water, rocky banks, grass shoulders ──────────────────────────────
  {
    const pts = CREEK; const W = rgb('#4b8fb5'); const Wd = rgb('#3d7ea3'); const bank = rgb('#a08c6c'); const grass = rgb('#86bd5c');
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k]; const [bx, bz] = pts[k + 1]; const len = Math.hypot(bx - ax, bz - az); const n = Math.max(1, Math.ceil(len / 12));
      for (let q = 0; q < n; q++) {
        const p0 = [ax + (bx - ax) * q / n, az + (bz - az) * q / n]; const p1 = [ax + (bx - ax) * (q + 1) / n, az + (bz - az) * (q + 1) / n];
        const nx = -(bz - az) / len; const nz = (bx - ax) / len;
        const at = (p, o, dy) => [p[0] + nx * o, height(p[0] + nx * o, p[1] + nz * o) + dy, p[1] + nz * o];
        const buf = B((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
        const yw = -0.75;
        buf.quad(at(p0, -CREEK_HW, yw), at(p1, -CREEK_HW, yw), at(p1, CREEK_HW, yw), at(p0, CREEK_HW, yw), (k + q) % 2 ? W : Wd, null, [0, 1, 0]);
        for (const s of [-1, 1]) {
          buf.quad(at(p0, s * CREEK_HW, yw), at(p1, s * CREEK_HW, yw), at(p1, s * 7, -0.04), at(p0, s * 7, -0.04), bank, null, [0, 1, 0]);
          buf.quad(at(p0, s * 7, -0.04), at(p1, s * 7, -0.04), at(p1, s * 16, -0.05), at(p0, s * 16, -0.05), grass, null, [0, 1, 0]);
        }
        if (rnd() < 0.35) { const o = (rnd() * 2 - 1) * 4.5; const [rx, ry, rz] = at(p0, o, -0.6); blob(buf, rx, ry, rz, 0.7 + rnd() * 0.8, 0.5, rgb('#b8a58a')); }
      }
    }
  }
  // ponds
  for (const w of WATER.slice(1)) {
    const c = w.poly.reduce((a, p) => [a[0] + p[0] / w.poly.length, a[1] + p[1] / w.poly.length], [0, 0]);
    const buf = B(c[0], c[1]); const y = height(c[0], c[1]) + 0.06;
    const tr = THREE.ShapeUtils.triangulateShape(w.poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [a, b2, c2] of tr) buf.tri([w.poly[a][0], y, w.poly[a][1]], [w.poly[b2][0], y, w.poly[b2][1]], [w.poly[c2][0], y, w.poly[c2][1]], rgb('#4b8fb5'), [0, 1, 0]);
  }

  // ── lots, plazas, the mall's bricks, the driveway ──────────────────────────────────
  for (const o of OPEN) {
    const poly = o.poly; const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
    const isRect = poly.length === 4;
    const paint = o.paint || 'asphalt';
    const colr = paint === 'brick' ? rgb('#c98a6e') : paint === 'dirt' ? rgb('#b69467') : paint === 'concrete' ? rgb('#d6d2c8') : rgb('#5d5f63');
    const lift = paint === 'brick' ? 0.12 : 0.025;
    if (paint === 'brick' && isRect) { // tile the paving in ≤ 10 m cells so the brick pattern keeps its scale
      const xs = poly.map((p) => p[0]); const zs = poly.map((p) => p[1]);
      const ax = Math.min(...xs); const bx = Math.max(...xs); const az = Math.min(...zs); const bz = Math.max(...zs);
      const uv = tileUV(T.pavers);
      for (let x = ax; x < bx - 0.01; x += 10) for (let z = az; z < bz - 0.01; z += 10) {
        const xe = Math.min(bx, x + 10); const ze = Math.min(bz, z + 10);
        const fu = (xe - x) / 10; const fv = (ze - z) / 10;
        const y = height((x + xe) / 2, (z + ze) / 2) + lift;
        B((x + xe) / 2, (z + ze) / 2).quad([x, y, ze], [xe, y, ze], [xe, y, z], [x, y, z], colr, [uv[0], uv[1], uv[0] + (uv[2] - uv[0]) * fu, uv[1] + (uv[3] - uv[1]) * fv], [0, 1, 0]);
      }
      continue;
    }
    const buf = B(c[0], c[1]);
    const tr = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const Y = (x, z) => height(x, z) + lift;
    for (const [a, b2, c2] of tr) buf.tri([poly[a][0], Y(poly[a][0], poly[a][1]), poly[a][1]], [poly[b2][0], Y(poly[b2][0], poly[b2][1]), poly[b2][1]], [poly[c2][0], Y(poly[c2][0], poly[c2][1]), poly[c2][1]], colr, [0, 1, 0]);
    if (paint === 'asphalt' && isRect && !low) { // parking stripes
      const xs = poly.map((p) => p[0]); const zs = poly.map((p) => p[1]);
      const ax = Math.min(...xs); const bx = Math.max(...xs); const az = Math.min(...zs); const bz = Math.max(...zs);
      const along = bx - ax > bz - az; const W2 = rgb('#e8e4d8');
      const len = along ? bx - ax : bz - az; const wid = along ? bz - az : bx - ax;
      for (let row = 6; row < wid - 5; row += 16) for (let s = 3; s < len - 2; s += 3) {
        for (const side of [-1, 1]) {
          const r0 = row + side * 0.1; const r1 = row + side * 5;
          const p = (u, v) => (along ? [ax + u, Y(ax + u, az + v) + 0.01, az + v] : [ax + v, Y(ax + v, az + u) + 0.01, az + u]);
          B(...(along ? [ax + s, az + row] : [ax + row, az + s])).quad(p(s - 0.06, r0), p(s + 0.06, r0), p(s + 0.06, r1), p(s - 0.06, r1), W2, null, [0, 1, 0]);
        }
      }
    }
  }
  await slice();

  // ── sidewalks + curbs ───────────────────────────────────────────────────────────────
  {
    const top = rgb('#d3cdc1'); const curb = rgb('#b9b2a5'); const brk = rgb('#c79a80');
    for (const r of sm.list) {
      if (r.bridge || r.kind === 'highway' || r.kind === 'ramp' || r.kind === 'alley') continue;
      for (const side of [-1, 1]) {
        let prev = null;
        for (let k = 0; k < r.n; k++) {
          const x = r.x[k]; const z = r.z[k];
          const kk = Math.min(r.n - 1, k + 1); const kp = Math.max(0, k - 1);
          let tx = r.x[kk] - r.x[kp]; let tz = r.z[kk] - r.z[kp]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          const nx = -tz * side; const nz = tx * side;
          const zn = zoneAt(x + nx * (r.hw + 6), z + nz * (r.hw + 6));
          const w = SIDEWALK(zn);
          const ix = x + nx * (r.hw + 0.3); const iz = z + nz * (r.hw + 0.3); const ox = x + nx * (r.hw + w); const oz = z + nz * (r.hw + w);
          const inMall = ox > MALL.x0 - 1 && ox < MALL.x1 + 1 && oz > MALL.z0 - 1 && oz < MALL.z1 + 1;
          const ok = w > 0 && !inMall && sm.clearance(ix + nx * 0.4, iz + nz * 0.4, (o) => o !== r && !o.bridge) > 0.2 && sm.clearance(ox, oz, (o) => o !== r && !o.bridge) > 0.2 && sm.clearance(ox, oz, (o) => o === r) > w - 0.6;
          if (!ok) { prev = null; continue; }
          const hy = height(x, z); const cur = { i: [ix, hy + 0.15, iz], o: [ox, height(ox, oz) + 0.15, oz], ib: [ix, hy - 0.05, iz] };
          const ex = x + nx * (r.hw + 0.02); const ez = z + nz * (r.hw + 0.02); cur.e = [ex, hy + 0.155, ez]; cur.eb = [ex, hy - 0.05, ez];
          if (prev) {
            const buf = B(x, z); const c = zn === 'downtown' ? brk : top;
            buf.quad(prev.i, cur.i, cur.o, prev.o, c, null, [0, 1, 0]);
            buf.quad(prev.eb, cur.eb, cur.e, prev.e, curb, null, [-nx, 0, -nz]);
          }
          prev = cur;
        }
      }
    }
  }
  await slice();

  // ── buildings ────────────────────────────────────────────────────────────────────
  const AWN = ['#2f6f5e', '#9b2f2f', '#2f4f7f', '#c08a2e', '#5b4a6b', '#3d6b3a'].map(rgb);
  let bc = 0;
  for (const b of L.buildings) {
    const buf = B(b.x, b.z); const v0 = buf.v; const i0 = buf.i.length;
    drawBuilding(buf, b);
    if (OL && b.style !== 'stands') buf.hull(v0, i0, OL * (b.w > 30 || b.h > 14 ? 1.6 : 1), INK);
    if (++bc % 250 === 0) await slice();
  }
  // ── props: walls, rails, rocks, planters, buskers, the stadium turf, the home's details ──
  for (const p of L.props) drawProp(p);
  await slice();
  // ── decor trees (backyards, the foothill forest) ──────────────────────────────────
  const decor = low ? L.decor.filter((_, i) => i % 3 === 0) : L.decor;
  for (const d of decor) drawTree(B(d.x, d.z), d);
  await slice();
  // Flagstaff summit: the stone amphitheatre inside the loop; Valmont's dirt jumps
  {
    const c = [-628, 836]; const y = height(c[0], c[1]);
    for (let a = 0; a < 7; a++) { const ang = Math.PI * (0.15 + a * 0.12); boxW(B(c[0], c[1]), c[0] + Math.cos(ang) * 14, y, c[1] - Math.sin(ang) * 11, 5, 0.7, 1.2, -ang + Math.PI / 2, rgb('#b48a6e')); }
  }

  // flush: one mesh per chunk
  let tris = 0; let meshes = 0;
  for (const [grp, buf] of bufs) {
    if (!buf.v) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.n, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.u, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.c, 3));
    geo.setAttribute('fx', new THREE.Float32BufferAttribute(buf.f, 1));
    geo.setIndex(buf.v > 65535 ? new THREE.Uint32BufferAttribute(buf.i, 1) : new THREE.Uint16BufferAttribute(buf.i, 1));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat); m.name = 'boulder-chunk'; m.userData.noMerge = true;
    if (grp.position && (grp.position.x || grp.position.y || grp.position.z)) m.position.set(-grp.position.x, -grp.position.y, -grp.position.z);
    m.matrixAutoUpdate = false; m.updateMatrix();
    grp.add(m); tris += buf.tris; meshes++;
  }
  root.userData.stats = { tris, meshes, terrTris, buildMs: Math.round(performance.now() - t0), layoutMs: Math.round(L.ms), solids: L.solids.length, buildings: L.buildings.length };
  return root;

  // ── helpers (hoisted) ─────────────────────────────────────────────────────────────
  function boxW(buf, x, y, z, w, h, d, rot, col, o = {}) {
    // box centred at (x, z) with base y; rot as THREE rotation.y; o.uv per face {front, side, top}
    const c = Math.cos(rot); const s = Math.sin(rot);
    const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const hw = w / 2; const hd = d / 2;
    const fr = [P(hw, 0, -hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd)];
    const faces = [
      [[P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, h, -hd), P(-hw, h, -hd)], [-s * 1, 0, -c], o.front],
      [[P(hw, 0, hd), P(-hw, 0, hd), P(-hw, h, hd), P(hw, h, hd)], [s, 0, c], o.back || o.side],
      [[P(hw, 0, -hd), P(hw, 0, hd), P(hw, h, hd), P(hw, h, -hd)], [c, 0, -s], o.side],
      [[P(-hw, 0, hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(-hw, h, hd)], [-c, 0, s], o.side],
    ];
    void fr;
    for (const [q, n, uv] of faces) buf.quad(q[0], q[1], q[2], q[3], o.sideCol && uv !== o.front ? o.sideCol : col, uv || null, n);
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
    const s = d.s; const y = d.y;
    if (d.type === 'pine') {
      const g1 = mix(rgb('#2f5a3a'), rgb('#4a7346'), d.c);
      prism(buf, d.x, y - 0.3, d.z, 0.28 * s, 2.2 * s, 5, rgb('#5a4030'));
      cone(buf, d.x, y + 1.4 * s, d.z, 2.6 * s, 5.2 * s, low ? 5 : 7, g1, d.c * 3);
      if (!low) cone(buf, d.x, y + 4.1 * s, d.z, 1.8 * s, 4.4 * s, 6, shade(g1, 1.1), d.c * 5);
    } else {
      const g1 = mix(rgb('#4f8a3c'), rgb('#7aa64a'), d.c);
      prism(buf, d.x, y - 0.3, d.z, 0.35 * s, 3.4 * s, 5, rgb('#6b4f3a'));
      blob(buf, d.x, y + 5.4 * s, d.z, 3.4 * s, 0.85, g1);
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
    // facade recipe: tiles for [front ground, front upper, side ground, side upper], segment width
    let R = null;
    const single = (front, side, seg = 30) => ({ fg: front, fu: front, sg: side, su: side, seg, whole: true });
    switch (st) {
      case 'brick': R = { fg: T.brickShop, fu: b.seed < 0.5 ? T.brickUpper : T.brickArch, sg: T.brickUpper, su: T.brickUpper, seg: 9.5 }; break;
      case 'brickB': R = { fg: T.stoneShop, fu: T.brickUpper, sg: T.brickUpper, su: T.brickUpper, seg: 9.5 }; break;
      case 'sandstone': R = { fg: T.stoneShop, fu: T.stoneUpper, sg: T.stoneUpper, su: T.stoneUpper, seg: 9.5 }; break;
      case 'cu': R = { fg: T.cuGround, fu: T.cuUpper, sg: T.cuUpper, su: T.cuUpper, seg: 11 }; break;
      case 'oldmain': case 'school': R = { fg: T.schoolUpper, fu: T.schoolUpper, sg: T.schoolUpper, su: T.schoolUpper, seg: 10 }; break;
      case 'hotel': R = { fg: T.brickShop, fu: T.hotelUpper, sg: T.hotelUpper, su: T.hotelUpper, seg: 9 }; break;
      case 'courthouse': case 'courthouseTower': R = { fg: T.courtUpper, fu: T.courtUpper, sg: T.courtUpper, su: T.courtUpper, seg: 9 }; break;
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
      case 'garage': R = single(T.garageFront, T.blank, 10); break;
      case 'cottage': case 'auditorium': R = single(T.cottageFront, T.cottageFront, 9); break;
      case 'teahouse': R = single(T.courtUpper, T.courtUpper, 6); break;
      case 'theater': R = single(T.theaterFront, T.blank, 24); break;
      case 'ncar': R = single(T.ncar, T.ncar, 7); break;
      case 'stands': return drawStands(buf, b);
      case 'bandshell': return drawShell(buf, b);
      default: R = single(T.blank, T.blank, 20);
    }
    const found = rgb('#8d877c');
    for (let f = 0; f < 4; f++) {
      const [A, Bp] = faceEnds[f]; const front = f === 0;
      const bands = [{ h: 1.6, tile: null, col: found }];
      const yBase = y0 - 1.6;
      if (R.whole) bands.push({ h: b.h, tile: front ? R.fg : R.sg });
      else for (let k = 0; k < floors; k++) bands.push({ h: fh, tile: k === 0 ? (front ? R.fg : R.sg) : (front ? R.fu : R.su) });
      const segW = front || !R.whole ? R.seg : R.seg * 0.8;
      wallBands(buf, A, Bp, yBase, bands, col, outN[f], R.whole && (st === 'home' || st === 'garage' || st === 'theater' || st === 'box') ? 999 : segW);
    }
    const top = y0 + b.h;
    const rc = rgb(b.roofColor || '#7d766b');
    if (b.roof === 'flat' || !b.roof) {
      buf.quad([corners[0][0], top, corners[0][1]], [corners[1][0], top, corners[1][1]], [corners[2][0], top, corners[2][1]], [corners[3][0], top, corners[3][1]], rc, null, [0, 1, 0]);
      if (/brick|sandstone|hotel|courthouse|school|theater/.test(st) && !low) { // cornice band
        const k = 0.35; const C = [W(-hw - k, -hd - k), W(hw + k, -hd - k), W(hw + k, hd + k), W(-hw - k, hd + k)];
        const cc = shade(col, 1.12);
        for (let f = 0; f < 4; f++) { const a = C[f]; const b2 = C[(f + 1) % 4]; buf.quad([a[0], top - 0.7, a[1]], [b2[0], top - 0.7, b2[1]], [b2[0], top + 0.5, b2[1]], [a[0], top + 0.5, a[1]], cc, null, outN[f]); }
        buf.quad([C[0][0], top + 0.5, C[0][1]], [C[1][0], top + 0.5, C[1][1]], [C[2][0], top + 0.5, C[2][1]], [C[3][0], top + 0.5, C[3][1]], shade(cc, 0.9), null, [0, 1, 0]);
      }
    } else if (b.roof === 'gable' || b.roof === 'hip' || b.roof === 'pagoda') {
      const ov = b.roof === 'pagoda' ? 1.4 : 0.45; const rh = b.roofH || 2.5;
      const alongX = b.w >= b.d; // ridge along the longer side
      const A = alongX ? hw + ov : hd + ov; const Bh = alongX ? hd + ov : hw + ov; // half length / half span
      const ridge = b.roof === 'gable' ? A : Math.max(0, A - Bh);
      const LP = (u, v, y) => { const q = alongX ? W(u, v) : W(v, u); return [q[0], y, q[1]]; };
      const tile = /cu|oldmain|teahouse/.test(st) || rc[0] > 0.6 ? T.roofTile : T.shingle; const uv = tileUV(tile);
      const e0 = LP(-A, -Bh, top); const e1 = LP(A, -Bh, top); const e2 = LP(A, Bh, top); const e3 = LP(-A, Bh, top);
      const r0 = LP(-ridge, 0, top + rh); const r1 = LP(ridge, 0, top + rh);
      const outF = alongX ? outN[0] : outN[3]; const outB = alongX ? outN[2] : outN[1];
      buf.quad(e0, e1, r1, r0, rc, uv, [outF[0], 1, outF[2]]);
      buf.quad(e2, e3, r0, r1, shade(rc, 0.9), uv, [outB[0], 1, outB[2]]);
      const endL = alongX ? outN[3] : outN[0]; const endR = alongX ? outN[1] : outN[2];
      if (b.roof === 'gable') {
        const g0 = LP(-A + ov, -Bh + ov, top); const g3 = LP(-A + ov, Bh - ov, top); const g1 = LP(A - ov, -Bh + ov, top); const g2 = LP(A - ov, Bh - ov, top);
        const q0 = LP(-A + ov, 0, top + rh * (Bh - ov) / Bh); const q1 = LP(A - ov, 0, top + rh * (Bh - ov) / Bh);
        buf.tri(g0, g3, q0, col, endL); buf.tri(g1, g2, q1, col, endR);
        // eaves soffit edge under the overhanging slope ends
        buf.tri(e3, e0, r0, shade(rc, 0.75), endL); buf.tri(e1, e2, r1, shade(rc, 0.75), endR);
      } else {
        buf.tri(e3, e0, r0, shade(rc, 0.95), [endL[0], 1, endL[2]]); buf.tri(e1, e2, r1, shade(rc, 0.85), [endR[0], 1, endR[2]]);
      }
    } else if (b.roof === 'spire' || b.roof === 'dome') {
      const rh = b.roofH || 4; const ap = [b.x, top + rh, b.z];
      const ring = b.roof === 'dome' ? 10 : 4; const rr = b.roof === 'dome' ? Math.min(hw, hd) * 1.1 : null;
      const P = []; for (let i = 0; i < ring; i++) { const a = i / ring * Math.PI * 2 + Math.PI / 4; if (rr) P.push([b.x + Math.cos(a) * rr, top, b.z + Math.sin(a) * rr]); else { const q = W(Math.sign(Math.cos(a)) * hw, Math.sign(Math.sin(a)) * hd); P.push([q[0], top, q[1]]); } }
      if (rr) buf.quad([corners[0][0], top, corners[0][1]], [corners[1][0], top, corners[1][1]], [corners[2][0], top, corners[2][1]], [corners[3][0], top, corners[3][1]], shade(col, 0.8), null, [0, 1, 0]);
      for (let i = 0; i < ring; i++) { const a = P[i]; const b2 = P[(i + 1) % ring]; const m = [(a[0] + b2[0]) / 2 - b.x, 0.6, (a[2] + b2[2]) / 2 - b.z]; buf.tri(a, b2, ap, shade(rc, 0.9 + 0.1 * (i % 2)), m); }
    }
    // extras: awnings downtown, porches, chimneys, portico, tower clock
    if ((st === 'brick' || st === 'brickB' || st === 'sandstone' || st === 'hotel') && b.seed > 0.35 && !low) {
      const ac = AWN[Math.floor(b.seed * 97) % AWN.length]; const nA = Math.max(1, Math.round(b.w / 9.5));
      for (let k = 0; k < nA; k++) {
        const u0 = -hw + (k + 0.12) * b.w / nA; const u1 = -hw + (k + 0.88) * b.w / nA;
        const p0 = W(u0, -hd); const p1 = W(u1, -hd); const p2 = W(u1, -hd - 1.6); const p3 = W(u0, -hd - 1.6);
        buf.quad([p0[0], y0 + 3.6, p0[1]], [p1[0], y0 + 3.6, p1[1]], [p2[0], y0 + 2.9, p2[1]], [p3[0], y0 + 2.9, p3[1]], ac, null, [outN[0][0], 1, outN[0][2]]);
        buf.quad([p3[0], y0 + 2.9, p3[1]], [p2[0], y0 + 2.9, p2[1]], [p2[0], y0 + 2.5, p2[1]], [p3[0], y0 + 2.5, p3[1]], shade(ac, 0.8), null, outN[0]);
      }
    }
    if (b.porch && !low) {
      const pw = Math.min(b.w * 0.55, 6); const [px, pz] = W(0, -hd - 1.1);
      boxW(buf, px, y0 - 0.2, pz, pw, 0.45, 2.2, b.rot, rgb('#cfc6b6'));
      for (const u of [-pw / 2 + 0.2, pw / 2 - 0.2]) { const [qx, qz] = W(u, -hd - 2.0); boxW(buf, qx, y0, qz, 0.2, 2.7, 0.2, b.rot, rgb('#f2eee6'), { top: false }); }
      const a = W(-pw / 2 - 0.2, -hd); const b2 = W(pw / 2 + 0.2, -hd); const c2 = W(pw / 2 + 0.2, -hd - 2.4); const d2 = W(-pw / 2 - 0.2, -hd - 2.4);
      buf.quad([a[0], y0 + 3.0, a[1]], [b2[0], y0 + 3.0, b2[1]], [c2[0], y0 + 2.6, c2[1]], [d2[0], y0 + 2.6, d2[1]], rc, null, [0, 1, 0]);
    }
    if (b.chimney && b.roof && b.roof !== 'flat' && !low) { const [cx, cz] = W(hw * 0.55, hd * 0.2); boxW(buf, cx, top - 0.5, cz, 0.9, (b.roofH || 2.5) + 1.3, 0.9, b.rot, rgb('#9c5a44')); }
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
    // tile the seating in 12 m strips so rows keep their size
    const len = Math.hypot(inner[1][0] - inner[0][0], inner[1][1] - inner[0][1]); const n = Math.max(1, Math.round(len / 12));
    for (let k = 0; k < n; k++) {
      const f0 = k / n; const f1 = (k + 1) / n;
      const I0 = [inner[0][0] + (inner[1][0] - inner[0][0]) * f0, inner[0][1] + (inner[1][1] - inner[0][1]) * f0]; const I1 = [inner[0][0] + (inner[1][0] - inner[0][0]) * f1, inner[0][1] + (inner[1][1] - inner[0][1]) * f1];
      const O0 = [outer[0][0] + (outer[1][0] - outer[0][0]) * f0, outer[0][1] + (outer[1][1] - outer[0][1]) * f0]; const O1 = [outer[0][0] + (outer[1][0] - outer[0][0]) * f1, outer[0][1] + (outer[1][1] - outer[0][1]) * f1];
      buf.quad([I0[0], y0 + 1.2, I0[1]], [I1[0], y0 + 1.2, I1[1]], [O1[0], y0 + h, O1[1]], [O0[0], y0 + h, O0[1]], col, uv, [-out[0], 1, -out[1]]);
      buf.quad([O0[0], y0 - 1, O0[1]], [O1[0], y0 - 1, O1[1]], [O1[0], y0 + h + 1.2, O1[1]], [O0[0], y0 + h + 1.2, O0[1]], conc, tileUV(T.blank), [out[0], 0, out[1]]);
      buf.quad([I0[0], y0 - 1, I0[1]], [I1[0], y0 - 1, I1[1]], [I1[0], y0 + 1.2, I1[1]], [I0[0], y0 + 1.2, I0[1]], shade(conc, 0.8), null, [-out[0], 0, -out[1]]);
    }
    // end caps
    for (const e of [0, 1]) buf.quad([inner[e][0], y0 - 1, inner[e][1]], [outer[e][0], y0 - 1, outer[e][1]], [outer[e][0], y0 + h + 1.2, outer[e][1]], [inner[e][0], y0 + 1.2, inner[e][1]], shade(conc, 0.9), null, out[0] ? [0, 0, e ? 1 : -1] : [e ? 1 : -1, 0, 0]);
  }
  function drawShell(buf, b) {
    // Central Park's bandshell: a quarter-dome shell facing north over a stage
    const y0 = b.y; const cx = b.x; const cz = b.z; const R0 = 7; const segs = 8; const col = rgb('#efe9dc');
    boxW(buf, cx, y0, cz - 1, 14, 1.0, 8, 0, rgb('#cbbfa9'));
    for (let i = 0; i < segs; i++) {
      const a0 = Math.PI * i / segs; const a1 = Math.PI * (i + 1) / segs;
      for (let j = 0; j < 3; j++) {
        const e0 = j / 3 * Math.PI / 2; const e1 = (j + 1) / 3 * Math.PI / 2;
        const P = (a, e) => [cx + Math.cos(a) * R0 * Math.cos(e), y0 + 1 + Math.sin(e) * 6, cz + Math.sin(a) * R0 * Math.cos(e) * 0.6 + 2];
        const am = (a0 + a1) / 2;
        buf.quad(P(a0, e0), P(a1, e0), P(a1, e1), P(a0, e1), shade(col, 0.85 + 0.05 * j), null, [-Math.cos(am), -0.3, -Math.sin(am)]);
        buf.quad(P(a1, e0), P(a0, e0), P(a0, e1), P(a1, e1), shade(col, 0.95), null, [Math.cos(am), 0.3, Math.sin(am)]);
      }
    }
  }

  function drawProp(p) {
    const buf = B(p.x != null ? p.x : (p.ax + p.bx) / 2, p.z != null ? p.z : (p.az + p.bz) / 2);
    switch (p.type) {
      case 'jersey': case 'rail': case 'soundwall': {
        const L2 = Math.hypot(p.bx - p.ax, p.bz - p.az); const rot = Math.atan2(-(p.bz - p.az), p.bx - p.ax);
        const mx = (p.ax + p.bx) / 2; const mz = (p.az + p.bz) / 2; const y = Math.min(p.ya, p.yb);
        if (p.type === 'rail') {
          boxW(buf, mx, y + 0.45, mz, L2 + 0.1, 0.32, 0.12, rot, rgb('#b8bcbf'), { topCol: rgb('#d9dcdf') });
          boxW(buf, p.ax, y - 0.2, p.az, 0.18, 0.9, 0.18, rot, rgb('#6f6a5e'), { top: false });
        } else if (p.type === 'jersey') boxW(buf, mx, y - 0.1, mz, L2 + 0.05, p.h + 0.1, p.thick, rot, rgb('#cfcabe'));
        else boxW(buf, mx, y - 0.5, mz, L2 + 0.05, p.h + 0.5, p.thick, rot, rgb('#c9bfae'), { front: tileUV(T.soundwall), side: tileUV(T.soundwall), back: tileUV(T.soundwall) });
        break;
      }
      case 'rock': {
        const col = mix(rgb('#b8765c'), rgb('#c99a7c'), (p.rot % 1));
        blob(buf, p.x, p.y + p.s * 0.25, p.z, p.s * 0.95, 0.75, col); break;
      }
      case 'boulder': blob(buf, p.x, height(p.x, p.z) + p.s * 0.3, p.z, p.s, 0.7, rgb('#d39a78')); break;
      case 'planter': {
        const y = height(p.x, p.z) + 0.1;
        boxW(buf, p.x, y, p.z, p.w, 0.6, p.d, 0, rgb('#b5654a'), { topCol: rgb('#ffffff'), topUV: tileUV(T.flowers) });
        break;
      }
      case 'bench': { const y = height(p.x, p.z) + 0.1; boxW(buf, p.x, y + 0.4, p.z, 2.2, 0.12, 0.6, p.rot, rgb('#7a5a3a')); boxW(buf, p.x, y, p.z, 0.15, 0.4, 0.5, p.rot, rgb('#3a3a3a'), { top: false }); break; }
      case 'kiosk': { const y = height(p.x, p.z) + 0.1; boxW(buf, p.x, y, p.z, 1.6, 2.5, 1.6, 0, rgb('#2f5d50')); cone(buf, p.x, y + 2.5, p.z, 1.4, 0.9, 6, rgb('#2a4a40')); break; }
      case 'busker': {
        const y = height(p.x, p.z) + 0.1; const skin = rgb('#e2b48c');
        if (p.act === 'box') { // the famous fold-into-a-box act: a clear box with a figure inside
          boxW(buf, p.x, y, p.z, 0.9, 0.9, 0.9, 0.3, rgb('#cfe6f2'));
          prism(buf, p.x, y + 0.9, p.z, 0.22, 0.75, 6, rgb('#d84a3a')); blob(buf, p.x, y + 1.85, p.z, 0.2, 1, skin);
        } else if (p.act === 'piano') {
          boxW(buf, p.x, y, p.z, 1.6, 1.25, 0.7, 0, rgb('#2b2522')); boxW(buf, p.x, y + 0.8, p.z - 0.5, 1.5, 0.08, 0.3, 0, rgb('#f2f0ea'));
          prism(buf, p.x, y, p.z - 1.1, 0.24, 1.0, 6, rgb('#3b5fa0')); blob(buf, p.x, y + 1.3, p.z - 1.1, 0.2, 1, skin);
        } else if (p.act === 'juggler') {
          prism(buf, p.x, y, p.z, 0.25, 1.2, 6, rgb('#f2c14e')); blob(buf, p.x, y + 1.45, p.z, 0.21, 1, skin);
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
        for (let k = 0; k < 10; k++) { const za = z0 + p.d * k / 10; const zb = z0 + p.d * (k + 1) / 10; buf.quad([x0, y, zb], [x0 + p.w, y, zb], [x0 + p.w, y, za], [x0, y, za], k === 0 || k === 9 ? rgb('#2b2b2b') : rgb(k % 2 ? '#5aa646' : '#4f9a3e'), k === 0 || k === 9 ? null : uv, [0, 1, 0]); }
        for (let k = 1; k < 10; k++) { const zz = z0 + p.d * k / 10; buf.quad([x0 + 2, y + 0.01, zz + 0.2], [x0 + p.w - 2, y + 0.01, zz + 0.2], [x0 + p.w - 2, y + 0.01, zz - 0.2], [x0 + 2, y + 0.01, zz - 0.2], rgb('#ffffff'), null, [0, 1, 0]); }
        buf.quad([p.x - 6, y + 0.02, p.z + 6], [p.x + 6, y + 0.02, p.z + 6], [p.x + 6, y + 0.02, p.z - 6], [p.x - 6, y + 0.02, p.z - 6], rgb('#cfb87c'), null, [0, 1, 0]);
        break;
      }
      case 'homeDetail': {
        const c = Math.cos(p.rot); const s = Math.sin(p.rot); const y = height(p.x, p.z);
        const W = (lx, lz) => [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
        // walkway from the driveway to the front door, flower beds, a picket fence on the side yard, a hoop
        const wv = [W(-7.5, -5.0), W(4.6, -5.0), W(4.6, -6.3), W(-7.5, -6.3)];
        buf.quad([wv[0][0], y + 0.09, wv[0][1]], [wv[1][0], y + 0.09, wv[1][1]], [wv[2][0], y + 0.09, wv[2][1]], [wv[3][0], y + 0.09, wv[3][1]], rgb('#d6d2c8'), null, [0, 1, 0]);
        for (const [u, w2] of [[-2.2, 5.2], [6.6, 4.2]]) { const [fx, fz] = W(u, -5.7); boxW(buf, fx, y, fz, w2, 0.35, 1.1, p.rot, rgb('#7a5a3a'), { topCol: rgb('#ffffff'), topUV: tileUV(T.flowers) }); }
        for (let k = 0; k < 9; k++) { const [fx, fz] = W(8.2, -4.6 + k * 1.2); boxW(buf, fx, y, fz, 0.12, 1.0, 0.1, p.rot, rgb('#f4f1ea'), { top: false }); }
        { const [fx, fz] = W(8.2, 0.2); boxW(buf, fx, y + 0.45, fz, 0.06, 0.12, 9.8, p.rot, rgb('#f4f1ea')); }
        { const [hx, hz] = W(-13.6, -3.4); boxW(buf, hx, y, hz, 0.15, 3.2, 0.15, p.rot, rgb('#4a4a4a'), { top: false }); boxW(buf, hx, y + 3.0, hz, 1.2, 0.8, 0.06, p.rot, rgb('#ffffff')); }
        // porch roof over the door + a warm porch light
        { const a = W(1.2, -5.0); const b2 = W(5.6, -5.0); const c2 = W(5.6, -7.0); const d2 = W(1.2, -7.0);
          buf.quad([a[0], y + 3.0, a[1]], [b2[0], y + 3.0, b2[1]], [c2[0], y + 2.6, c2[1]], [d2[0], y + 2.6, d2[1]], rgb('#4b4f5a'), null, [0, 1, 0]);
          const [lx, lz] = W(5.4, -6.9); boxW(buf, lx, y, lz, 0.14, 2.6, 0.14, p.rot, rgb('#f4f1ea'), { top: false });
          const [gx, gz] = W(1.4, -6.9); boxW(buf, gx, y, gz, 0.14, 2.6, 0.14, p.rot, rgb('#f4f1ea'), { top: false });
          const [px, pz] = W(4.6, -5.12); blob(buf, px, y + 2.2, pz, 0.16, 1, rgb('#ffd27a')); }
        break;
      }
      default:
    }
  }
}
void footX;
