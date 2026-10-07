// Santee map visuals: terrain, lots, houses, shops, walls, rocks, scrub, the river channel, the
// lakes, parked cars, medians, power lines, the trolley, the hero house and the far hills.
// Everything static is merged per 200 m chunk into one vertex-coloured mesh (plus one sign mesh
// where there are signs). Every triangle carries a graphics-v2 surface code (kit.FX: stucco, tile,
// shingle, concrete, grass, dirt, water, rock, foliage, wood, metal, lot…) so the shader adds the
// detail; with an older engine the codes fall back to 0 (plain). Trees, poles, hydrants and
// mailboxes are solids without `drawn`, so the engine draws them (and can knock them over).
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
/** Gable roof with the ridge along local x (or z); gable ends in wall colour (surface code wfx). */
function gableRoof(B, F, w, d, y, rise, ov, col, wall, ridgeAlongZ = false, wfx = null) {
  const rfx = B.fx;
  if (ridgeAlongZ) {
    const hw = w / 2 + ov, hd = d / 2 + ov * 0.6;
    B.quad(F(-hw, y, hd), F(0, y + rise, hd), F(0, y + rise, -hd), F(-hw, y, -hd), col);
    B.quad(F(hw, y, -hd), F(0, y + rise, -hd), F(0, y + rise, hd), F(hw, y, hd), mul(col, 0.9));
    if (wfx != null) B.fx = wfx;
    B.tri(F(-w / 2, y, -d / 2), F(0, y + rise, -d / 2), F(w / 2, y, -d / 2), wall);
    B.tri(F(w / 2, y, d / 2), F(0, y + rise, d / 2), F(-w / 2, y, d / 2), wall);
    B.fx = rfx;
    return;
  }
  const hw = w / 2 + ov * 0.6, hd = d / 2 + ov;
  B.quad(F(-hw, y, -hd), F(-hw, y + rise, 0), F(hw, y + rise, 0), F(hw, y, -hd), col);
  B.quad(F(hw, y, hd), F(hw, y + rise, 0), F(-hw, y + rise, 0), F(-hw, y, hd), mul(col, 0.9));
  if (wfx != null) B.fx = wfx;
  B.tri(F(-w / 2, y, d / 2), F(-w / 2, y + rise, 0), F(-w / 2, y, -d / 2), wall);
  B.tri(F(w / 2, y, -d / 2), F(w / 2, y + rise, 0), F(w / 2, y, d / 2), wall);
  B.fx = rfx;
}
/** Downward-facing soffit under a roof overhang (so a low camera never sees into the roof). */
function soffit(B, F, w, d, y, ov, col) {
  const hw = w / 2 + ov, hd = d / 2 + ov;
  B.quad(F(-hw, y, -hd), F(hw, y, -hd), F(hw, y, hd), F(-hw, y, hd), col);
}
/** A thin vertical double-sided ribbon from a to b (wires, canes). */
function ribbonV(B, a, b, t, col) {
  const a2 = [a[0], a[1] + t, a[2]], b2 = [b[0], b[1] + t, b[2]];
  B.quad(a, b, b2, a2, col); B.quad(b, a, a2, b2, col);
}
function flatPoly(THREE, B, poly, y, col) {
  const v = poly.map(([x, z]) => new THREE.Vector2(x, z));
  if (THREE.ShapeUtils.isClockWise(v)) v.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(v, []);
  for (const [a, b, c] of tris) B.tri([v[a].x, y, v[a].y], [v[c].x, y, v[c].y], [v[b].x, y, v[b].y], col);
}
/** A shrub / tree-clump mound: a wide low ring, a narrower shoulder ring, a jittered crown. It
 *  sits on the ground (no underside), so it reads as foliage rather than a gem. */
