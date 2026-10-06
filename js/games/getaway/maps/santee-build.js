// Santee map visuals: terrain, lots, houses, shops, walls, rocks, scrub, the trolley, the hero house
// and the far hills. Everything static is merged per 200 m chunk into one vertex-coloured mesh
// (plus one sign mesh where there are signs). Trees, poles, hydrants and mailboxes are solids without
// `drawn`, so the engine draws them instanced (and can knock them over).
import { prng, clamp, smooth, along, polyLen, resample, ellipse, rectPoly } from './santee-util.js';
import { BOUNDS, RIVER, RIVER_HALF } from './santee-data.js';
import { makeCats } from './santee-cats.js';

const CH = 200;
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const cache = new Map();
const C = (h) => { let c = cache.get(h); if (!c) cache.set(h, (c = hex(h))); return c; };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Growable flat-shaded triangle soup with vertex colours (and optional uvs). */
class Buf {
  constructor(uv = false) { this.p = []; this.c = []; this.f = []; this.fx = 0; this.anyFx = false; this.uv = uv ? [] : null; this.n = 0; }
  tri(a, b, c, col, ta, tb, tc) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.c.push(col[0], col[1], col[2]);
    this.f.push(this.fx, this.fx, this.fx); if (this.fx) this.anyFx = true;
    if (this.uv) this.uv.push(ta[0], ta[1], tb[0], tb[1], tc[0], tc[1]);
    this.n++;
  }
  quad(a, b, c, d, col, uvs) { // a b c d counter-clockwise seen from the front
    if (uvs) { this.tri(a, b, c, col, uvs[0], uvs[1], uvs[2]); this.tri(a, c, d, col, uvs[0], uvs[2], uvs[3]); }
    else { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  }
  geometry(THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    // engine toon: fx 3 = glow (lit windows and lamps at night)
    if (this.anyFx) g.setAttribute('fx', new THREE.Float32BufferAttribute(this.f, 1));
    g.computeVertexNormals(); // non-indexed: flat per face
    g.computeBoundingSphere();
    return g;
  }
}

/** Local frame for an oriented box: (lx, ly, lz) -> world. rot = THREE rotation.y. */
function frame(x, y, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return (lx, ly, lz) => [x + c * lx + s * lz, y + ly, z - s * lx + c * lz];
}

/** Box with walls (and top unless top === null). front = local -z. */
function box(B, F, w, h, d, side, top, y0 = 0, front = null) {
  const hw = w / 2, hd = d / 2;
  const P = (x, y, z) => F(x, y0 + y, z);
  const s1 = side, s2 = mul(side, 0.9);
  B.quad(P(-hw, 0, -hd), P(-hw, h, -hd), P(hw, h, -hd), P(hw, 0, -hd), front || s1); // front (-z)
  B.quad(P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd), P(-hw, 0, hd), s1); // back
  B.quad(P(-hw, 0, hd), P(-hw, h, hd), P(-hw, h, -hd), P(-hw, 0, -hd), s2); // left
  B.quad(P(hw, 0, -hd), P(hw, h, -hd), P(hw, h, hd), P(hw, 0, hd), s2); // right
  if (top) B.quad(P(-hw, h, -hd), P(-hw, h, hd), P(hw, h, hd), P(hw, h, -hd), top);
}
/** Vertical quad on a face plane at local z = zf (front face, facing -z), from x0..x1, y0..y1. */
function facePatch(B, F, x0, x1, y0, y1, zf, col) { B.quad(F(x0, y0, zf), F(x0, y1, zf), F(x1, y1, zf), F(x1, y0, zf), col); }

function hipRoof(B, F, w, d, y, rise, ov, col) {
  const hw = w / 2 + ov, hd = d / 2 + ov;
  const along = w >= d;
  const r = along ? Math.max(0, hw - hd) : Math.max(0, hd - hw);
  const top = y + rise;
  const dark = mul(col, 0.86);
  if (along) {
    const A = F(-r, top, 0), Bp = F(r, top, 0);
    B.quad(F(-hw, y, -hd), A, Bp, F(hw, y, -hd), col); // front slope
    B.quad(F(hw, y, hd), Bp, A, F(-hw, y, hd), col); // back slope
    B.tri(F(-hw, y, hd), A, F(-hw, y, -hd), dark);
    B.tri(F(hw, y, -hd), Bp, F(hw, y, hd), dark);
  } else {
    const A = F(0, top, -r), Bp = F(0, top, r);
    B.quad(F(-hw, y, hd), Bp, A, F(-hw, y, -hd), col);
    B.quad(F(hw, y, -hd), A, Bp, F(hw, y, hd), col);
    B.tri(F(-hw, y, -hd), A, F(hw, y, -hd), dark);
    B.tri(F(hw, y, hd), Bp, F(-hw, y, hd), dark);
  }
}
/** Gable roof with the ridge along local x; gable ends in wall colour. */
function gableRoof(B, F, w, d, y, rise, ov, col, wall, ridgeAlongZ = false) {
  if (ridgeAlongZ) {
    const hw = w / 2 + ov, hd = d / 2 + ov * 0.6;
    B.quad(F(-hw, y, hd), F(0, y + rise, hd), F(0, y + rise, -hd), F(-hw, y, -hd), col);
    B.quad(F(hw, y, -hd), F(0, y + rise, -hd), F(0, y + rise, hd), F(hw, y, hd), mul(col, 0.9));
    B.tri(F(-w / 2, y, -d / 2), F(0, y + rise, -d / 2), F(w / 2, y, -d / 2), wall);
    B.tri(F(w / 2, y, d / 2), F(0, y + rise, d / 2), F(-w / 2, y, d / 2), wall);
    return;
  }
  const hw = w / 2 + ov * 0.6, hd = d / 2 + ov;
  B.quad(F(-hw, y, -hd), F(-hw, y + rise, 0), F(hw, y + rise, 0), F(hw, y, -hd), col);
  B.quad(F(hw, y, hd), F(hw, y + rise, 0), F(-hw, y + rise, 0), F(-hw, y, hd), mul(col, 0.9));
  B.tri(F(-w / 2, y, d / 2), F(-w / 2, y + rise, 0), F(-w / 2, y, -d / 2), wall);
  B.tri(F(w / 2, y, -d / 2), F(w / 2, y + rise, 0), F(w / 2, y, d / 2), wall);
}
function flatPoly(THREE, B, poly, y, col) {
  const v = poly.map(([x, z]) => new THREE.Vector2(x, z));
  if (THREE.ShapeUtils.isClockWise(v)) v.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(v, []);
  for (const [a, b, c] of tris) B.tri([v[a].x, y, v[a].y], [v[c].x, y, v[c].y], [v[b].x, y, v[b].y], col);
}
function blob(B, x, y, z, rx, ry, rz, col, rnd, n = 6) {
  // low-poly rock / bush: a jittered bi-pyramid with n sides
  const ring = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rnd() * 0.4; const k = 0.8 + rnd() * 0.4; ring.push([x + Math.cos(a) * rx * k, y + ry * (0.35 + rnd() * 0.2), z + Math.sin(a) * rz * k]); }
  const top = [x + (rnd() - 0.5) * rx * 0.3, y + ry, z + (rnd() - 0.5) * rz * 0.3], bot = [x, y - ry * 0.15, z];
  const lite = mul(col, 1.08), dark = mul(col, 0.82);
  for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; B.tri(a, top, b, i % 2 ? col : lite); B.tri(b, bot, a, dark); }
}