function bush(B, x, y, z, rx, ry, rz, col, rnd, n = 5) {
  const r1 = [], r2 = [];
  const a0 = rnd() * 6.28;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5, k = 0.85 + rnd() * 0.3;
    r1.push([x + Math.cos(a) * rx * k, y + ry * 0.12, z + Math.sin(a) * rz * k]);
    const a2 = a + Math.PI / n, k2 = 0.78 + rnd() * 0.14;
    r2.push([x + Math.cos(a2) * rx * k2, y + ry * (0.5 + rnd() * 0.12), z + Math.sin(a2) * rz * k2]);
  }
  const top = [x + (rnd() - 0.5) * rx * 0.3, y + ry, z + (rnd() - 0.5) * rz * 0.3];
  const lite = mul(col, 1.1), dark = mul(col, 0.84);
  for (let i = 0; i < n; i++) {
    const a = r1[i], b = r1[(i + 1) % n], c = r2[i], d = r2[(i + n - 1) % n];
    B.tri(a, c, b, dark); B.tri(a, d, c, col); B.tri(c, top, r2[(i + 1) % n], i % 2 ? col : lite);
  }
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
    if (!c) chunks.set(k, (c = { i, j, B: new Buf(), S: new Buf(true), W: new Buf() })); // W: wires (see-through near the camera)
    return c;
  };
  const deco = L.deco;
  // triangle counts per section (root.userData.stats.sections), for budgeting
  const SEC = {}; let secN = 0;
  const sec = (name) => { let n = 0; for (const c of chunks.values()) n += c.B.n + c.S.n + c.W.n; SEC[name] = n - secN; secN = n; };
  // graphics-v2 surface codes (feature-detected: an older engine gets plain 0)
  const KF = kit.FX || {};
  const X = (n) => (KF[n] != null ? KF[n] : 0);
  const FX = {
    plain: 0, glow: 3, glass: X('glass'), stucco: X('stucco'), tile: X('tile'), shingle: X('shingle'), concrete: X('concrete'),
    grass: X('grass'), dirt: X('dirt'), sand: X('sand'), water: X('water'), metal: X('metal'), wood: X('wood'), rock: X('rock'),
    foliage: X('foliage'), lot: X('lot'), brick: X('brick'),
  };
  const dark = !!kit.dark;
  const lamp = kit.lamp ? (x, y, z) => { try { kit.lamp(x, y, z); } catch (e) { /* optional */ } } : () => {};
  const shadow = kit.shadow ? (...a) => { try { kit.shadow(...a); } catch (e) { /* optional */ } } : () => {};
  const blobShadow = kit.blobShadow ? (...a) => { try { kit.blobShadow(...a); } catch (e) { /* optional */ } } : () => {};

  // ── terrain ────────────────────────────────────────────────────────────────────────────────────
  // SoCal palette: dry foxtail grass and decomposed granite on open ground, olive-sage chaparral on
  // the hills with rust buckwheat and bare granite patches, irrigated lawns in the tracts and parks,
  // pale sand in the riverbed with darker damp streaks near the channel.
  const step = low ? 20 : 12.5;
  const DRY = C('#c2ad7a'), DRY2 = C('#b39c69'), DG = C('#cbb48a'), LAWN = C('#8fa35a'), LAWN2 = C('#829653'), SAGE = C('#7a8452'), OLIVE = C('#646d43'), RUST = C('#9a7652'), BARE = C('#b9a17a'), SAND = C('#ddc997'), SAND2 = C('#cdb685'), DAMP = C('#a99470'), BED = C('#5d8ea3'), RIM = C('#a8995f');
  const surf = (x, z, h) => {
    const rd = L.riverDist(x, z);
    if (L.inWater(x, z)) return [BED, 0];
    const n = (Math.sin(x * 0.031 + z * 0.017) + Math.sin(z * 0.043 - x * 0.011) + 2) * 0.25;
    if (rd < RIVER_HALF + 1) {
      const streak = 0.5 + 0.5 * Math.sin(x * 0.045 + Math.sin(z * 0.05) * 2.4);
      return [mix(mix(SAND, SAND2, (Math.sin(x * 0.11) * Math.cos(z * 0.13) + 1) * 0.5), DAMP, clamp(streak - 0.55, 0, 0.45)), 0];
    }
    if (rd < RIVER_HALF + 7) return [mix(SAND2, DRY2, (rd - RIVER_HALF - 1) / 6), 0];
    if (h > 1) {
      const m = 0.5 + 0.5 * Math.sin(x * 0.019 - z * 0.023 + Math.sin(x * 0.007) * 3);
      let c = mix(SAGE, OLIVE, n);
      if (m > 0.78) c = mix(c, RUST, (m - 0.78) * 2.2);
      else if (m < 0.16) c = mix(c, BARE, (0.16 - m) * 3.5);
      return [mix(c, RIM, clamp((h - 1) / 50, 0, 0.45) * (0.4 + n)), FX.dirt];
    }
    const zs = L.zoneAt(x, z);
    if (zs === 'ranch' || zs === 'prism' || zs === 'mobile' || zs === 'park') return [mix(LAWN, LAWN2, n), FX.grass];
    // the strip between an arterial's sidewalk and the lots: decomposed granite with groundcover
    if (zs === 'com' || L.roadGap(x, z, 24) < 14) return [mix(mix(DG, C('#8e9c5a'), 0.5 + 0.3 * n), LAWN2, 0.2), FX.grass];
    return [mix(mix(DRY, DRY2, n), DG, clamp(Math.sin(x * 0.013 + z * 0.021) - 0.4, 0, 0.6)), 0];
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
      const cell = (i, j) => {
        const a = V[j * (nx + 1) + i], b = V[j * (nx + 1) + i + 1], c = V[(j + 1) * (nx + 1) + i], d = V[(j + 1) * (nx + 1) + i + 1];
        const col = mix(mix(a[1][0], b[1][0], 0.5), mix(c[1][0], d[1][0], 0.5), 0.5);
        // the cell takes the most common surface code of its corners
        const f = [a[1][1], b[1][1], c[1][1], d[1][1]];
        B.fx = f[0] === f[3] || f[0] === f[1] || f[0] === f[2] ? f[0] : f[3];
        B.tri(a[0], c[0], b[0], col); B.tri(b[0], c[0], d[0], col);
      };
      // flat, uniform ground (most of the tracts) is drawn in 2x2 macro cells: a quarter of the
      // triangles. Neighbouring fine cells share the macro cell's edge heights (all 0), so no cracks.
      const at = (i, j) => V[j * (nx + 1) + i];
      for (let j = 0; j < nz; j += 2) for (let i = 0; i < nx; i += 2) {
        let coarse = i + 2 <= nx && j + 2 <= nz;
        if (coarse) {
          const f0 = at(i, j)[1][1];
          for (let jj = 0; jj <= 2 && coarse; jj++) for (let ii = 0; ii <= 2; ii++) { const v = at(i + ii, j + jj); if (Math.abs(v[0][1]) > 0.02 || v[1][1] !== f0) { coarse = false; break; } }
        }
        if (coarse) {
          const a = at(i, j), b = at(i + 2, j), c = at(i, j + 2), d = at(i + 2, j + 2);
          let r = 0, g = 0, bl = 0; for (let jj = 0; jj <= 2; jj++) for (let ii = 0; ii <= 2; ii++) { const k = at(i + ii, j + jj)[1][0]; r += k[0]; g += k[1]; bl += k[2]; }
          const col = [r / 9, g / 9, bl / 9];
          B.fx = a[1][1];
          B.tri(a[0], c[0], b[0], col); B.tri(b[0], c[0], d[0], col);
        } else for (let jj = j; jj < Math.min(j + 2, nz); jj++) for (let ii = i; ii < Math.min(i + 2, nx); ii++) cell(ii, jj);
      }
      B.fx = 0;
      yield;
    }
  }

  sec('terrain');
  // ── overlays: lots, grass, dirt lots, bulbs, water ──────────────────────────────────────────────
  const ASPH = C('#64666a'), ASPH2 = C('#5c5e62'), GRASS = C('#94b862'), STRIPE = C('#eeeeea'), CONC = C('#cdc8bd'), CONC2 = C('#bfb9ad');
  for (const o of L.open) {
    if (o.kind === 'sand' || o.kind === 'dirt' || o.poly === deco.lakePark) continue;
    let cx = 0, cz = 0; for (const [x, z] of o.poly) { cx += x; cz += z; } cx /= o.poly.length; cz /= o.poly.length;
    const B = get(cx, cz).B;
    if (o.kind === 'lot') { B.fx = FX.lot; flatPoly(THREE, B, o.poly, 0.05, o.poly.length > 10 ? ASPH : ASPH2); }
    else if (o.kind === 'grass') { B.fx = FX.grass; flatPoly(THREE, B, o.poly, 0.04, GRASS); }
    B.fx = 0;
  }
  for (const m of deco.misc) if (m.type === 'dirtlot') { const B = get(m.x, m.z).B; B.fx = FX.dirt; flatPoly(THREE, B, rectPoly(m.x, m.z, m.w, m.d, 0), 0.03, C('#cdb27e')); B.fx = 0; }
  // parking stripes, a concrete apron along the shop fronts, planters with palms' companions
  for (const l of deco.lots || []) {
    if (!l.stripes) continue;
    const F = frame(l.x, 0.07, l.z, l.rot);
    const B = get(l.x, l.z).B;
    for (const rowZ of [l.d / 2 - 18, l.d / 2 - 40]) {
      if (rowZ < -l.d / 2 + 30) continue;
      for (let x = -l.w / 2 + 8; x < l.w / 2 - 8; x += 3) B.quad(F(x, 0, rowZ - 2.6), F(x, 0, rowZ + 2.6), F(x + 0.14, 0, rowZ + 2.6), F(x + 0.14, 0, rowZ - 2.6), STRIPE);
      // end-of-row planter islands
      if (!low) for (const ex of [-l.w / 2 + 5.5, l.w / 2 - 5.5]) {
        B.fx = FX.concrete; box(B, frame(...F(ex, 0, rowZ), l.rot), 2.4, 0.18, 5.4, CONC2, CONC); B.fx = FX.foliage;
        bush(B, ...F(ex, 0.15, rowZ - 1.2), 0.9, 0.8, 0.9, C('#6d8a46'), rnd, 5); bush(B, ...F(ex, 0.15, rowZ + 1.2), 0.8, 0.7, 0.8, C('#7f9a52'), rnd, 5); B.fx = 0;
      }
    }
    // the sidewalk in front of the stores
    B.fx = FX.concrete;
    B.quad(F(-l.w / 2, 0.02, -l.d / 2 + 28), F(-l.w / 2, 0.02, -l.d / 2 + 33), F(l.w / 2, 0.02, -l.d / 2 + 33), F(l.w / 2, 0.02, -l.d / 2 + 28), CONC);
    B.fx = 0;
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
    B.fx = FX.grass;
    B.quad(F(-fw / 2, 0.01, -fd / 2), F(-fw / 2, 0.01, fd / 2), F(fw / 2, 0.01, fd / 2), F(fw / 2, 0.01, -fd / 2), C('#6fae4c'));
    B.fx = 0;
    for (const lx of [-fw / 2, 0, fw / 2]) B.quad(F(lx - 0.2, 0.02, -fd / 2), F(lx - 0.2, 0.02, fd / 2), F(lx + 0.2, 0.02, fd / 2), F(lx + 0.2, 0.02, -fd / 2), STRIPE);
  }
  // cul-de-sac bulbs (asphalt discs) with a kerb ring
  for (const b of deco.bulbs) {
    const B = get(b.x, b.z).B;
    const ring = ellipse(b.x, b.z, b.r, b.r, 14);
    B.fx = FX.lot;
    for (let i = 0; i < 14; i++) { const a = ring[i], c = ring[(i + 1) % 14]; B.tri([b.x, 0.06, b.z], [c[0], 0.06, c[1]], [a[0], 0.06, a[1]], ASPH); }
    B.fx = FX.concrete;
    const ring2 = ellipse(b.x, b.z, b.r + 1, b.r + 1, 14);
    for (let i = 0; i < 14; i++) { const a = ring[i], c = ring[(i + 1) % 14], d = ring2[(i + 1) % 14], e = ring2[i]; B.quad([a[0], 0.07, a[1]], [c[0], 0.07, c[1]], [d[0], 0.14, d[1]], [e[0], 0.14, e[1]], CONC); }
    B.fx = 0;
  }
  // water: lakes and river pools, a little below grade, with a pale shore of decomposed granite
  const WATER = C('#3d7f9f'), WATER2 = C('#4a8fae'), SHORE = C('#cdbf93');
  for (const poly of deco.lakes.concat(deco.pools)) {
    let cx = 0, cz = 0; for (const [x, z] of poly) { cx += x; cz += z; } cx /= poly.length; cz /= poly.length;
    const B = get(cx, cz).B;
    const ext = poly.map(([x, z]) => [cx + (x - cx) * 1.12, cz + (z - cz) * 1.12]);
    B.fx = FX.sand;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], c = ext[(i + 1) % poly.length], d = ext[i]; B.quad([a[0], -0.42, a[1]], [d[0], 0.03, d[1]], [c[0], 0.03, c[1]], [b[0], -0.42, b[1]], SHORE); }
    B.fx = FX.water;
    flatPoly(THREE, B, poly, -0.4, WATER);
    if (!FX.water) { const inner = poly.map(([x, z]) => [cx + (x - cx) * 0.6, cz + (z - cz) * 0.6]); flatPoly(THREE, B, inner, -0.38, WATER2); }
    B.fx = 0;
    // fountain jets in Santee Lakes
    if (poly.length === 20) blob(B, cx, -0.4, cz, 1.6, 4.5, 1.6, C('#e8f4fb'), rnd, 5);
  }
  // lakeside paths (concrete loop around each lake) and the fishing docks
  for (const ring of deco.paths || []) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, px = (-dz / l) * 1.1, pz = (dx / l) * 1.1;
      if (L.inWater((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) || L.roadGap((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 20) < 1) continue;
      const B = get(a[0], a[1]).B; B.fx = FX.concrete;
      const ya = Math.max(0, H(a[0], a[1])) + 0.07, yb = Math.max(0, H(b[0], b[1])) + 0.07;
      B.quad([a[0] - px, ya, a[1] - pz], [a[0] + px, ya, a[1] + pz], [b[0] + px, yb, b[1] + pz], [b[0] - px, yb, b[1] - pz], CONC);
      B.fx = 0;
    }
  }
  for (const d of deco.docks || []) {
    const B = get(d.x, d.z).B;
    const rot = Math.atan2(d.dx, d.dz); // local +z runs out over the water
    const F = frame(d.x, 0, d.z, rot);
    B.fx = FX.wood;
    box(B, frame(...F(0, 0.25, d.len / 2), rot), 2.2, 0.18, d.len, C('#8a6a4a'), C('#9c7b58'));
    for (let z = 1; z < d.len; z += 3) for (const sx of [-1, 1]) box(B, frame(...F(sx * 1.0, -0.6, z), rot), 0.2, 1.4, 0.2, C('#5f4a36'), null);
    for (const sx of [-1, 1]) box(B, frame(...F(sx * 1.05, 0.43, d.len / 2 + 1), rot), 0.08, 0.8, d.len - 2, C('#6f5640'), C('#7a5f46'));
    B.fx = 0;
  }
  yield;

  sec('overlays');
  // ── houses ─────────────────────────────────────────────────────────────────────────────────────
  const WARM = [C('#ffd98a'), C('#ffcf7a'), C('#ffe2a8')], COOL = C('#cfe0ff');
  const DRIVE = C('#d3cdc1'), WALK = C('#cbc5b8'), BLACK = C('#24262a'), GRAVEL = C('#cbbd9e'), DGc = C('#d2bd92'), STONE = C('#9a8f80');
  const LAWNS = [C('#8fb562'), C('#86ab5a'), C('#9cbb68'), C('#b4b977')];
  const AGAVE = [C('#7f9a8a'), C('#8aa07a'), C('#6f8a6a')], SUCC = [C('#c46a4a'), C('#b78a3a'), C('#8a7aa6')];
  const lit = () => (dark && rnd() < 0.48 ? (rnd() < 0.18 ? COOL : WARM[Math.floor(rnd() * 3)]) : null);
  /** A window on the front face (-z) at local x cx, y0..y1: frame, glass (lit at night), mullion. */
  const windowAt = (B, F, cx, y0, y1, ww, zf, frameCol, mull, litCol) => {
    facePatch(B, F, cx - ww / 2 - 0.1, cx + ww / 2 + 0.1, y0 - 0.1, y1 + 0.1, zf - 0.01, frameCol);
    if (litCol) B.fx = FX.glow; else B.fx = FX.glass;
    facePatch(B, F, cx - ww / 2, cx + ww / 2, y0, y1, zf - 0.02, litCol || C('#5d6f84'));
    B.fx = 0;
    if (mull) facePatch(B, F, cx - 0.035, cx + 0.035, y0, y1, zf - 0.03, mull);
  };
  /** The same on a side face (local x = xs, facing sign sx). */
  const sideWindow = (B, F, xs, sx, cz, y0, y1, ww, frameCol, litCol) => {
    const P = (lx, ly, lz) => F(lx, ly, lz);
    const q4 = (z0, z1, a, b, o, col) => (sx > 0 ? B.quad(P(xs + o, a, z0), P(xs + o, b, z0), P(xs + o, b, z1), P(xs + o, a, z1), col) : B.quad(P(xs - o, a, z1), P(xs - o, b, z1), P(xs - o, b, z0), P(xs - o, a, z0), col));
    q4(cz - ww / 2 - 0.1, cz + ww / 2 + 0.1, y0 - 0.1, y1 + 0.1, 0.01, frameCol);
    B.fx = litCol ? FX.glow : FX.glass; q4(cz - ww / 2, cz + ww / 2, y0, y1, 0.02, litCol || C('#5d6f84')); B.fx = 0;
  };
  let hn = 0;
  for (const h of deco.houses) {
    const { B } = get(h.x, h.z);
    const F = frame(h.x, 0, h.z, h.rot);
    const wall = C(h.wall), roof = C(h.roof), trim = C(h.trim || '#f6f2ea');
    const hh = h.h, fz = -h.d / 2 - 0.02;
    const roofFx = FX[h.roofFx] || 0;
    if (h.style === 'mobile') {
      B.fx = FX.metal; box(B, F, h.w, 3.1, h.d, wall, null);
      B.fx = FX.metal; gableRoof(B, F, h.w, h.d, 3.1, 0.6, 0.3, roof, wall, true);
      B.fx = 0;
      facePatch(B, F, -h.w / 2, h.w / 2, 0.9, 1.2, fz, C('#7fa7c4'));
      if (!low) box(B, frame(...F(0, 0, -h.d / 2 - 1.2), h.rot), 2.4, 0.5, 2.0, C('#b8a890'), C('#c9b9a0')); // deck step
      hn++; continue;
    }
    const arch = h.arch || (h.style === 'prism' ? 'farmhouse' : 'ranch');
    const wallFx = arch === 'ranchWood' ? FX.wood : FX.stucco;
    B.fx = wallFx;
    box(B, F, h.w, hh, h.d, wall, null);
    B.fx = 0;
    const two = h.stories === 2;
    // craftsman stone base / Spanish darker plinth on the street face
    if (arch === 'craftsman') { B.fx = FX.rock; facePatch(B, F, -h.w / 2, h.w / 2, 0, 0.9, fz - 0.03, STONE); B.fx = 0; }
    const gs = h.garage, gw = h.gw || Math.min(5.4, h.w * 0.45), gx = h.gx != null ? h.gx : gs * (h.w / 2 - gw / 2 - 0.6);
    const frameCol = arch === 'farmhouse' ? BLACK : arch === 'spanish' ? C('#5a4636') : trim;
    if (!h.hero) {
      // garage door with panel lines, a trim frame and a little light above
      facePatch(B, F, gx - gw / 2 - 0.15, gx + gw / 2 + 0.15, 0, 2.45, fz - 0.005, frameCol === BLACK ? C('#e9e6df') : trim);
      const gc = C(h.garageCol || '#f2efe8');
      facePatch(B, F, gx - gw / 2, gx + gw / 2, 0, 2.3, fz - 0.01, gc);
      if (high) for (let k = 1; k < 4; k++) facePatch(B, F, gx - gw / 2, gx + gw / 2, k * 0.58 - 0.04, k * 0.58, fz - 0.02, mul(gc, 0.82));
      // front door (with a small entry recess) on the other side, a window beyond it
      const dx = gx - gs * (gw / 2 + 1.5);
      facePatch(B, F, dx - 0.7, dx + 0.7, 0, 2.4, fz - 0.01, frameCol);
      facePatch(B, F, dx - 0.5, dx + 0.5, 0, 2.2, fz - 0.02, C(h.door || '#7a4b2e'));
      const farEdge = -gs * h.w / 2, span = Math.abs(farEdge - (dx - gs * 0.9));
      if (span > 1.6) {
        const cx = (farEdge + dx - gs * 0.9) / 2, ww = Math.min(2.6, span - 0.8);
        windowAt(B, F, cx, 1.0, 2.2, ww, fz, frameCol, arch === 'farmhouse' ? BLACK : trim, lit());
      }
      if (two) {
        const n = h.w > 11 ? 3 : 2;
        for (let k = 0; k < n; k++) { const cx = -h.w / 2 + (h.w * (k + 0.5)) / n; windowAt(B, F, cx, 3.95, 5.25, 1.6, fz, frameCol, arch === 'spanish' ? null : frameCol === BLACK ? BLACK : trim, lit()); }
        if (arch === 'farmhouse') facePatch(B, F, -h.w / 2, h.w / 2, 3.2, 3.32, fz - 0.03, BLACK); // belly band
      }
      // porch / entry treatments
      if (arch === 'craftsman' && !low) {
        const pf = frame(...F(dx, 0, fz - 1.5), h.rot);
        for (const sx of [-1.3, 1.3]) { B.fx = FX.rock; box(B, frame(...F(dx + sx, 0, fz - 2.6), h.rot), 0.55, 1.0, 0.55, STONE, null); B.fx = 0; box(B, frame(...F(dx + sx, 1.0, fz - 2.6), h.rot), 0.32, 1.7, 0.32, trim, null); }
        B.fx = roofFx; gableRoof(B, pf, 3.4, 3.0, 2.7, 0.9, 0.15, roof, wall, true, wallFx); B.fx = 0;
        soffit(B, pf, 3.4, 3.0, 2.69, 0.15, mul(trim, 0.9));
      } else if (arch === 'farmhouse' && !low) {
        const pf = frame(...F(dx, 2.6, fz - 0.9), h.rot);
        B.fx = roofFx; gableRoof(B, pf, 2.6, 1.8, 0, 0.7, 0.1, roof, wall, false, wallFx); B.fx = 0;
      } else if (arch === 'spanish' && !low) {
        B.fx = FX.stucco; box(B, frame(...F(dx, 0, fz - 0.7), h.rot), 2.4, 2.9, 1.4, mul(wall, 0.95), null); B.fx = 0; // entry tower
        facePatch(B, frame(...F(dx, 0, fz - 0.7), h.rot), -0.6, 0.6, 0, 2.3, -0.72, C(h.door || '#5c3a26'));
        B.fx = FX.tile; hipRoof(B, frame(...F(dx, 0, fz - 0.7), h.rot), 2.4, 1.4, 2.9, 0.6, 0.15, roof); B.fx = 0;
      }
      if (h.porchLight) {
        B.fx = FX.glow; box(B, frame(...F(dx + gs * 0.95, 1.9, fz - 0.1), h.rot), 0.18, 0.28, 0.14, C('#ffd27a'), C('#ffd27a')); B.fx = 0;
        if (dark) { const p = F(dx + gs * 0.95, 2.0, fz - 0.4); lamp(p[0], p[1], p[2]); }
      }
      // side windows (corner lots show their sides to the street)
      if (!low) {
        sideWindow(B, F, h.w / 2, 1, -h.d / 4, 1.0, 2.1, 1.6, frameCol, lit());
        sideWindow(B, F, -h.w / 2, -1, h.d / 4, 1.0, 2.1, 1.6, frameCol, lit());
      }
    }
    // roof: farmhouse steep gable, craftsman front gable, Spanish / two-storey hip, ranch low hip or gable
    const ov = arch === 'spanish' ? 0.45 : 0.6;
    B.fx = roofFx;
    let top = hh;
    if (arch === 'farmhouse') { gableRoof(B, F, h.w, h.d, hh, 3.3, 0.45, roof, wall, true, wallFx); top = hh + 3.3; }
    else if (arch === 'craftsman') { gableRoof(B, F, h.w, h.d, hh, 2.3, 0.6, roof, wall, true, wallFx); top = hh + 2.3; }
    else if (h.gable) { gableRoof(B, F, h.w, h.d, hh, two ? 2.2 : 1.7, ov, roof, wall, false, wallFx); top = hh + 1.7; }
    else { hipRoof(B, F, h.w, h.d, hh, two ? 2.0 : 1.5, ov, roof); top = hh + 1.5; }
    B.fx = 0;
    soffit(B, F, h.w, h.d, hh - 0.01, arch === 'farmhouse' ? 0.45 : ov, mul(wall, 0.82));
    // a chimney on some older ranches, a vent pipe or two everywhere
    if (!low && (arch === 'ranch' || arch === 'ranchWood') && rnd() < 0.3) { B.fx = arch === 'ranchWood' ? FX.brick : FX.stucco; box(B, frame(...F(-gs * (h.w / 2 - 1.2), 0, h.d / 4), h.rot), 1.1, top + 0.6, 0.9, arch === 'ranchWood' ? C('#9a5a42') : mul(wall, 0.95), C('#55504a')); B.fx = 0; }
    // driveway + walkway (concrete), yard (lawn / xeriscape gravel with agave and boulders / DG)
    const sb = h.setback || 6;
    B.fx = FX.concrete;
    const dw0 = F(gx - gw / 2 - 0.4, 0.06, -h.d / 2), dw1 = F(gx + gw / 2 + 0.4, 0.06, -h.d / 2), dw2 = F(gx + gw / 2 + 0.4, 0.06, -h.d / 2 - sb + 0.2), dw3 = F(gx - gw / 2 - 0.4, 0.06, -h.d / 2 - sb + 0.2);
    B.quad(dw0, dw1, dw2, dw3, DRIVE);
    const dx2 = gx - gs * (gw / 2 + 1.5);
    if (!h.hero) B.quad(F(dx2 - 0.55, 0.055, -h.d / 2), F(dx2 + 0.55, 0.055, -h.d / 2), F(dx2 + 0.55, 0.055, -h.d / 2 - 2.2), F(dx2 - 0.55, 0.055, -h.d / 2 - 2.2), WALK);
    B.fx = 0;
    if (!low && !h.hero) {
      const yx0 = -gs * (h.w / 2 + 0.2), yx1 = gx - gs * (gw / 2 + 0.5);
      const yz0 = -h.d / 2 - 0.05, yz1 = -h.d / 2 - sb + 0.4;
      const yq = (col) => { const a = F(yx0, 0.045, yz0), b = F(yx1, 0.045, yz0), c = F(yx1, 0.045, yz1), d = F(yx0, 0.045, yz1); if (gs > 0) B.quad(a, b, c, d, col); else B.quad(a, d, c, b, col); };
      if (h.yard === 'lawn') { B.fx = FX.grass; yq(LAWNS[Math.floor(rnd() * LAWNS.length)]); B.fx = 0; }
      else {
        B.fx = FX.dirt; yq(h.yard === 'xeri' ? GRAVEL : DGc); B.fx = FX.foliage;
        const n = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const lx = yx0 + (yx1 - yx0) * (0.2 + 0.6 * rnd()), lz = yz0 + (yz1 - yz0) * (0.25 + 0.5 * rnd());
          const p = F(lx, 0, lz);
          if (rnd() < 0.55) { // agave rosette: a ring of upturned blades
            const col = AGAVE[Math.floor(rnd() * 3)], r = 0.45 + rnd() * 0.35;
            for (let m = 0; m < 6; m++) { const a = (m / 6) * Math.PI * 2 + rnd() * 0.4, p0 = [p[0], 0.05, p[2]], p1 = [p[0] + Math.cos(a) * r - Math.sin(a) * 0.12, 0.1, p[2] + Math.sin(a) * r + Math.cos(a) * 0.12], p2 = [p[0] + Math.cos(a) * r * 1.1, r * 1.1, p[2] + Math.sin(a) * r * 1.1]; B.tri(p0, p1, p2, col); B.tri(p0, p2, p1, mul(col, 0.85)); }
          } else bush(B, p[0], 0, p[2], 0.45, 0.5, 0.45, rnd() < 0.5 ? SUCC[Math.floor(rnd() * 3)] : C('#8a9a5a'), rnd, 4);
        }
        B.fx = FX.rock; if (rnd() < 0.6) { const p = F(yx0 + (yx1 - yx0) * 0.7, 0, yz0 + (yz1 - yz0) * 0.7); blob(B, p[0], -0.1, p[2], 0.6, 0.55, 0.5, C('#b7aa94'), rnd, 5); }
        B.fx = 0;
      }
    }
    if (h.hero) { B.night = dark; heroHouse(THREE, B, get(h.x, h.z).S, F, h, FX, lamp); B.night = false; }
    if (++hn % 60 === 0) yield;
  }
  yield;

  sec('houses');
  // ── parked cars (map-drawn solids of kind 'car'): a low-poly car merged into the chunk ─────────
  {
    const TIRE = C('#1d1e21'), GL = C('#3e4c5c'), TAIL = C('#b0262a'), HEAD = C('#f4f2e8'), TRIMC = C('#2a2c30');
    let pn = 0;
    for (const s of L.solids) {
      if (s.kind !== 'car') continue;
      const { B } = get(s.x, s.z);
      const y0 = Math.max(0, H(s.x, s.z));
      const F = frame(s.x, y0, s.z, s.rot);
      const paint = C(s.color || '#a7abb0'), len = s.d, w = s.w;
      const pickup = s.style === 'pickup', suv = s.style === 'suv';
      // wheels first (dark blocks peeking out of the arches)
      for (const zz of [len / 2 - 0.85, -len / 2 + 0.85]) for (const sx of [-1, 1]) box(B, frame(...F(sx * (w / 2 - 0.12), 0, zz), s.rot), 0.26, 0.62, 0.66, TIRE, null);
      // body: a lower box with a lighter sill line
      const bodyTop = suv || pickup ? 1.15 : 0.95;
      box(B, frame(...F(0, 0.3, 0), s.rot), w - 0.06, bodyTop - 0.3, len, paint, mul(paint, 1.06));
      facePatch(B, frame(...F(0, 0, 0), s.rot), -w / 2 + 0.25, -w / 2 + 0.6, 0.55, 0.78, -len / 2 - 0.01, TAIL);
      facePatch(B, frame(...F(0, 0, 0), s.rot), w / 2 - 0.6, w / 2 - 0.25, 0.55, 0.78, -len / 2 - 0.01, TAIL);
      facePatch(B, frame(...F(0, 0, 0), s.rot + Math.PI), -w / 2 + 0.25, -w / 2 + 0.6, 0.6, 0.78, -len / 2 - 0.01, HEAD);
      facePatch(B, frame(...F(0, 0, 0), s.rot + Math.PI), w / 2 - 0.6, w / 2 - 0.25, 0.6, 0.78, -len / 2 - 0.01, HEAD);
      // cabin: a tapered greenhouse (glass sides, painted roof)
      const cl = pickup ? len * 0.32 : suv ? len * 0.62 : len * 0.48, cz = pickup ? len * 0.1 : suv ? -len * 0.06 : -len * 0.04;
      const ch = suv ? 0.72 : pickup ? 0.62 : 0.5, b0 = w / 2 - 0.08, t0 = w / 2 - (suv ? 0.18 : 0.3);
      const P = (lx, ly, lz) => F(lx, bodyTop + ly, cz + lz);
      const zb = -cl / 2, zf = cl / 2, tb = zb + (suv ? 0.12 : 0.35), tf = zf - (suv ? 0.25 : 0.45);
      B.fx = FX.glass;
      B.quad(P(-b0, 0, zb), P(-t0, ch, tb), P(t0, ch, tb), P(b0, 0, zb), GL); // rear glass
      B.quad(P(b0, 0, zf), P(t0, ch, tf), P(-t0, ch, tf), P(-b0, 0, zf), GL); // windscreen
      B.quad(P(-b0, 0, zf), P(-t0, ch, tf), P(-t0, ch, tb), P(-b0, 0, zb), GL);
      B.quad(P(b0, 0, zb), P(t0, ch, tb), P(t0, ch, tf), P(b0, 0, zf), GL);
      B.fx = 0;
      B.quad(P(-t0, ch, tb), P(-t0, ch, tf), P(t0, ch, tf), P(t0, ch, tb), paint); // roof
      if (pickup) { // the bed: low walls behind the cab
        const bz0 = cz - cl / 2 - 0.05, bz1 = -len / 2 + 0.1;
        box(B, frame(...F(-w / 2 + 0.1, bodyTop, (bz0 + bz1) / 2), s.rot), 0.12, 0.35, bz0 - bz1, paint, paint);
        box(B, frame(...F(w / 2 - 0.1, bodyTop, (bz0 + bz1) / 2), s.rot), 0.12, 0.35, bz0 - bz1, paint, paint);
        B.quad(F(-w / 2 + 0.16, bodyTop + 0.01, bz1), F(-w / 2 + 0.16, bodyTop + 0.01, bz0), F(w / 2 - 0.16, bodyTop + 0.01, bz0), F(w / 2 - 0.16, bodyTop + 0.01, bz1), TRIMC);
      }
      if (++pn % 150 === 0) yield;
    }
  }
  yield;

  sec('cars');
  // ── shops, big boxes, hangars, canopies ────────────────────────────────────────────────────────
  let shn = 0;
  for (const s of deco.shops) {
    if (++shn % 40 === 0) yield;
    const { B, S } = get(s.x, s.z);
    const wall = C(s.color), trim = C(s.trim);
    // local +z points to the street for these (centres face their street); flip so the front is +z
    const G = frame(s.x, 0, s.z, s.rot + Math.PI);
    B.fx = FX.stucco; box(B, G, s.w, s.h, s.d, wall, null); B.fx = FX.concrete;
    B.quad(G(-s.w / 2, s.h, -s.d / 2), G(-s.w / 2, s.h, s.d / 2), G(s.w / 2, s.h, s.d / 2), G(s.w / 2, s.h, -s.d / 2), C('#bdb8b0')); B.fx = 0;
    if (s.storage) {
      B.fx = FX.metal;
      for (let x = -s.w / 2 + 2; x < s.w / 2 - 2; x += 4) facePatch(B, G, x, x + 3, 0, 2.6, -s.d / 2 - 0.02, C('#e7e1d6'));
      B.fx = 0;
      facePatch(B, G, -s.w / 2, s.w / 2, 2.6, s.h, -s.d / 2 - 0.02, trim);
      B.fx = FX.metal; gableRoof(B, G, s.w, s.d, s.h, 0.6, 0.2, C('#b9bcbd'), wall, false, FX.stucco); B.fx = 0;
      if (s.sign) sign(S, G, 0, 2.95, -s.d / 2 - 0.05, Math.min(s.w - 2, 10), s.sign);
    } else {
      // storefront glass (the shader draws the panes, lit at night), parapet, awning, sign
      B.fx = X('shop') || (dark ? 3 : 0);
      facePatch(B, G, -s.w / 2 + 1, s.w / 2 - 1, 0, 3.0, -s.d / 2 - 0.02, X('shop') ? C('#55687c') : dark ? C('#ffe3a6') : C('#3b4a5c'));
      B.fx = FX.stucco;
      box(B, frame(...G(0, s.h, -s.d / 2 + 0.6), s.rot + Math.PI), s.w + 0.2, 1.4, 1.4, trim, trim);
      B.fx = s.tile ? FX.tile : 0;
      const aw = (lx0, lx1) => B.quad(G(lx0, 3.4, -s.d / 2), G(lx0, 3.0, -s.d / 2 - 2.2), G(lx1, 3.0, -s.d / 2 - 2.2), G(lx1, 3.4, -s.d / 2), s.tile ? C('#c0603c') : trim);
      aw(-s.w / 2, s.w / 2);
      B.fx = 0;
      B.quad(G(-s.w / 2, 3.0, -s.d / 2 - 2.2), G(s.w / 2, 3.0, -s.d / 2 - 2.2), G(s.w / 2, 3.4, -s.d / 2), G(-s.w / 2, 3.4, -s.d / 2), mul(wall, 0.7)); // awning underside
      if (s.sign) sign(S, G, 0, s.h - 1.2, -s.d / 2 - 0.25, Math.min(s.w - 2, s.school ? 22 : 12), s.sign);
      if (!low) { B.fx = FX.metal; box(B, frame(...G(-s.w / 4, s.h, 2), s.rot), 2.0, 1.1, 1.4, C('#c4c6c4'), C('#d4d6d4')); B.fx = 0; }
      if (dark && !s.school) { const p = G(0, 2.9, -s.d / 2 - 1.2); lamp(p[0], p[1], p[2]); }
    }
  }
  for (const s of deco.bigs) {
    const { B, S } = get(s.x, s.z);
    const G = frame(s.x, 0, s.z, s.rot + Math.PI);
    const wall = C(s.color), trim = C(s.trim);
    if (s.hangar) {
      B.fx = FX.metal; box(B, G, s.w, s.h - 2, s.d, wall, null);
      gableRoof(B, G, s.w, s.d, s.h - 2, 2.2, 0.4, C('#9aa5ad'), wall, false, FX.metal);
      facePatch(B, G, -s.w / 2 + 4, s.w / 2 - 4, 0, s.h - 3, -s.d / 2 - 0.02, C('#b9c0c4'));
      B.fx = 0;
      if (s.sign) sign(S, G, 0, s.h - 1.5, -s.d / 2 - 0.3, 26, s.sign);
      continue;
    }
    B.fx = FX.stucco; box(B, G, s.w, s.h, s.d, wall, null); B.fx = FX.concrete;
    B.quad(G(-s.w / 2, s.h, -s.d / 2), G(-s.w / 2, s.h, s.d / 2), G(s.w / 2, s.h, s.d / 2), G(s.w / 2, s.h, -s.d / 2), C('#c4c0b8')); B.fx = 0;
    facePatch(B, G, -s.w / 2, s.w / 2, s.h - 1.6, s.h, -s.d / 2 - 0.02, trim);
    B.fx = FX.stucco; box(B, frame(...G(0, 0, -s.d / 2 - 1), s.rot + Math.PI), 18, s.h + 2.5, 2, trim, trim); B.fx = 0;
    B.fx = X('shop') || 0; facePatch(B, G, -7, 7, 0, 3.4, -s.d / 2 - 2.03, C('#3b4a5c')); B.fx = 0;
    sign(S, G, 0, s.h - 0.3, -s.d / 2 - 2.1, 16, s.sign);
    // cart corral and a row of bollards by the door (visual)
    if (!low) { B.fx = FX.metal; box(B, frame(...G(12, 0, -s.d / 2 - 14), s.rot + Math.PI), 1.6, 1.0, 6, C('#9aa0a6'), null); B.fx = 0; }
  }
  for (const m of deco.misc) {
    const { B } = get(m.x, m.z);
    if (m.type === 'canopy') {
      const F = frame(m.x, 0, m.z, m.rot);
      box(B, frame(m.x, 0, m.z, m.rot), m.w, 1.0, m.d, C('#ffffff'), C('#e8e4dc'), 4.6);
      B.quad(F(-m.w / 2, 4.59, -m.d / 2), F(m.w / 2, 4.59, -m.d / 2), F(m.w / 2, 4.59, m.d / 2), F(-m.w / 2, 4.59, m.d / 2), dark ? C('#fff1cf') : C('#f2f0ea'));
      facePatch(B, frame(m.x, 0, m.z, m.rot + Math.PI), -m.w / 2, m.w / 2, 4.9, 5.4, -m.d / 2 - 0.02, C('#d9483b'));
      for (const [px, pz] of [[-m.w / 2 + 2, -m.d / 2 + 2], [m.w / 2 - 2, -m.d / 2 + 2], [-m.w / 2 + 2, m.d / 2 - 2], [m.w / 2 - 2, m.d / 2 - 2]]) box(B, frame(...F(px, 0, pz), m.rot), 0.5, 4.6, 0.5, C('#e8e4dc'), null);
      shadow(m.x, m.z, m.w, m.d, m.rot, 5.4);
      if (dark) for (const px of [-6, 6]) { const p = F(px, 4.4, 0); lamp(p[0], p[1], p[2]); }
    } else if (m.type === 'plane') {
      const F = frame(m.x, 0, m.z, m.rot);
      const tint = [C('#c8102e'), C('#1d4f8a'), C('#2a8a5a'), C('#d9a21b')][(m.k || 0) % 4];
      box(B, F, 1.2, 1.2, 7, C('#f4f4f2'), C('#ffffff'), 0.6);
      box(B, frame(...F(0, 1.35, -0.6), m.rot), 9, 0.15, 1.4, C('#f4f4f2'), C('#ffffff'));
      box(B, frame(...F(0, 1.8, 3.1), m.rot), 0.15, 1.4, 0.9, tint, tint);
      box(B, frame(...F(0, 1.85, 3.2), m.rot), 2.8, 0.1, 0.7, C('#f4f4f2'), C('#ffffff'));
      B.fx = FX.glass; box(B, frame(...F(0, 1.65, -1.4), m.rot), 1.1, 0.35, 1.2, C('#41556a'), C('#41556a')); B.fx = 0;
      facePatch(B, frame(...F(0, 0, 0), m.rot + Math.PI / 2), -3.2, 3.2, 1.05, 1.15, -0.61, tint);
      box(B, frame(...F(0, 0.7, -3.6), m.rot), 0.3, 0.6, 0.3, C('#333333'), null);
      for (const sx of [-1.4, 1.4]) box(B, frame(...F(sx, 0, -0.6), m.rot), 0.2, 0.6, 0.3, C('#1d1e21'), null);
      blobShadow(m.x, m.z, 3.2, 2);
    } else if (m.type === 'rv') {
      const F = frame(m.x, 0, m.z, m.rot);
      box(B, F, m.w, m.h, m.d, C('#f3f1ea'), C('#ffffff'), 0.3);
      facePatch(B, frame(m.x, 0, m.z, m.rot + Math.PI / 2), -m.d / 2, m.d / 2, 1.6, 1.9, -m.w / 2 - 0.02, C('#8a5a3a'));
    }
  }
  // airport taxiway line + hold-short bars on the apron
  {
    const B = get(330, 577).B;
    for (let x = 0; x < 660; x += 4) B.quad([x, 0.08, 577], [x, 0.08, 577.3], [x + 3, 0.08, 577.3], [x + 3, 0.08, 577], C('#e7c23a'));
  }
  yield;

  sec('shops');
  // ── walls, fences, gates ───────────────────────────────────────────────────────────────────────
  let wn = 0;
  for (const w of deco.walls) {
    if (++wn % 200 === 0) yield;
    const { B } = get(w.x, w.z);
    const col = C(w.color);
    const y0 = Math.min(H(w.x, w.z), 0);
    B.fx = w.fence ? FX.wood : FX.concrete;
    box(B, frame(w.x, y0, w.z, w.rot), w.w, w.h - y0, w.d, col, mul(col, 1.1));
    if (!low && !w.sound && !w.fence && !w.gate && w.w > 3) box(B, frame(w.x, 0, w.z, w.rot), w.w + 0.05, 0.1, w.d + 0.14, mul(col, 1.12), mul(col, 1.15), w.h);
    if (w.sound && !low) box(B, frame(w.x, 0, w.z, w.rot), w.w + 0.02, 0.18, w.d + 0.1, mul(col, 0.86), mul(col, 0.92), w.h);
    B.fx = 0;
    if (w.gate && !low) { // a wooden side gate in the middle of the wall, both faces
      B.fx = FX.wood;
      const gw = Math.min(1.2, w.w - 0.8);
      facePatch(B, frame(w.x, 0, w.z, w.rot), -gw / 2, gw / 2, 0.05, 1.75, -w.d / 2 - 0.02, C('#8a6a4a'));
      facePatch(B, frame(w.x, 0, w.z, w.rot + Math.PI), -gw / 2, gw / 2, 0.05, 1.75, -w.d / 2 - 0.02, C('#8a6a4a'));
      B.fx = 0;
    }
  }
  for (const r of deco.rocks) { const B = get(r.x, r.z).B; B.fx = FX.rock; blob(B, r.x, r.y - 0.3, r.z, r.w / 2, r.h, r.d / 2, mix(C('#c2b49a'), C('#8f8577'), rnd()), rnd, high ? 7 : 6); B.fx = 0; }
  if (!low) {
    // chaparral: chamise and scrub oak (dark), white sage (grey), buckwheat (rust), laurel sumac
    const SC = [C('#5f6c3f'), C('#6a7646'), C('#8c9474'), C('#9a6e4a'), C('#7d8a52'), C('#a39a63')];
    let sn = 0;
    for (const [x, z, s, t] of deco.scrub) {
      if (++sn % 300 === 0) yield;
      const y = H(x, z), B = get(x, z).B;
      B.fx = FX.foliage;
      bush(B, x, y - 0.15, z, s, s * 0.85, s * 0.9, SC[Math.floor(t * 6)], rnd, high ? 5 : 4);
      B.fx = 0;
    }
    const RE = [C('#a7a35a'), C('#8b9a4c'), C('#b9a868'), C('#7f8f46')];
    let rn = 0;
    for (const [x, z, h] of deco.reeds) {
      if (++rn % 300 === 0) yield;
      const y = H(x, z) - 0.05, B = get(x, z).B, col = RE[Math.floor(rnd() * 4)];
      B.fx = FX.foliage;
      for (let k = 0; k < 3; k++) { // a tuft of three leaning blades (two-sided)
        const a = rnd() * Math.PI, c = Math.cos(a) * 0.5, s2 = Math.sin(a) * 0.5, lx = (rnd() - 0.5) * 0.8, lz = (rnd() - 0.5) * 0.8;
        const p0 = [x - c, y, z - s2], p1 = [x + c, y, z + s2], tip = [x + lx, y + h * (0.7 + rnd() * 0.5), z + lz];
        B.tri(p0, tip, p1, col); B.tri(p1, tip, p0, mul(col, 0.85));
      }
      B.fx = 0;
    }
  }
  yield;

  sec('walls+scrub');
  // ── the San Diego River: low-flow channel, arundo cane, willow scrub, cobble bars ───────────────
  {
    const WET = C('#9c8a68');
    for (const run of deco.channel || []) {
      for (let i = 1; i < run.length; i++) {
        const [ax, az, aw] = run[i - 1], [bx, bz, bw] = run[i];
        const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        const B = get(ax, az).B;
        const ya = H(ax, az) + 0.05, yb = H(bx, bz) + 0.05;
        // damp sand margin, then the water
        B.fx = FX.sand;
        for (const sd of [-1, 1]) {
          const p0 = [ax + nx * sd * aw / 2, ya - 0.01, az + nz * sd * aw / 2], p1 = [ax + nx * sd * (aw / 2 + 1.4), ya - 0.02, az + nz * sd * (aw / 2 + 1.4)], p2 = [bx + nx * sd * (bw / 2 + 1.4), yb - 0.02, bz + nz * sd * (bw / 2 + 1.4)], p3 = [bx + nx * sd * bw / 2, yb - 0.01, bz + nz * sd * bw / 2];
          if (sd > 0) B.quad(p0, p1, p2, p3, WET); else B.quad(p1, p0, p3, p2, WET);
        }
        B.fx = FX.water;
        B.quad([ax - nx * aw / 2, ya, az - nz * aw / 2], [ax + nx * aw / 2, ya, az + nz * aw / 2], [bx + nx * bw / 2, yb, bz + nz * bw / 2], [bx - nx * bw / 2, yb, bz - nz * bw / 2], FX.water ? C('#6f8f8a') : C('#7fa3a8'));
        B.fx = 0;
      }
    }
    {
      const CANE = [C('#8f9a4e'), C('#a0a656'), C('#7d8c44')], PLUME = C('#d8ccb0');
      let an = 0;
      for (const [x, z, r, h] of deco.arundo || []) {
        if (++an % 200 === 0) yield;
        const y = H(x, z) - 0.05, B = get(x, z).B;
        B.fx = FX.foliage;
        const n = high ? 7 : low ? 3 : 5;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + rnd(), rr = r * (0.3 + rnd() * 0.7);
          const bx = x + Math.cos(a) * rr * 0.4, bz = z + Math.sin(a) * rr * 0.4, tx = x + Math.cos(a) * rr, tz = z + Math.sin(a) * rr, th = h * (0.7 + rnd() * 0.4);
          const px = -Math.sin(a) * 0.22, pz = Math.cos(a) * 0.22, col = CANE[k % 3];
          B.tri([bx - px, y, bz - pz], [tx, y + th, tz], [bx + px, y, bz + pz], col);
          B.tri([bx + px, y, bz + pz], [tx, y + th, tz], [bx - px, y, bz - pz], mul(col, 0.85));
          if (k === 0) { B.fx = FX.plain; B.tri([tx - px, y + th - 0.6, tz - pz], [tx, y + th + 0.25, tz], [tx + px, y + th - 0.6, tz + pz], PLUME); B.tri([tx + px, y + th - 0.6, tz + pz], [tx, y + th + 0.25, tz], [tx - px, y + th - 0.6, tz - pz], PLUME); B.fx = FX.foliage; }
        }
        B.fx = 0;
      }
    }
    if (!low) {
      const RIP = [C('#6f8f45'), C('#5f7f3c'), C('#7d9a50'), C('#8aa35a')];
      const Lr = polyLen(RIVER);
      for (let sd = 8; sd < Lr; sd += high ? 6 : 9) {
        const a = along(RIVER, sd);
        for (const side of [-1, 1]) {
          if (rnd() < 0.3) continue;
          const off = side * (RIVER_HALF + 1 + rnd() * 6);
          const x = a.x - a.tz * off, z = a.z + a.tx * off;
          if (L.roadGap(x, z, 20) < 3 || L.inWater(x, z)) continue;
          const sz = 1.4 + rnd() * 1.8, B = get(x, z).B;
          B.fx = FX.foliage; bush(B, x, H(x, z) - 0.15, z, sz, sz * (1.4 + rnd() * 0.8), sz, RIP[Math.floor(rnd() * 4)], rnd, 5); B.fx = 0;
        }
      }
      for (const [x, z, r] of deco.cobbles || []) {
        const B = get(x, z).B, y = H(x, z);
        B.fx = FX.rock;
        for (let k = 0; k < (high ? 6 : 4); k++) { const a = rnd() * Math.PI * 2, d = rnd() * r, s = 0.2 + rnd() * 0.35; blob(B, x + Math.cos(a) * d, y - 0.05, z + Math.sin(a) * d, s, s * 0.6, s * 0.8, mix(C('#b9b0a0'), C('#8c8478'), rnd()), rnd, 4); }
        B.fx = 0;
      }
    }
  }
  yield;

  sec('river');
  // ── medians (Mission Gorge Rd, Mast Blvd): kerbed island, DG and shrubs ─────────────────────────
  for (const m of deco.medians || []) {
    const hw = m.w / 2;
    for (let i = 1; i < m.pts.length; i++) {
      const [ax, az] = m.pts[i - 1], [bx, bz] = m.pts[i];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
      const B = get(ax, az).B;
      const ya = H(ax, az), yb = H(bx, bz);
      // taper the island ends to a point so it reads as a nose at each junction opening
      const ka = i === 1 ? 0.25 : 1, kb = i === m.pts.length - 1 ? 0.25 : 1;
      const A = (s, k) => [ax + nx * s * hw * ka * k, ya + 0.17, az + nz * s * hw * ka * k], Bq = (s, k) => [bx + nx * s * hw * kb * k, yb + 0.17, bz + nz * s * hw * kb * k];
      B.fx = FX.concrete;
      for (const s of [-1, 1]) {
        const a0 = [ax + nx * s * hw * ka, ya + 0.02, az + nz * s * hw * ka], b0 = [bx + nx * s * hw * kb, yb + 0.02, bz + nz * s * hw * kb];
        if (s > 0) B.quad(a0, b0, Bq(1, 1), A(1, 1), CONC); else B.quad(b0, a0, A(-1, 1), Bq(-1, 1), CONC);
      }
      B.fx = FX.dirt;
      B.quad(A(-1, 0.8), A(1, 0.8), Bq(1, 0.8), Bq(-1, 0.8), C('#c9b58c'));
      B.fx = FX.concrete;
      B.quad(A(-1, 1), A(-1, 0.8), Bq(-1, 0.8), Bq(-1, 1), CONC); B.quad(A(1, 0.8), A(1, 1), Bq(1, 1), Bq(1, 0.8), CONC);
      B.fx = FX.foliage;
      if (!low && i % 3 === 0) { const t = rnd(); bush(B, ax + dx * t, ya + 0.15, az + dz * t, hw * 0.55, 0.7 + rnd() * 0.5, hw * 0.55, [C('#6d8a46'), C('#8c9474'), C('#9a6e4a'), C('#7f9a52')][Math.floor(rnd() * 4)], rnd, 5); }
      B.fx = 0;
    }
  }
  yield;

  sec('medians');
  // parkway shrubs (rosemary, lantana, deer grass, agave) behind the arterial sidewalks
  if (!low) {
    const PK = [C('#6d8a46'), C('#8c9474'), C('#b9a04a'), C('#7f9a8a')];
    for (const [x, z, r, t] of deco.parkway || []) { const B = get(x, z).B; B.fx = FX.foliage; bush(B, x, Math.max(0, H(x, z)), z, r, r * (t === 2 ? 1.3 : 0.8), r, PK[t], rnd, 4); B.fx = 0; }
  }
  // ── power lines between the wooden utility poles ───────────────────────────────────────────────
  if (!low) {
    const WIRE = C('#2a2a2c');
    for (const [p, q2] of deco.wires || []) {
      const B = get(p.x, p.z).W;
      const ya = Math.max(0, H(p.x, p.z)) + p.h - 0.72, yb = Math.max(0, H(q2.x, q2.z)) + q2.h - 0.72;
      const span = Math.hypot(q2.x - p.x, q2.z - p.z), sag = Math.min(1.1, span * 0.018);
      for (const o of [-1.0, 0, 1.0]) {
        const ax = p.x + p.nx * o, az = p.z + p.nz * o, bx = q2.x + q2.nx * o, bz = q2.z + q2.nz * o;
        let prev = [ax, ya + (o === 0 ? 0.25 : 0), az];
        for (let k = 1; k <= 3; k++) {
          const t = k / 3, y = ya + (yb - ya) * t - sag * 4 * t * (1 - t) + (o === 0 ? 0.25 : 0);
          const cur = [ax + (bx - ax) * t, y, az + (bz - az) * t];
          ribbonV(B, prev, cur, 0.045, WIRE); prev = cur;
        }
      }
    }
  }

  sec('wires');
  // ── the trolley: rails, platform, red cars, viaduct over SR-52 ─────────────────────────────────
  {
    const tr = deco.trolley, rail = deco.rail;
    const RAILC = C('#5c5650'), BALLAST = C('#8f8578'), TIE = C('#6b5a48');
    for (let z = rail.z0; z < rail.z1; z += 20) {
      const za = z, zb = Math.min(z + 20, rail.z1);
      const onV = za >= tr.viaduct.z0 && zb <= tr.viaduct.z1;
      const y = onV ? tr.viaduct.y : 0.09;
      const B = get(rail.x, za + 1).B;
      B.fx = FX.dirt;
      B.quad([rail.x - 2.4, y, za], [rail.x - 2.4, y, zb], [rail.x + 2.4, y, zb], [rail.x + 2.4, y, za], BALLAST);
      B.fx = FX.wood;
      if (!low) for (let t = za; t < zb; t += 2.5) B.quad([rail.x - 1.3, y + 0.02, t], [rail.x - 1.3, y + 0.02, t + 0.5], [rail.x + 1.3, y + 0.02, t + 0.5], [rail.x + 1.3, y + 0.02, t], TIE);
      B.fx = 0;
      for (const rx of [-0.72, 0.72]) box(B, frame(rail.x + rx, y, (za + zb) / 2, 0), 0.14, 0.18, zb - za, RAILC, C('#9a948c'));
      if (onV) { B.fx = FX.concrete; box(B, frame(rail.x, y - 1.2, (za + zb) / 2, 0), 6, 1.2, zb - za, C('#cfc8bb'), null); B.fx = 0; }
    }
    // ramps up to the viaduct
    for (const [zA, zB] of [[tr.viaduct.z0 - 60, tr.viaduct.z0], [tr.viaduct.z1, tr.viaduct.z1 + 60]]) {
      const B = get(rail.x, zA).B;
      const up = zA < tr.viaduct.z0;
      const yA = up ? 0.1 : tr.viaduct.y, yB = up ? tr.viaduct.y : 0.1;
      B.fx = FX.concrete;
      B.quad([rail.x - 3, yA, zA], [rail.x - 3, yB, zB], [rail.x + 3, yB, zB], [rail.x + 3, yA, zA], C('#cfc8bb'));
      B.quad([rail.x - 3, 0, zA], [rail.x - 3, 0, zB], [rail.x - 3, yB, zB], [rail.x - 3, yA, zA], C('#bdb5a7'));
      B.quad([rail.x + 3, yA, zA], [rail.x + 3, yB, zB], [rail.x + 3, 0, zB], [rail.x + 3, 0, zA], C('#bdb5a7'));
      B.fx = 0;
    }
    for (const pz of [454, 508]) { const B = get(rail.x, pz).B; B.fx = FX.concrete; box(B, frame(rail.x, 0, pz, 0), 4, tr.viaduct.y - 1.2, 3, C('#bdb5a7'), null); B.fx = 0; }
    // platform with canopy
    const p = tr.platform;
    const { B, S } = get(p.x, p.z);
    B.fx = FX.concrete; box(B, frame(p.x, 0, p.z, 0), p.w, p.h, p.d, C('#d8d2c6'), C('#e9e4da')); B.fx = 0;
    box(B, frame(p.x - p.w / 2 + 0.2, p.h, p.z, 0), 0.25, 0.02, p.d, C('#f2c230'), C('#f2c230'));
    for (let z = p.z - p.d / 2 + 6; z < p.z + p.d / 2; z += 12) box(B, frame(p.x + 1.4, p.h, z, 0), 0.25, 3.4, 0.25, C('#c8102e'), null);
    B.fx = FX.metal; box(B, frame(p.x + 0.6, p.h + 3.4, p.z, 0), 4.4, 0.35, p.d - 8, C('#c8102e'), C('#e5e1d8')); B.fx = 0;
    shadow(p.x + 0.6, p.z, 4.4, p.d - 8, 0, p.h + 3.6);
    if (dark) for (let z = p.z - p.d / 2 + 12; z < p.z + p.d / 2; z += 24) lamp(p.x + 0.6, p.h + 3.2, z);
    sign(S, frame(p.x + 2.8, 0, p.z, Math.PI / 2), 0, p.h + 4.6, -0.05, 14, 'SANTEE TROLLEY SQUARE');
    sign(S, frame(p.x + 2.8, 0, p.z, -Math.PI / 2), 0, p.h + 4.6, -0.05, 14, 'SANTEE TROLLEY SQUARE');
    // the red LRVs (with their windows lit at night)
    for (const c of tr.cars) {
      const { B } = get(c.x, c.z);
      const F = frame(c.x, 0.5, c.z, 0);
      box(B, F, c.w, c.h - 0.5, c.d, C('#c8102e'), C('#d9d6cf'));
      B.fx = dark ? FX.glow : FX.glass; box(B, frame(c.x, 2.05, c.z, 0), c.w + 0.04, 1.1, c.d - 1.2, dark ? C('#ffe6b0') : C('#2c3440'), null); B.fx = 0;
      box(B, frame(c.x, 0.5, c.z, 0), c.w + 0.05, 0.35, c.d + 0.02, C('#e9e6df'), null);
      box(B, frame(c.x, c.h, c.z, 0), 1.4, 0.6, 2.6, C('#4a4d52'), null); // pantograph base
      B.tri([c.x - 0.6, c.h + 0.6, c.z - 0.8], [c.x, c.h + 1.8, c.z], [c.x + 0.6, c.h + 0.6, c.z + 0.8], C('#3a3c40'));
    }
    // overhead contact wire on its catenary
    for (let z = rail.z0 + 10; z < rail.z1 - 10; z += 40) {
      const y = (z > tr.viaduct.z0 - 30 && z < tr.viaduct.z1 + 30) ? tr.viaduct.y + 6 : 6.8;
      if (!low) { const B = get(rail.x, z).W; ribbonV(B, [rail.x, y, z], [rail.x, y, z + 40], 0.05, C('#2b2b2b')); ribbonV(B, [rail.x, y + 0.9, z], [rail.x, y + 0.6, z + 20], 0.04, C('#2b2b2b')); ribbonV(B, [rail.x, y + 0.6, z + 20], [rail.x, y + 0.9, z + 40], 0.04, C('#2b2b2b')); }
    }
  }

  // ── signs: pylons, gantries, monuments ──────────────────────────────────────────────────────────
  for (const p of deco.pylons || []) {
    const { B, S } = get(p.x, p.z);
    const F = frame(p.x, 0, p.z, p.rot + Math.PI);
    B.fx = FX.stucco; box(B, F, 0.8, 8.2, 0.8, C('#d8c3a0'), null);
    box(B, frame(p.x, 4.4, p.z, p.rot + Math.PI), 6.6, 3.6, 0.7, C('#e9dcc4'), C('#c8623e')); B.fx = 0;
    p.names.forEach((n, k) => { sign(S, F, 0, 7.3 - k * 1.05, -0.37, 6.2, n); sign(S, frame(p.x, 0, p.z, p.rot), 0, 7.3 - k * 1.05, -0.37, 6.2, n); });
    B.fx = FX.tile; gableRoof(B, frame(p.x, 0, p.z, p.rot), 7.0, 1.2, 8.0, 0.8, 0.1, C('#c0603c'), C('#e9dcc4'), false, FX.stucco); B.fx = 0;
    shadow(p.x, p.z, 6.6, 0.7, p.rot, 8);
  }
  for (const g of deco.gantries || []) {
    const { B, S } = get(g.x, g.z);
    const F = frame(g.x, 0, g.z, g.rot);
    B.fx = FX.metal;
    for (const sd of [-1, 1]) box(B, frame(...F(sd * g.span / 2, 0, 0), g.rot), 0.6, 7.6, 0.6, C('#8d9094'), C('#8d9094'));
    box(B, frame(...F(0, 6.4, 0), g.rot), g.span + 0.6, 0.5, 0.5, C('#8d9094'), C('#8d9094'));
    box(B, frame(...F(0, 7.0, 0), g.rot), g.span + 0.6, 0.12, 0.12, C('#8d9094'), C('#8d9094'));
    B.fx = 0;
    box(B, frame(...F(g.span / 4, 5.6, 0.3), g.rot), 9.4, 2.2, 0.2, C('#1b6e3a'), C('#1b6e3a'));
    sign(S, F, g.span / 4, 6.7, -0.02, 9, g.label);
  }
  for (const m of deco.monuments || []) {
    const { B, S } = get(m.x, m.z);
    const F = frame(m.x, 0, m.z, m.rot);
    B.fx = FX.stucco; box(B, F, 8, 2.0, 1.2, C(m.color), mul(C(m.color), 1.08));
    B.fx = FX.tile; box(B, frame(m.x, 2.0, m.z, m.rot), 8.4, 0.4, 1.4, C('#c0603c'), C('#c0603c')); B.fx = 0;
    sign(S, F, 0, 1.15, -0.62, 7.2, m.label);
    sign(S, frame(m.x, 0, m.z, m.rot + Math.PI), 0, 1.15, -0.62, 7.2, m.label);
    if (!low) { B.fx = FX.foliage; for (const sx of [-4.6, 4.6]) bush(B, ...F(sx, 0, -0.4), 0.9, 1.1, 0.7, C('#6f8a48'), rnd, 5); B.fx = 0; }
  }

  sec('trolley+signs');
  // ── chunk meshes ───────────────────────────────────────────────────────────────────────────────
  let mat;
  if (kit.toon) { try { mat = kit.toon(null, { vertexColors: true }); } catch (e) { mat = null; } }
  if (!mat) mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (!mat.vertexColors) { mat.vertexColors = true; mat.needsUpdate = true; }
  // wires: the engine's see-through toon (they dither away when the chase camera is right by them
  // instead of drawing a thick black bar); an engine without `see` gives the plain toon
  let wireMat = mat;
  if (kit.toon) { try { wireMat = kit.toon(null, { vertexColors: true, see: true }) || mat; } catch (e) { wireMat = mat; } }
  const atlas = makeAtlas(THREE);
  const signMat = atlas ? new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false }) : null;
  if (dark) { // dark mode is night: sink everything toward a cool moonlit dusk, keep the glows
    for (const c of chunks.values()) {
      for (const Bf of [c.B, c.W]) {
        const col = Bf.c, f = Bf.f;
        for (let v = 0, i = 0; i < col.length; i += 3, v++) {
          if (f[v] === 3) continue;
          col[i] = col[i] * 0.5 + 0.03; col[i + 1] = col[i + 1] * 0.53 + 0.04; col[i + 2] = col[i + 2] * 0.6 + 0.08;
        }
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
      c.B.p = c.B.c = c.B.f = null; // the arrays now live in the geometry
    }
    if (c.W.n) {
      const m = new THREE.Mesh(c.W.geometry(THREE), wireMat);
      m.name = `santee-wires-${c.i},${c.j}`; m.matrixAutoUpdate = false; m.updateMatrix();
      parent.add(m); tris += c.W.n; meshes++;
      c.W.p = c.W.c = c.W.f = null;
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
  root.userData.stats = { tris, meshes, chunks: chunks.size, sections: SEC };
  return root;
}

/** The home at 8524 Boulder Way: modern farmhouse with porch, house number, lit lamp, planters. */
function heroHouse(THREE, B, S, F, h, FX, lamp) {
  const fz = -h.d / 2;
  const roof = C('#33373c'), white = C('#f6f4ef'), black = C('#202226'), wood = C('#9a6a3e');
  const gs = h.garage, ox = -gs * 2.2;
  const gw = h.gw || Math.min(5.4, h.w * 0.45), gx = h.gx != null ? h.gx : gs * (h.w / 2 - gw / 2 - 0.6);
  // black-framed garage door with windows across the top
  facePatch(B, F, gx - gw / 2 - 0.15, gx + gw / 2 + 0.15, 0, 2.45, fz - 0.015, black);
  facePatch(B, F, gx - gw / 2, gx + gw / 2, 0, 2.3, fz - 0.02, C('#ecebe6'));
  for (let k = 0; k < 4; k++) { const x = gx - gw / 2 + (gw * (k + 0.5)) / 4; B.fx = FX.glass; facePatch(B, F, x - gw / 10, x + gw / 10, 1.8, 2.15, fz - 0.03, C('#5d6f84')); B.fx = 0; }
  // porch: slab, two posts, shed roof across the entry side
  const px0 = ox - 2.6, px1 = ox + 2.6;
  B.fx = FX.concrete; box(B, frame(...F((px0 + px1) / 2, 0, fz - 1.3), h.rot), px1 - px0, 0.25, 2.6, C('#cfc9bd'), C('#ddd7cb')); B.fx = FX.wood;
  for (const x of [px0 + 0.3, px1 - 0.3]) box(B, frame(...F(x, 0.25, fz - 2.4), h.rot), 0.28, 2.75, 0.28, wood, null);
  B.fx = FX.metal;
  const P = (lx, ly, lz) => F(lx, ly, lz);
  B.quad(P(px0 - 0.3, 3.0, fz - 2.8), P(px0 - 0.3, 3.5, fz), P(px1 + 0.3, 3.5, fz), P(px1 + 0.3, 3.0, fz - 2.8), roof);
  B.fx = 0;
  B.quad(P(px0 - 0.3, 2.99, fz - 2.8), P(px1 + 0.3, 2.99, fz - 2.8), P(px1 + 0.3, 3.49, fz), P(px0 - 0.3, 3.49, fz), C('#c9b9a0')); // wood soffit
  B.quad(P(px1 + 0.3, 2.85, fz - 2.8), P(px1 + 0.3, 3.0, fz - 2.8), P(px0 - 0.3, 3.0, fz - 2.8), P(px0 - 0.3, 2.85, fz - 2.8), black);
  // wood front door with black frame, windows with black frames and white mullions
  facePatch(B, F, ox - 0.65, ox + 0.65, 0.25, 2.45, fz - 0.03, black);
  B.fx = FX.wood; facePatch(B, F, ox - 0.5, ox + 0.5, 0.25, 2.3, fz - 0.04, wood); B.fx = 0;
  for (const [cx, y0, y1] of [[ox - gs * 2.0, 1.0, 2.3], [-h.w / 4, 3.95, 5.3], [h.w / 4, 3.95, 5.3]]) {
    facePatch(B, F, cx - 0.95, cx + 0.95, y0 - 0.1, y1 + 0.1, fz - 0.03, black);
    B.fx = B.night ? 3 : FX.glass;
    facePatch(B, F, cx - 0.8, cx + 0.8, y0, y1, fz - 0.04, B.night ? C('#ffd98a') : C('#7fa6c9'));
    B.fx = 0;
    facePatch(B, F, cx - 0.04, cx + 0.04, y0, y1, fz - 0.05, white);
  }
  facePatch(B, F, -h.w / 2, h.w / 2, 3.2, 3.32, fz - 0.035, black); // belly band
  // porch lamp (warm, and a real light pool at night so the cats are lit), house number plaque,
  // planters with lavender, welcome mat
  B.fx = 3;
  box(B, frame(...F(ox + 0.95, 1.9, fz - 0.12), h.rot), 0.22, 0.32, 0.18, C('#ffd27a'), C('#ffd27a'));
  B.fx = 0;
  const lp = F(ox + 0.95, 2.1, fz - 0.6);
  lamp(lp[0], lp[1], lp[2]);
  sign(S, frame(...F(0, 0, 0), h.rot), ox + 1.6, 1.75, fz - 0.06, 1.6, '8524');
  for (const x of [px0 + 0.6, px1 - 0.6]) { box(B, frame(...F(x, 0.25, fz - 2.15), h.rot), 0.6, 0.6, 0.6, C('#c26a3e'), null); B.fx = FX.foliage; box(B, frame(...F(x, 0.85, fz - 2.15), h.rot), 0.5, 0.35, 0.5, C('#8a6fc2'), C('#9c82d2')); B.fx = 0; }
  box(B, frame(...F(ox, 0.26, fz - 0.6), h.rot), 1.1, 0.02, 0.6, C('#6b4a3a'), C('#6b4a3a'));
  // walkway from the porch to the driveway, a low hedge along the lawn, the front lawn
  B.fx = FX.concrete; box(B, frame(...F(ox, 0, fz - 4.2), h.rot), 1.2, 0.06, 3.0, C('#d9d3c7'), C('#d9d3c7'));
  B.fx = FX.foliage; box(B, frame(...F(-gs * (h.w / 2 - 0.4), 0, fz - 3.5), h.rot), 0.7, 0.7, 4.5, C('#5f8a46'), C('#6f9a52'));
  B.fx = FX.grass;
  const sb = (h.setback || 6.5) - 0.4, lx0 = -gs * (h.w / 2), lx1 = gx - gs * (gw / 2 + 0.5);
  const a = F(lx0, 0.045, fz - 0.05), b = F(lx1, 0.045, fz - 0.05), c = F(lx1, 0.045, fz - sb), d = F(lx0, 0.045, fz - sb);
  if (gs > 0) B.quad(a, b, c, d, C('#8fb562')); else B.quad(a, d, c, b, C('#8fb562'));
  B.fx = 0;
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