// ── sign atlas: one 1024x1024 canvas, 2 x 16 cells of 512 x 64 ────────────────────────────────────
const SIGN_STYLE = {
  'TACO SHOP': ['#c8361e', '#ffe9a8'], DONUT: ['#f2a6c2', '#5a1f3a'], GAS: ['#d9483b', '#ffffff'], HARDWARE: ['#e06a1a', '#ffffff'], MARKET: ['#2d6fa8', '#ffffff'],
  PHARMACY: ['#ffffff', '#c8102e'], PIZZA: ['#2f7d3a', '#fff3d6'], BURGERS: ['#f2c230', '#8c1d18'], NAILS: ['#f3e6f2', '#9b3a8a'], CINEMA: ['#1f2a44', '#f5d76e'],
  'MINI STORAGE': ['#c4583a', '#ffffff'], 'CAR WASH': ['#3a8fd0', '#ffffff'], TIRES: ['#222222', '#f2c230'], 'PET SUPPLY': ['#3b9b8f', '#ffffff'], BANK: ['#ffffff', '#1d3f8a'],
  LAUNDRY: ['#bfe3f2', '#1d4f7a'], 'AUTO PARTS': ['#c8102e', '#ffffff'], 'FEED STORE': ['#7a5a2a', '#f7e7c0'], MOTEL: ['#2a9d8f', '#fff6d5'], 'WEST HILLS HIGH': ['#2f6f9a', '#ffffff'],
  'SANTANA HIGH': ['#6b3fa0', '#f2c230'], 'GILLESPIE FIELD': ['#3e6f97', '#ffffff'], 'SANTEE TROLLEY SQUARE': ['#b5472f', '#fff3d6'], '8524': ['#2b2b2b', '#f4f0e6'],
  'SANTEE LAKES': ['#2e6b4a', '#ffffff'], 'WELCOME TO SANTEE': ['#3b6e3b', '#fff6d5'], 'SR-52 WEST  Mission Gorge': ['#1b6e3a', '#ffffff'], 'SR-52 EAST  El Cajon': ['#1b6e3a', '#ffffff'],
  'Mast Blvd  NEXT EXIT': ['#1b6e3a', '#ffffff'], 'SR-125 SOUTH  La Mesa': ['#1b6e3a', '#ffffff'], 'SR-67  Lakeside  Ramona': ['#1b6e3a', '#ffffff'], 'TROLLEY': ['#c8102e', '#ffffff'],
};
const SIGN_KEYS = Object.keys(SIGN_STYLE);
function makeAtlas(THREE) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 1024;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1024, 1024);
  SIGN_KEYS.forEach((k, i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 64;
    const [bg, fg] = SIGN_STYLE[k];
    g.fillStyle = bg; g.fillRect(x + 2, y + 2, 508, 60);
    g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(x + 6, y + 6, 500, 52);
    g.fillStyle = fg;
    const big = k.length < 14;
    g.font = `900 ${big ? 44 : 34}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = big ? 44 : 34;
    while (g.measureText(k).width > 470 && fs > 16) { fs -= 2; g.font = `900 ${fs}px "Arial Black", Impact, sans-serif`; }
    g.fillText(k, x + 256, y + 34);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
  return tex;
}
function signUV(name) {
  let i = SIGN_KEYS.indexOf(name); if (i < 0) i = 0;
  const u0 = (i % 2) * 0.5, v1 = 1 - Math.floor(i / 2) / 16, v0 = v1 - 1 / 16;
  const e = 0.002;
  // quads are wound x0 -> x1 in local space, which reads right-to-left from the front (-z): mirror u
  return [[u0 + 0.5 - e, v0 + e], [u0 + 0.5 - e, v1 - e], [u0 + e, v1 - e], [u0 + e, v0 + e]];
}
/** A sign board on the front (-z) face. Aspect of a cell is 8:1. */
function sign(S, F, cx, cy, zf, w, name) {
  const h = w / 8;
  S.quad(F(cx - w / 2, cy - h / 2, zf), F(cx - w / 2, cy + h / 2, zf), F(cx + w / 2, cy + h / 2, zf), F(cx + w / 2, cy - h / 2, zf), [1, 1, 1], signUV(name));
}

export function buildSantee(THREE, kit, L) {
  const steps = buildSteps(THREE, kit, L);
  if (kit.slice) {
    return (async () => { let r = steps.next(); while (!r.done) { await kit.slice(); r = steps.next(); } return r.value; })();
  }
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

function* buildSteps(THREE, kit, L) {
  const root = new THREE.Group();
  root.name = 'santee';
  const q = kit.quality || 'mid';
  const low = q === 'low', high = q === 'high';
  const rnd = kit.seeded ? kit.seeded(8524) : prng(8524);
  const H = L.height;
  const chunks = new Map();
  const get = (x, z) => {
    const i = Math.floor(x / CH), j = Math.floor(z / CH);
    const k = i + ',' + j;
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { i, j, B: new Buf(), S: new Buf(true) }));
    return c;
  };
  const deco = L.deco;

  // ── terrain ────────────────────────────────────────────────────────────────────────────────────
  const step = low ? 20 : 10;
  const DRY = C('#bba776'), DRY2 = C('#ad9b68'), LAWN = C('#9aa466'), LAWN2 = C('#8e9a5c'), SAGE = C('#7c8750'), OLIVE = C('#687244'), SAND = C('#d9c48f'), SAND2 = C('#c9b07a'), BED = C('#6f9fb5'), RIM = C('#a8995f');
  const surf = (x, z, h) => {
    const rd = L.riverDist(x, z);
    if (L.inWater(x, z)) return BED;
    if (rd < RIVER_HALF + 1) return mix(SAND, SAND2, (Math.sin(x * 0.11) * Math.cos(z * 0.13) + 1) * 0.5);
    if (rd < RIVER_HALF + 7) return mix(SAND2, DRY2, (rd - RIVER_HALF - 1) / 6);
    const n = (Math.sin(x * 0.031 + z * 0.017) + Math.sin(z * 0.043 - x * 0.011) + 2) * 0.25;
    if (h > 1) return mix(mix(SAGE, OLIVE, n), RIM, clamp((h - 1) / 50, 0, 0.5) * (0.4 + n));
    const zs = L.zoneAt(x, z);
    if (zs === 'ranch' || zs === 'prism' || zs === 'mobile' || zs === 'park') return mix(LAWN, LAWN2, n);
    return mix(DRY, DRY2, n);
  };
  const x0 = BOUNDS.x0 - 40, z0 = BOUNDS.z0 - 40, x1 = BOUNDS.x1 + 40, z1 = BOUNDS.z1 + 40;
  for (let cz = Math.floor(z0 / CH) * CH; cz < z1; cz += CH) {
    for (let cx = Math.floor(x0 / CH) * CH; cx < x1; cx += CH) {
      const ax = Math.max(cx, x0), bx = Math.min(cx + CH, x1), az = Math.max(cz, z0), bz = Math.min(cz + CH, z1);
      if (bx <= ax || bz <= az) continue;
      const B = get(cx + 1, cz + 1).B;
      const nx = Math.ceil((bx - ax) / step), nz = Math.ceil((bz - az) / step);
      const V = [];
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const x = Math.min(ax + i * step, bx), z = Math.min(az + j * step, bz), h = H(x, z);
        V.push([[x, h, z], surf(x, z, h)]);
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = V[j * (nx + 1) + i], b = V[j * (nx + 1) + i + 1], c = V[(j + 1) * (nx + 1) + i], d = V[(j + 1) * (nx + 1) + i + 1];
        const col = mix(mix(a[1], b[1], 0.5), mix(c[1], d[1], 0.5), 0.5);
        B.tri(a[0], c[0], b[0], col); B.tri(b[0], c[0], d[0], col);
      }
      yield;
    }
  }

  // ── overlays: lots, grass, dirt lots, bulbs, water ──────────────────────────────────────────────
  const ASPH = C('#64666a'), ASPH2 = C('#5a5c60'), GRASS = C('#9fc26a'), GOLF = C('#8cc063'), STRIPE = C('#eeeeea');
  for (const o of L.open) {
    if (o.kind === 'sand' || o.kind === 'dirt' || o.poly === deco.lakePark) continue;
    let cx = 0, cz = 0; for (const [x, z] of o.poly) { cx += x; cz += z; } cx /= o.poly.length; cz /= o.poly.length;
    const B = get(cx, cz).B;
    if (o.kind === 'lot') flatPoly(THREE, B, o.poly, 0.05, o.poly.length > 10 ? ASPH2 : ASPH);
    else if (o.kind === 'grass') flatPoly(THREE, B, o.poly, 0.04, GRASS);
  }
  for (const m of deco.misc) if (m.type === 'dirtlot') flatPoly(THREE, get(m.x, m.z).B, rectPoly(m.x, m.z, m.w, m.d, 0), 0.03, C('#cdb27e'));
  // parking stripes
  for (const l of deco.lots || []) {
    if (!l.stripes) continue;
    const F = frame(l.x, 0.07, l.z, l.rot);
    const B = get(l.x, l.z).B;
    for (const rowZ of [l.d / 2 - 18, l.d / 2 - 40]) {
      if (rowZ < -l.d / 2 + 30) continue;
      for (let x = -l.w / 2 + 8; x < l.w / 2 - 8; x += 3) B.quad(F(x, 0, rowZ - 2.6), F(x + 0.14, 0, rowZ - 2.6), F(x + 0.14, 0, rowZ + 2.6), F(x, 0, rowZ + 2.6), STRIPE);
    }
  }
  // fields (with a red track around the high-school ones)
  for (const f of deco.fields) {
    const F = frame(f.x, 0.06, f.z, f.rot);
    const B = get(f.x, f.z).B;
    if (f.track) {
      const ring = ellipse(0, 0, f.w / 2 - 2, f.d / 2 - 2, 24);
      const inner = ellipse(0, 0, f.w / 2 - 9, f.d / 2 - 9, 24);
      for (let i = 0; i < 24; i++) { const a = ring[i], b = ring[(i + 1) % 24], c = inner[(i + 1) % 24], d = inner[i]; B.quad(F(a[0], 0, a[1]), F(d[0], 0, d[1]), F(c[0], 0, c[1]), F(b[0], 0, b[1]), C('#b5523b')); }
    }
    const fw = f.track ? f.w - 30 : f.w, fd = f.track ? f.d - 30 : f.d;
    B.quad(F(-fw / 2, 0.01, -fd / 2), F(-fw / 2, 0.01, fd / 2), F(fw / 2, 0.01, fd / 2), F(fw / 2, 0.01, -fd / 2), C('#6fb24f'));
    for (const lx of [-fw / 2, 0, fw / 2]) B.quad(F(lx - 0.2, 0.02, -fd / 2), F(lx - 0.2, 0.02, fd / 2), F(lx + 0.2, 0.02, fd / 2), F(lx + 0.2, 0.02, -fd / 2), STRIPE);
  }
  // cul-de-sac bulbs (asphalt discs) with a kerb ring
  for (const b of deco.bulbs) {
    const B = get(b.x, b.z).B;
    const ring = ellipse(b.x, b.z, b.r, b.r, 14);
    for (let i = 0; i < 14; i++) { const a = ring[i], c = ring[(i + 1) % 14]; B.tri([b.x, 0.06, b.z], [c[0], 0.06, c[1]], [a[0], 0.06, a[1]], ASPH); }
    const ring2 = ellipse(b.x, b.z, b.r + 1, b.r + 1, 14);
    for (let i = 0; i < 14; i++) { const a = ring[i], c = ring[(i + 1) % 14], d = ring2[(i + 1) % 14], e = ring2[i]; B.quad([a[0], 0.07, a[1]], [e[0], 0.12, e[1]], [d[0], 0.12, d[1]], [c[0], 0.07, c[1]], C('#cfc9bd')); }
  }
  // water: lakes and river pools, surface a little below grade, with a pale rim
  const WATER = C('#3f93c9'), WATER2 = C('#5aa9d6'), SHORE = C('#cdbf93');
  for (const poly of deco.lakes.concat(deco.pools)) {
    let cx = 0, cz = 0; for (const [x, z] of poly) { cx += x; cz += z; } cx /= poly.length; cz /= poly.length;
    const B = get(cx, cz).B;
    const ext = poly.map(([x, z]) => [cx + (x - cx) * 1.12, cz + (z - cz) * 1.12]);
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], c = ext[(i + 1) % poly.length], d = ext[i]; B.quad([a[0], -0.42, a[1]], [d[0], 0.03, d[1]], [c[0], 0.03, c[1]], [b[0], -0.42, b[1]], SHORE); }
    flatPoly(THREE, B, poly, -0.45, WATER);
    const inner = poly.map(([x, z]) => [cx + (x - cx) * 0.6, cz + (z - cz) * 0.6]);
    flatPoly(THREE, B, inner, -0.43, WATER2);
    // fountain jets in Santee Lakes
    if (poly.length === 20) blob(B, cx, -0.4, cz, 1.6, 4.5, 1.6, C('#e8f4fb'), rnd, 5);
  }
  yield;

  // ── houses ─────────────────────────────────────────────────────────────────────────────────────
  const dark = !!kit.dark;
  const LITW = C('#ffd98a');
  const WIN = C('#3e4a5a'), WIN2 = C('#56677d'), GAR = C('#f2efe8'), GAR2 = C('#dcd6ca'), DOOR = C('#7a4b2e'), DRIVE = C('#d2ccc0'), TRIM = C('#ffffff'), BLACK = C('#25272b');
  let hn = 0;
  for (const h of deco.houses) {
    const { B } = get(h.x, h.z);
    const F = frame(h.x, 0, h.z, h.rot);
    const wall = C(h.wall), roof = C(h.roof);
    const hh = h.h, fz = -h.d / 2 - 0.02;
    if (h.style === 'mobile') {
      box(B, F, h.w, 3.1, h.d, wall, null);
      gableRoof(B, F, h.w, h.d, 3.1, 0.6, 0.3, roof, wall, true);
      facePatch(B, F, -h.w / 2, h.w / 2, 0.9, 1.2, fz, C('#7fa7c4'));
      hn++; continue;
    }
    const prism = h.style === 'prism';
    box(B, F, h.w, hh, h.d, wall, null);
    // garage door on one side of the front, door + windows on the other
    const gs = h.garage, gw = Math.min(5.4, h.w * 0.45);
    const gx = gs * (h.w / 2 - gw / 2 - 0.6);
    facePatch(B, F, gx - gw / 2, gx + gw / 2, 0, 2.3, fz - 0.01, prism ? C('#e9e6df') : GAR);
    if (!low) for (let k = 1; k < 4; k++) facePatch(B, F, gx - gw / 2, gx + gw / 2, k * 0.58 - 0.04, k * 0.58, fz - 0.02, GAR2);
    const ox = -gs * (h.w / 2 - (h.w - gw - 1.2) / 2 - 0.3);
    facePatch(B, F, ox - 0.55, ox + 0.55, 0, 2.2, fz - 0.01, prism ? BLACK : DOOR);
    const litH = dark && rnd() < 0.55;
    if (litH) B.fx = 3;
    facePatch(B, F, ox - gs * 2.2 - 0.9, ox - gs * 2.2 + 0.9, 1.0, 2.2, fz - 0.01, litH ? LITW : WIN);
    B.fx = 0;
    if (h.stories === 2) {
      if (dark && rnd() < 0.4) { B.fx = 3; facePatch(B, F, -h.w / 4 - 0.9, -h.w / 4 + 0.9, 4.1, 5.5, fz - 0.01, LITW); B.fx = 0; } else facePatch(B, F, -h.w / 4 - 0.9, -h.w / 4 + 0.9, 4.1, 5.5, fz - 0.01, WIN2);
      facePatch(B, F, h.w / 4 - 0.9, h.w / 4 + 0.9, 4.1, 5.5, fz - 0.01, WIN2);
      if (prism) { facePatch(B, F, -h.w / 4 - 1, -h.w / 4 + 1, 4.0, 4.1, fz - 0.02, BLACK); facePatch(B, F, h.w / 4 - 1, h.w / 4 + 1, 4.0, 4.1, fz - 0.02, BLACK); }
    }
    // side windows
    if (!low) {
      const P = (lx, ly, lz) => F(lx, ly, lz);
      B.quad(P(h.w / 2 + 0.02, 1.0, -1), P(h.w / 2 + 0.02, 2.1, -1), P(h.w / 2 + 0.02, 2.1, 1), P(h.w / 2 + 0.02, 1.0, 1), WIN);
      B.quad(P(-h.w / 2 - 0.02, 1.0, 1), P(-h.w / 2 - 0.02, 2.1, 1), P(-h.w / 2 - 0.02, 2.1, -1), P(-h.w / 2 - 0.02, 1.0, -1), WIN);
    }
    if (prism) {
      // modern farmhouse: steep dark gable, board-and-batten stripes, black trim
      gableRoof(B, F, h.w, h.d, hh, 3.2, 0.45, roof, wall, true);
      if (!low) for (let k = -3; k <= 3; k++) if (Math.abs(k * 1.2 - gx) > gw / 2 + 0.2) facePatch(B, F, k * 1.2 - 0.05, k * 1.2 + 0.05, 2.5, hh, fz - 0.015, mul(wall, 0.86));
      // little porch roof over the door
      const pf = frame(...F(ox, 2.6, fz - 0.9), h.rot);
      gableRoof(B, pf, 2.6, 1.8, 0, 0.7, 0.1, roof, wall);
    } else if (h.gable) gableRoof(B, F, h.w, h.d, hh, 2.2, 0.6, roof, wall);
    else hipRoof(B, F, h.w, h.d, hh, 2.0, 0.6, roof);
    // driveway to the street
    const sx = h.street[0], sz = h.street[1];
    const [gx0, , gz0] = F(gx - gw / 2 - 0.3, 0, -h.d / 2), [gx1, , gz1] = F(gx + gw / 2 + 0.3, 0, -h.d / 2);
    const dx = sx - h.x, dz = sz - h.z;
    const dl = Math.hypot(dx, dz);
    const fx = -Math.sin(h.rot), fzz = -Math.cos(h.rot); // local -z in world
    const reach = Math.max(0, (fx * dx + fzz * dz) - h.d / 2 - 3);
    void dl;
    B.quad([gx0, 0.06, gz0], [gx1, 0.06, gz1], [gx1 + fx * reach, 0.06, gz1 + fzz * reach], [gx0 + fx * reach, 0.06, gz0 + fzz * reach], DRIVE);
    if (!low) {
      // front lawn
      const [lx0, , lz0] = F(-gs * h.w / 2, 0, -h.d / 2), [lx1, , lz1] = F(gx - gs * (gw / 2 + 0.6), 0, -h.d / 2);
      B.quad([lx0, 0.04, lz0], [lx0 + fx * reach, 0.04, lz0 + fzz * reach], [lx1 + fx * reach, 0.04, lz1 + fzz * reach], [lx1, 0.04, lz1], prism ? C('#9cc46c') : rnd() < 0.6 ? C('#a8c271') : C('#c9bf86'));
    }
    if (h.hero) { B.night = dark; heroHouse(THREE, B, get(h.x, h.z).S, F, h); B.night = false; }
    if (++hn % 120 === 0) yield;
  }
  yield;

  // ── shops, big boxes, hangars, canopies ────────────────────────────────────────────────────────
  let shn = 0;
  for (const s of deco.shops) {
    if (++shn % 40 === 0) yield;
    const { B, S } = get(s.x, s.z);
    const F = frame(s.x, 0, s.z, s.rot);
    const wall = C(s.color), trim = C(s.trim);
    // local +z points to the street for these (centres face their street); flip so the front is +z
    const G = frame(s.x, 0, s.z, s.rot + Math.PI);
    box(B, G, s.w, s.h, s.d, wall, C('#cfcbc4'));
    if (s.storage) { for (let x = -s.w / 2 + 2; x < s.w / 2 - 2; x += 4) facePatch(B, G, x, x + 3, 0, 2.6, -s.d / 2 - 0.02, C('#e7e1d6')); facePatch(B, G, -s.w / 2, s.w / 2, 2.6, s.h, -s.d / 2 - 0.02, trim); }
    else {
      if (dark) B.fx = 3;
      facePatch(B, G, -s.w / 2 + 1, s.w / 2 - 1, 0, 3.0, -s.d / 2 - 0.02, dark ? C('#ffe3a6') : C('#3b4a5c')); // storefront glass
      B.fx = 0;
      // parapet + awning band
      box(B, frame(...G(0, s.h, -s.d / 2 + 0.6), s.rot + Math.PI), s.w + 0.2, 1.4, 1.4, trim, trim);
      const aw = (lx0, lx1) => B.quad(G(lx0, 3.4, -s.d / 2), G(lx0, 3.0, -s.d / 2 - 2.2), G(lx1, 3.0, -s.d / 2 - 2.2), G(lx1, 3.4, -s.d / 2), s.tile ? C('#c8623e') : trim);
      aw(-s.w / 2, s.w / 2);
      if (s.sign) sign(S, G, 0, s.h - 1.2, -s.d / 2 - 0.25, Math.min(s.w - 2, s.school ? 22 : 12), s.sign);
      if (!low) { blob(B, ...G(-s.w / 4, s.h, 2), 1.2, 1.0, 1.2, C('#bfbfbf'), rnd, 4); }
    }
    void F;
  }
  for (const s of deco.bigs) {
    const { B, S } = get(s.x, s.z);
    const G = frame(s.x, 0, s.z, s.rot + Math.PI);
    const wall = C(s.color), trim = C(s.trim);
    if (s.hangar) {
      box(B, G, s.w, s.h - 2, s.d, wall, null);
      gableRoof(B, G, s.w, s.d, s.h - 2, 2.2, 0.4, C('#9aa5ad'), wall);
      facePatch(B, G, -s.w / 2 + 4, s.w / 2 - 4, 0, s.h - 3, -s.d / 2 - 0.02, C('#b9c0c4'));
      if (s.sign) sign(S, G, 0, s.h - 1.5, -s.d / 2 - 0.3, 26, s.sign);
      continue;
    }
    box(B, G, s.w, s.h, s.d, wall, C('#cfcbc4'));
    facePatch(B, G, -s.w / 2, s.w / 2, s.h - 1.6, s.h, -s.d / 2 - 0.02, trim);
    box(B, frame(...G(0, 0, -s.d / 2 - 1), s.rot + Math.PI), 18, s.h + 2.5, 2, trim, trim);
    facePatch(B, G, -7, 7, 0, 3.4, -s.d / 2 - 2.03, C('#3b4a5c'));
    sign(S, G, 0, s.h - 0.3, -s.d / 2 - 2.1, 16, s.sign);
  }
  for (const m of deco.misc) {
    const { B } = get(m.x, m.z);
    if (m.type === 'canopy') {
      const F = frame(m.x, 0, m.z, m.rot);
      box(B, frame(m.x, 0, m.z, m.rot), m.w, 1.0, m.d, C('#ffffff'), C('#e8e4dc'), 4.6);
      facePatch(B, frame(m.x, 0, m.z, m.rot + Math.PI), -m.w / 2, m.w / 2, 4.9, 5.4, -m.d / 2 - 0.02, C('#d9483b'));
      for (const [px, pz] of [[-m.w / 2 + 2, -m.d / 2 + 2], [m.w / 2 - 2, -m.d / 2 + 2], [-m.w / 2 + 2, m.d / 2 - 2], [m.w / 2 - 2, m.d / 2 - 2]]) box(B, frame(...F(px, 0, pz), m.rot), 0.5, 4.6, 0.5, C('#e8e4dc'), null);
    } else if (m.type === 'plane') {
      const F = frame(m.x, 0, m.z, m.rot);
      box(B, F, 1.2, 1.2, 7, C('#f4f4f2'), C('#ffffff'), 0.6);
      box(B, frame(...F(0, 1.5, -0.6), m.rot), 9, 0.15, 1.4, C('#f4f4f2'), C('#ffffff'));
      box(B, frame(...F(0, 1.8, 3.1), m.rot), 0.15, 1.4, 0.9, C('#c8102e'), C('#c8102e'));
      box(B, frame(...F(0, 0.7, -3.6), m.rot), 0.3, 0.6, 0.3, C('#333333'), null);
    } else if (m.type === 'rv') {
      const F = frame(m.x, 0, m.z, m.rot);
      box(B, F, m.w, m.h, m.d, C('#f3f1ea'), C('#ffffff'), 0.3);
      facePatch(B, frame(m.x, 0, m.z, m.rot + Math.PI / 2), -m.d / 2, m.d / 2, 1.6, 1.9, -m.w / 2 - 0.02, C('#8a5a3a'));
    }
  }
  // airport runway paint
  {
    const B = get(330, 600).B;
    for (let x = 0; x < 660; x += 26) B.quad([x, 0.08, 570], [x, 0.08, 571], [x + 14, 0.08, 571], [x + 14, 0.08, 570], STRIPE);
  }
  yield;

  // ── walls, rocks, scrub, reeds ─────────────────────────────────────────────────────────────────
  let wn = 0;
  for (const w of deco.walls) {
    if (++wn % 200 === 0) yield;
    const { B } = get(w.x, w.z);
    const col = C(w.color);
    const y0 = Math.min(H(w.x, w.z), 0);
    box(B, frame(w.x, y0, w.z, w.rot), w.w, w.h - y0, w.d, col, mul(col, 1.1));
    if (!low && !w.sound) box(B, frame(w.x, 0, w.z, w.rot), w.w + 0.05, 0.12, w.d + 0.16, mul(col, 1.12), mul(col, 1.15), w.h);
  }
  for (const r of deco.rocks) blob(get(r.x, r.z).B, r.x, r.y - 0.3, r.z, r.w / 2, r.h, r.d / 2, mix(C('#b8a78e'), C('#8f8577'), rnd()), rnd, 6);
  if (!low) {
    const SC = [C('#7d8a52'), C('#6a7646'), C('#93975c'), C('#a39a63')];
    let sn = 0;
    for (const [x, z, s, t] of deco.scrub) { if (++sn % 300 === 0) yield; const y = H(x, z); blob(get(x, z).B, x, y - 0.2, z, s, s * 0.9, s * 0.9, SC[Math.floor(t * 4)], rnd, high ? 5 : 4); }
    const RE = [C('#a7a35a'), C('#8b9a4c'), C('#b9a868')];
    let rn = 0;
    for (const [x, z, h] of deco.reeds) {
      if (++rn % 300 === 0) yield;
      const y = H(x, z) - 0.05, B = get(x, z).B, col = RE[Math.floor(rnd() * 3)];
      for (let k = 0; k < 3; k++) { // a tuft of three leaning blades (two-sided)
        const a = rnd() * Math.PI, c = Math.cos(a) * 0.5, s2 = Math.sin(a) * 0.5, lx = (rnd() - 0.5) * 0.8, lz = (rnd() - 0.5) * 0.8;
        const p0 = [x - c, y, z - s2], p1 = [x + c, y, z + s2], tip = [x + lx, y + h * (0.7 + rnd() * 0.5), z + lz];
        B.tri(p0, tip, p1, col); B.tri(p1, tip, p0, mul(col, 0.85));
      }
    }
  }
  yield;

  // riparian willow scrub along the river banks (visual only, not solid)
  if (!low) {
    const RIP = [C('#6f8f45'), C('#5f7f3c'), C('#7d9a50')];
    const Lr = polyLen(RIVER);
    for (let sd = 8; sd < Lr; sd += high ? 7 : 11) {
      const a = along(RIVER, sd);
      for (const side of [-1, 1]) {
        if (rnd() < 0.35) continue;
        const off = side * (RIVER_HALF + 1 + rnd() * 6);
        const x = a.x - a.tz * off, z = a.z + a.tx * off;
        if (L.roadGap(x, z, 20) < 3 || L.inWater(x, z)) continue;
        const sz = 1.4 + rnd() * 1.8;
        blob(get(x, z).B, x, H(x, z) - 0.2, z, sz, sz * (1.6 + rnd() * 0.8), sz, RIP[Math.floor(rnd() * 3)], rnd, 5);
      }
    }
  }
  yield;

  // ── the trolley: rails, platform, red cars, viaduct over SR-52 ─────────────────────────────────
  {
    const tr = deco.trolley, rail = deco.rail;
    const RAILC = C('#5c5650'), BALLAST = C('#8f8578'), TIE = C('#6b5a48');
    for (let z = rail.z0; z < rail.z1; z += 20) {
      const za = z, zb = Math.min(z + 20, rail.z1);
      const onV = za >= tr.viaduct.z0 && zb <= tr.viaduct.z1;
      const y = onV ? tr.viaduct.y : 0.09;
      const B = get(rail.x, za + 1).B;
      B.quad([rail.x - 2.4, y, za], [rail.x - 2.4, y, zb], [rail.x + 2.4, y, zb], [rail.x + 2.4, y, za], BALLAST);
      if (!low) for (let t = za; t < zb; t += 2.5) B.quad([rail.x - 1.3, y + 0.02, t], [rail.x - 1.3, y + 0.02, t + 0.5], [rail.x + 1.3, y + 0.02, t + 0.5], [rail.x + 1.3, y + 0.02, t], TIE);
      for (const rx of [-0.72, 0.72]) box(B, frame(rail.x + rx, y, (za + zb) / 2, 0), 0.14, 0.18, zb - za, RAILC, C('#9a948c'));
      if (onV) box(B, frame(rail.x, y - 1.2, (za + zb) / 2, 0), 6, 1.2, zb - za, C('#cfc8bb'), null);
    }
    // ramps up to the viaduct
    for (const [zA, zB] of [[tr.viaduct.z0 - 60, tr.viaduct.z0], [tr.viaduct.z1, tr.viaduct.z1 + 60]]) {
      const B = get(rail.x, zA).B;
      const up = zA < tr.viaduct.z0;
      const yA = up ? 0.1 : tr.viaduct.y, yB = up ? tr.viaduct.y : 0.1;
      B.quad([rail.x - 3, yA, zA], [rail.x - 3, yB, zB], [rail.x + 3, yB, zB], [rail.x + 3, yA, zA], C('#cfc8bb'));
      B.quad([rail.x - 3, 0, zA], [rail.x - 3, 0, zB], [rail.x - 3, yB, zB], [rail.x - 3, yA, zA], C('#bdb5a7'));
      B.quad([rail.x + 3, yA, zA], [rail.x + 3, yB, zB], [rail.x + 3, 0, zB], [rail.x + 3, 0, zA], C('#bdb5a7'));
    }
    for (const pz of [454, 508]) box(get(rail.x, pz).B, frame(rail.x, 0, pz, 0), 4, tr.viaduct.y - 1.2, 3, C('#bdb5a7'), null);
    // platform with canopy
    const p = tr.platform;
    const { B, S } = get(p.x, p.z);
    box(B, frame(p.x, 0, p.z, 0), p.w, p.h, p.d, C('#d8d2c6'), C('#e9e4da'));
    box(B, frame(p.x - p.w / 2 + 0.2, p.h, p.z, 0), 0.25, 0.02, p.d, C('#f2c230'), C('#f2c230'));
    for (let z = p.z - p.d / 2 + 6; z < p.z + p.d / 2; z += 12) box(B, frame(p.x + 1.4, p.h, z, 0), 0.25, 3.4, 0.25, C('#c8102e'), null);
    box(B, frame(p.x + 0.6, p.h + 3.4, p.z, 0), 4.4, 0.35, p.d - 8, C('#c8102e'), C('#e5e1d8'));
    sign(S, frame(p.x + 2.8, 0, p.z, Math.PI / 2), 0, p.h + 4.6, -0.05, 14, 'SANTEE TROLLEY SQUARE');
    sign(S, frame(p.x + 2.8, 0, p.z, -Math.PI / 2), 0, p.h + 4.6, -0.05, 14, 'SANTEE TROLLEY SQUARE');
    // the red LRVs
    for (const c of tr.cars) {
      const { B } = get(c.x, c.z);
      const F = frame(c.x, 0.5, c.z, 0);
      box(B, F, c.w, c.h - 0.5, c.d, C('#c8102e'), C('#d9d6cf'));
      box(B, frame(c.x, 2.05, c.z, 0), c.w + 0.04, 1.1, c.d - 1.2, C('#2c3440'), null);
      box(B, frame(c.x, 0.5, c.z, 0), c.w + 0.05, 0.35, c.d + 0.02, C('#e9e6df'), null);
      box(B, frame(c.x, c.h, c.z, 0), 1.4, 0.6, 2.6, C('#4a4d52'), null); // pantograph base
      B.tri([c.x - 0.6, c.h + 0.6, c.z - 0.8], [c.x, c.h + 1.8, c.z], [c.x + 0.6, c.h + 0.6, c.z + 0.8], C('#3a3c40'));
    }
    // overhead wire (thin dark strip) above the tracks
    for (let z = rail.z0 + 10; z < rail.z1 - 10; z += 40) {
      const y = (z > tr.viaduct.z0 - 30 && z < tr.viaduct.z1 + 30) ? tr.viaduct.y + 6 : 6.8;
      if (!low) box(get(rail.x, z).B, frame(rail.x, y, z + 20, 0), 0.05, 0.05, 40, C('#2b2b2b'), null);
    }
  }

  // ── signs: pylons, gantries, monuments ──────────────────────────────────────────────────────────
  for (const p of deco.pylons || []) {
    const { B, S } = get(p.x, p.z);
    const F = frame(p.x, 0, p.z, p.rot + Math.PI);
    box(B, F, 0.8, 8.2, 0.8, C('#d8c3a0'), null);
    box(B, frame(p.x, 4.4, p.z, p.rot + Math.PI), 6.6, 3.6, 0.7, C('#e9dcc4'), C('#c8623e'));
    p.names.forEach((n, k) => { sign(S, F, 0, 7.3 - k * 1.05, -0.37, 6.2, n); sign(S, frame(p.x, 0, p.z, p.rot), 0, 7.3 - k * 1.05, -0.37, 6.2, n); });
    gableRoof(B, frame(p.x, 0, p.z, p.rot), 7.0, 1.2, 8.0, 0.8, 0.1, C('#c8623e'), C('#e9dcc4'));
  }
  for (const g of deco.gantries || []) {
    const { B, S } = get(g.x, g.z);
    const F = frame(g.x, 0, g.z, g.rot);
    for (const sd of [-1, 1]) box(B, frame(...F(sd * g.span / 2, 0, 0), g.rot), 0.6, 7.6, 0.6, C('#8d9094'), C('#8d9094'));
    box(B, frame(...F(0, 6.4, 0), g.rot), g.span + 0.6, 0.5, 0.5, C('#8d9094'), C('#8d9094'));
    box(B, frame(...F(g.span / 4, 5.6, 0.3), g.rot), 9.4, 2.2, 0.2, C('#1b6e3a'), C('#1b6e3a'));
    sign(S, F, g.span / 4, 6.7, -0.02, 9, g.label);
  }
  for (const m of deco.monuments || []) {
    const { B, S } = get(m.x, m.z);
    const F = frame(m.x, 0, m.z, m.rot);
    box(B, F, 8, 2.0, 1.2, C(m.color), mul(C(m.color), 1.08));
    box(B, frame(m.x, 2.0, m.z, m.rot), 8.4, 0.4, 1.4, C('#c8623e'), C('#c8623e'));
    sign(S, F, 0, 1.15, -0.62, 7.2, m.label);
    sign(S, frame(m.x, 0, m.z, m.rot + Math.PI), 0, 1.15, -0.62, 7.2, m.label);
    if (!low) for (const sx of [-4.6, 4.6]) blob(B, ...F(sx, 0, -0.4), 0.9, 1.1, 0.7, C('#6f8a48'), rnd, 5);
  }

  // ── chunk meshes ───────────────────────────────────────────────────────────────────────────────
  let mat;
  if (kit.toon) { try { mat = kit.toon(null, { vertexColors: true }); } catch (e) { mat = null; } }
  if (!mat) mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (!mat.vertexColors) { mat.vertexColors = true; mat.needsUpdate = true; }
  const atlas = makeAtlas(THREE);
  const signMat = atlas ? new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false }) : null;
  if (dark) { // dark mode is night: sink everything toward a cool dusk, keep the glows
    for (const c of chunks.values()) {
      const col = c.B.c, f = c.B.f;
      for (let v = 0, i = 0; i < col.length; i += 3, v++) {
        if (f[v] === 3) continue;
        col[i] = col[i] * 0.5 + 0.03; col[i + 1] = col[i + 1] * 0.52 + 0.04; col[i + 2] = col[i + 2] * 0.6 + 0.09;
      }
    }
  }
  let tris = 0, meshes = 0;
  let cn = 0;
  for (const c of chunks.values()) {
    if (++cn % 12 === 0) yield;
    const cx = c.i * CH + CH / 2, cz = c.j * CH + CH / 2;
    const parent = kit.chunk ? kit.chunk(cx, cz) : root;
    if (c.B.n) {
      const m = new THREE.Mesh(c.B.geometry(THREE), mat);
      m.name = `santee-${c.i},${c.j}`; m.matrixAutoUpdate = false; m.updateMatrix();
      m.receiveShadow = true;
      parent.add(m); tris += c.B.n; meshes++;
    }
    if (c.S.n && signMat) {
      const m = new THREE.Mesh(c.S.geometry(THREE), signMat);
      m.name = `santee-signs-${c.i},${c.j}`; m.matrixAutoUpdate = false; m.updateMatrix();
      parent.add(m); tris += c.S.n; meshes++;
    }
  }
  // cats at 8524 Boulder Way
  const home = deco.home;
  if (home) {
    const catGroup = makeCats(THREE, mat, deco.cats, home, L);
    (kit.chunk ? kit.chunk(home.x, home.z) : root).add(catGroup);
  }
  root.userData.stats = { tris, meshes, chunks: chunks.size };
  return root;
}

/** The home at 8524 Boulder Way: modern farmhouse with porch, house number, lit lamp, planters. */
function heroHouse(THREE, B, S, F, h) {
  const fz = -h.d / 2;
  const roof = C('#33373c'), white = C('#f6f4ef'), black = C('#202226'), wood = C('#9a6a3e');
  const gs = h.garage, ox = -gs * 2.2;
  // porch: slab, two posts, shed roof across the entry side
  const px0 = ox - 2.6, px1 = ox + 2.6;
  box(B, frame(...F((px0 + px1) / 2, 0, fz - 1.3), h.rot), px1 - px0, 0.25, 2.6, C('#cfc9bd'), C('#ddd7cb'));
  for (const x of [px0 + 0.3, px1 - 0.3]) box(B, frame(...F(x, 0.25, fz - 2.4), h.rot), 0.28, 2.75, 0.28, wood, null);
  const P = (lx, ly, lz) => F(lx, ly, lz);
  B.quad(P(px0 - 0.3, 3.0, fz - 2.8), P(px0 - 0.3, 3.5, fz), P(px1 + 0.3, 3.5, fz), P(px1 + 0.3, 3.0, fz - 2.8), roof);
  B.quad(P(px1 + 0.3, 2.85, fz - 2.8), P(px1 + 0.3, 3.0, fz - 2.8), P(px0 - 0.3, 3.0, fz - 2.8), P(px0 - 0.3, 2.85, fz - 2.8), black);
  // wood front door with black frame, windows with black frames and white mullions
  facePatch(B, F, ox - 0.65, ox + 0.65, 0.25, 2.45, fz - 0.03, black);
  facePatch(B, F, ox - 0.5, ox + 0.5, 0.25, 2.3, fz - 0.04, wood);
  for (const [cx, y0, y1] of [[ox - gs * 2.0, 1.0, 2.3], [-h.w / 4, 4.0, 5.6], [h.w / 4, 4.0, 5.6]]) {
    facePatch(B, F, cx - 0.95, cx + 0.95, y0 - 0.1, y1 + 0.1, fz - 0.03, black);
    if (B.night) B.fx = 3;
    facePatch(B, F, cx - 0.8, cx + 0.8, y0, y1, fz - 0.04, B.night ? C('#ffd98a') : C('#7fa6c9'));
    B.fx = 0;
    facePatch(B, F, cx - 0.04, cx + 0.04, y0, y1, fz - 0.05, white);
  }
  // porch lamp (warm), house number plaque, planters with lavender, welcome mat
  B.fx = 3;
  box(B, frame(...F(ox + 0.95, 1.9, fz - 0.12), h.rot), 0.22, 0.32, 0.18, C('#ffd27a'), C('#ffd27a'));
  B.fx = 0;
  sign(S, frame(...F(0, 0, 0), h.rot), ox + 1.6, 1.75, fz - 0.06, 1.6, '8524');
  for (const x of [px0 + 0.6, px1 - 0.6]) { box(B, frame(...F(x, 0.25, fz - 2.15), h.rot), 0.6, 0.6, 0.6, C('#c26a3e'), null); box(B, frame(...F(x, 0.85, fz - 2.15), h.rot), 0.5, 0.35, 0.5, C('#8a6fc2'), C('#9c82d2')); }
  box(B, frame(...F(ox, 0.26, fz - 0.6), h.rot), 1.1, 0.02, 0.6, C('#6b4a3a'), C('#6b4a3a'));
  // walkway from the porch to the driveway, and a low hedge along the lawn
  box(B, frame(...F(ox, 0, fz - 4.2), h.rot), 1.2, 0.06, 3.0, C('#d9d3c7'), C('#d9d3c7'));
  box(B, frame(...F(-gs * (h.w / 2 - 0.4), 0, fz - 3.5), h.rot), 0.7, 0.7, 4.5, C('#5f8a46'), C('#6f9a52'));
}

// ── far hills (fog-free) ─────────────────────────────────────────────────────────────────────────
// Peaks by real bearing from the Mission Gorge / Cuyamaca corner. dist = backdrop radius (m),
// h = height above the valley (exaggerated a little for readability), w = half-width (deg).
const PEAKS = [
  { name: 'Cowles Mtn', brg: 235, dist: 2300, h: 270, w: 9, rock: true },
  { name: 'Pyles Peak', brg: 245, dist: 2250, h: 150, w: 5 },
  { name: 'Kwaay Paay', brg: 254, dist: 2150, h: 120, w: 5 },
  { name: 'South Fortuna', brg: 266, dist: 2150, h: 150, w: 6 },
  { name: 'North Fortuna', brg: 277, dist: 2200, h: 155, w: 6 },
  { name: 'Fanita hills', brg: 330, dist: 2000, h: 110, w: 20 },
  { name: 'Iron Mtn', brg: 12, dist: 2600, h: 140, w: 9 },
  { name: 'Lakeside hills', brg: 52, dist: 2100, h: 105, w: 16 },
  { name: 'El Cajon Mtn', brg: 75, dist: 2900, h: 200, w: 10, rock: true },
  { name: 'Rattlesnake Mtn', brg: 105, dist: 2000, h: 95, w: 10 },
  { name: 'Mt Helix', brg: 168, dist: 2300, h: 110, w: 8 },
  { name: 'Grossmont', brg: 192, dist: 2200, h: 100, w: 9 },
];
export function backdropSantee(THREE, kit, L) {
  const g = new THREE.Group();
  g.name = 'santee-backdrop';
  const rnd = prng(52);
  const B = new Buf();
  const cx = -250, cz = -300; // map centre
  const HAZE = C('#e6d6b8');
  const sunB = (252 * Math.PI) / 180, sunE = (24 * Math.PI) / 180;
  const SUN = [Math.sin(sunB) * Math.cos(sunE), Math.sin(sunE), -Math.cos(sunB) * Math.cos(sunE)];
  // baked toon-ish shading: 3 bands from the sun, then haze by distance
  const shade = (a, b, c, col, haze) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const d = nx * SUN[0] + ny * SUN[1] + nz * SUN[2];
    const k = d > 0.55 ? 1.12 : d > 0.15 ? 0.97 : 0.8;
    B.tri(a, b, c, mix(mul(col, k), HAZE, haze));
  };
  const toXZ = (brg, r) => { const a = (brg * Math.PI) / 180; return [cx + Math.sin(a) * r, cz - Math.cos(a) * r]; };
  const CHAP = [C('#7f8650'), C('#8c8a58'), C('#97905e'), C('#757d4c')];
  const ROCK = C('#bfb294');
  // continuous low ridge closing the horizon
  const N = 180;
  const ridge = (brg) => 34 + 12 * Math.sin(brg * 0.11) + 8 * Math.sin(brg * 0.37 + 1) + 4 * Math.sin(brg * 1.3);
  const ring = [];
  for (let i = 0; i <= N; i++) {
    const b = (i / N) * 360, r = 2450 + 110 * Math.sin(i * 0.7);
    const [x0, z0] = toXZ(b, r - 250), [x1, z1] = toXZ(b, r), [x2, z2] = toXZ(b, r + 450);
    ring.push([[x0, -6, z0], [x1, ridge(b), z1], [x2, ridge(b) * 0.4, z2]]);
  }
  for (let i = 0; i < N; i++) {
    const a = ring[i], b = ring[i + 1], col = CHAP[i % 4];
    shade(a[0], a[1], b[1], col, 0.42); shade(a[0], b[1], b[0], col, 0.42);
    shade(a[1], a[2], b[2], col, 0.48); shade(a[1], b[2], b[1], col, 0.48);
  }
  // the named peaks as domed mounds (rings at falling radius), in front of the ring
  const RINGS = [[1.0, -8], [0.74, 0.34], [0.46, 0.7], [0.2, 0.93]];
  for (const p of PEAKS) {
    const [px, pz] = toXZ(p.brg, p.dist);
    const rad = (p.dist * p.w * Math.PI) / 180;
    const n = 14;
    const ang = (p.brg * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    // local u runs across the line of sight (wide), v along it (shallower)
    const P = (u, v, y) => [px + u * ca - v * sa, y, pz + u * sa + v * ca];
    const jit = [];
    for (let k = 0; k < n; k++) jit.push(0.88 + rnd() * 0.24);
    const ring = RINGS.map(([f, hy]) => {
      const out = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, j2 = jit[k] * (0.95 + rnd() * 0.1);
        out.push(P(Math.cos(a) * rad * 1.5 * f * j2, Math.sin(a) * rad * 0.8 * f * j2, hy < 0 ? hy : p.h * hy * (0.94 + rnd() * 0.1)));
      }
      return out;
    });
    const top = P((rnd() - 0.5) * rad * 0.15, 0, p.h);
    const haze = clamp((p.dist - 1800) / 2400, 0.2, 0.5);
    for (let r = 0; r < ring.length - 1; r++) for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n, col = r === ring.length - 2 && p.rock && rnd() < 0.45 ? ROCK : CHAP[(k + r + p.brg) % 4];
      shade(ring[r][k], ring[r + 1][k], ring[r + 1][k2], col, haze); shade(ring[r][k], ring[r + 1][k2], ring[r][k2], col, haze);
    }
    const last = ring[ring.length - 1];
    for (let k = 0; k < n; k++) shade(last[k], top, last[(k + 1) % n], p.rock && k % 3 === 0 ? ROCK : mul(CHAP[k % 4], 1.05), haze);
  }
  if (kit.dark) { // night: sink the hills towards a dark blue silhouette
    const NIGHT = [0.09, 0.1, 0.18];
    for (let i = 0; i < B.c.length; i += 3) { B.c[i] = B.c[i] * 0.28 + NIGHT[0]; B.c[i + 1] = B.c[i + 1] * 0.28 + NIGHT[1]; B.c[i + 2] = B.c[i + 2] * 0.3 + NIGHT[2]; }
  }
  let mat = null;
  if (kit.toon) { try { mat = kit.toon(null, { vertexColors: true, fog: false, fx: 4 }); } catch (e) { mat = null; } }
  if (!mat) mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const m = new THREE.Mesh(B.geometry(THREE), mat);
  m.frustumCulled = false; m.name = 'santee-hills';
  m.renderOrder = -1;
  g.add(m);
  g.userData.stats = { tris: B.n };
  void L; void kit;
  return g;
}

