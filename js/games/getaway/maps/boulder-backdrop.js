// Boulder for Getaway: the fog-free backdrop. The Front Range at its true (scaled ×0.45)
// positions and heights, so from anywhere in town the skyline sits on its real bearings and
// at its real angles: Mt Sanitas (NW), Flagstaff Mountain (W), Green Mountain with the
// Flatirons on its east face (SW), Bear Peak and South Boulder Peak (SSW); the snowy Indian
// Peaks far to the west-north-west; and the plains running off flat to the east.
// Summits as researched for the Blend & Seek CU map: Green Mountain 39.9822, −105.3019,
// 2482 m; First Flatiron 39.99014, −105.29469; Bear Peak 39.96025, −105.29517; Flagstaff
// 40.00165, −105.30749. Others: South Boulder Peak 39.9542, −105.2990, 2556 m; Mt Sanitas
// 40.0300, −105.3060, 2069 m; Second / Third Flatiron 39.9876, −105.2930 / 39.9848, −105.2916.
import { P, S, BOUNDS, rawHeight } from './boulder-data.js';
import { layout, height, isFarMtn } from './boulder-layout.js';

const CITY = 1655; // metres: downtown's elevation (map y = 0)
const up = (m) => (m - CITY) * S;
export const PEAKS = [
  { name: 'Green Mountain', lat: 39.9822, lon: -105.3019, elev: 2482, r: 520 },
  { name: 'Bear Peak', lat: 39.96025, lon: -105.29517, elev: 2559, r: 420 },
  { name: 'South Boulder Peak', lat: 39.9542, lon: -105.2990, elev: 2556, r: 480 },
  { name: 'Flagstaff Mountain', lat: 40.00165, lon: -105.30749, elev: 2093, r: 380 },
  { name: 'Mt Sanitas', lat: 40.0300, lon: -105.3060, elev: 2069, r: 330 },
].map((p) => { const [x, z] = P(p.lat, p.lon); return { ...p, x, z, h: up(p.elev) }; });
export const FLATIRONS = [
  // name, top lat/lon, top elev, base elev, width (real m)
  ['First Flatiron', 39.99014, -105.29469, 2290, 1840, 330],
  ['Second Flatiron', 39.9876, -105.2930, 2160, 1800, 260],
  ['Third Flatiron', 39.9848, -105.2916, 2195, 1780, 280],
  ['Fourth Flatiron', 39.9808, -105.2905, 2150, 1790, 260],
  ['Fifth Flatiron', 39.9775, -105.2905, 2100, 1800, 220],
].map(([name, lat, lon, top, base, wid]) => { const [x, z] = P(lat, lon); return { name, x, z, top: up(top), base: up(base), w: wid * S }; });

const sstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function hash(x, z) { let n = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
/** Backdrop terrain height: the in-town relief (capped) plus the summits. */
export function rangeHeight(x, z) {
  let h = Math.min(rawHeight(x, z), 230);
  for (const p of PEAKS) {
    const d = Math.hypot(x - p.x, z - p.z) / p.r;
    if (d < 1.6) h = Math.max(h, p.h * (1 - sstep(d / 1.6)) ** 1.15 + Math.min(rawHeight(x, z), 230) * 0.35);
  }
  return h;
}

export function buildBackdrop(THREE, kit = {}) {
  const root = new THREE.Group(); root.name = 'boulder-backdrop';
  let mat = null;
  if (typeof kit.toon === 'function') { try { mat = kit.toon(null, { vertexColors: true, fog: false }); } catch (e) { mat = null; } }
  if (!mat) mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.fog = false; mat.vertexColors = true; mat.needsUpdate = true;
  const pos = []; const col = []; const nrm = [];
  const C = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const tri = (a, b, c, ca, cb = ca, cc = ca) => {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2]; const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    if (ny < 0) { const t = b; b = c; c = t; const tc = cb; cb = cc; cc = tc; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const [p, q] of [[a, ca], [b, cb], [c, cc]]) { pos.push(p[0], p[1], p[2]); col.push(q[0], q[1], q[2]); nrm.push(nx / l, ny / l, nz / l); }
  };
  const triRaw = (a, b, c, ca, n) => { for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); col.push(ca[0], ca[1], ca[2]); nrm.push(n[0], n[1], n[2]); } };

  // the ring of land outside the in-town terrain: low-poly (flat-shaded) mountains to the
  // west, prairie and fields to the east, out to ~7 km
  const inner = { x0: BOUNDS.x0 - 32, z0: BOUNDS.z0 - 32, x1: BOUNDS.x1 + 32, z1: BOUNDS.z1 + 32 };
  const forest = C('#4f6f4a'); const forestL = C('#6f8a55'); const meadow = C('#a9ab68'); const rock = C('#9b7a66'); const plain = C('#c8bd86'); const plainG = C('#a9b673'); const snow = C('#f2f1ec');
  const colAt = (x, z, h) => {
    if (h < 6) { const n = hash(Math.floor(x / 420), Math.floor(z / 420)); return n < 0.33 ? plainG : n < 0.66 ? plain : C('#b7b47a'); }
    const n = hash(Math.floor(x / 90), Math.floor(z / 90));
    if (h > 260 && n < 0.5) return rock;
    return h < 30 ? meadow : n < 0.6 ? forest : forestL;
  };
  const xs = []; for (let x = -4200; x <= 7800; x += x < -900 || x > 2100 ? 240 : 60) xs.push(x);
  const zs = []; for (let z = -5600; z <= 6600; z += z < -700 || z > 2000 ? 240 : 60) zs.push(z);
  const inIn = (x, z) => x > inner.x0 && x < inner.x1 && z > inner.z0 && z < inner.z1;
  const Hh = (x, z) => (inIn(x, z) ? height(x, z) - 0.4 : rangeHeight(x, z) - 0.6);
  const hs = zs.map((z) => xs.map((x) => Hh(x, z)));
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i]; const xb = xs[i + 1]; const za = zs[j]; const zb = zs[j + 1];
    if (xa >= inner.x0 && xb <= inner.x1 && za >= inner.z0 && zb <= inner.z1 && !isFarMtn((xa + xb) / 2 + 30, (za + zb) / 2)) continue; // the town terrain covers this
    const p00 = [xa, hs[j][i], za]; const p10 = [xb, hs[j][i + 1], za]; const p01 = [xa, hs[j + 1][i], zb]; const p11 = [xb, hs[j + 1][i + 1], zb];
    const cA = colAt((xa + xb) / 2, (za + zb) / 2, (p00[1] + p10[1] + p11[1]) / 3); const cB = colAt((xa + xb) / 2 + 1, (za + zb) / 2 + 1, (p00[1] + p11[1] + p01[1]) / 3);
    tri(p00, p11, p10, cA); tri(p00, p01, p11, cB);
  }

  // the foothill forest on the far flank (one cone each; fog-free so the hills read crisp)
  for (const d of layout().decor) {
    if (!d.far) continue;
    const s = d.s; const g = d.c < 0.5 ? forest : C('#3f5f42'); const h = 7.5 * s; const r = 2.6 * s; const y = d.y - 0.5;
    for (let i = 0; i < 5; i++) {
      const a0 = i / 5 * Math.PI * 2 + d.c * 6; const a1 = (i + 1) / 5 * Math.PI * 2 + d.c * 6;
      const p0 = [d.x + Math.cos(a0) * r, y, d.z + Math.sin(a0) * r]; const p1 = [d.x + Math.cos(a1) * r, y, d.z + Math.sin(a1) * r];
      const am = (a0 + a1) / 2; triRaw(p1, p0, [d.x, y + h, d.z], i % 2 ? g : [g[0] * 0.85, g[1] * 0.85, g[2] * 0.85], [Math.cos(am), 0.5, Math.sin(am)]);
    }
  }
  // the Flatirons: tilted slabs of pink Fountain sandstone, steep faces to the east
  const face = C('#d9937a'); const faceD = C('#c27c66'); const edge = C('#8c5446');
  for (const f of FLATIRONS) {
    const hgt = f.top - f.base; const lean = hgt * 0.62; // ~58° dip
    const bx = f.x + lean; // the toe sits east of the summit
    const half = f.w / 2;
    const toeN = [bx, f.base, f.z - half]; const toeS = [bx + half * 0.05, f.base, f.z + half];
    const top = [f.x, f.top, f.z + half * 0.12]; const shoulder = [f.x + lean * 0.45, f.base + hgt * 0.55, f.z - half * 0.62];
    const nE = [0.85, 0.5, 0];
    triRaw(toeN, toeS, shoulder, face, nE); triRaw(shoulder, toeS, top, faceD, nE);
    const back = [f.x - lean * 0.35, f.base + hgt * 0.4, f.z];
    triRaw(toeN, shoulder, back, edge, [0, 0.2, -1]); triRaw(shoulder, top, back, edge, [0, 0.4, -1]); triRaw(top, toeS, back, edge, [0, 0.2, 1]);
    // the base of the slab sits in forest (talus skirt)
    triRaw([bx - 20, f.base + 6, f.z - half - 25], [bx + 26, f.base - 4, f.z - half - 10], [bx + 26, f.base - 4, f.z + half + 10], forest, [0.3, 1, 0]);
    triRaw([bx - 20, f.base + 6, f.z - half - 25], [bx + 26, f.base - 4, f.z + half + 10], [bx - 20, f.base + 6, f.z + half + 25], forestL, [0.3, 1, 0]);
  }
  // the Indian Peaks: a snowy far ridge to the west-north-west (true bearing ~275–315°, ~30 km)
  {
    const R = 10500; const pts = [];
    for (let b = 262; b <= 322; b += 3) { const el = 3.2 + 1.6 * Math.abs(Math.sin(b * 1.7)) + (b > 285 && b < 300 ? 1.2 : 0); pts.push([b, el]); }
    for (let k = 0; k < pts.length - 1; k++) {
      const [b0, e0] = pts[k]; const [b1, e1] = pts[k + 1];
      const d = (bb) => [Math.sin(bb * Math.PI / 180), -Math.cos(bb * Math.PI / 180)];
      const [x0, z0] = d(b0); const [x1, z1] = d(b1);
      const h0 = R * Math.tan(e0 * Math.PI / 180); const h1 = R * Math.tan(e1 * Math.PI / 180);
      const a = [x0 * R, -20, z0 * R]; const b2 = [x1 * R, -20, z1 * R]; const c = [x1 * R, h1, z1 * R]; const dd = [x0 * R, h0, z0 * R];
      const n = [-(x0 + x1) / 2, 0, -(z0 + z1) / 2];
      triRaw(a, b2, c, C('#7b8a9a'), n); triRaw(a, c, dd, C('#7b8a9a'), n);
      const sn0 = [x0 * R, h0 * 0.72, z0 * R]; const sn1 = [x1 * R, h1 * 0.72, z1 * R];
      triRaw(sn0, sn1, c, snow, n); triRaw(sn0, c, dd, snow, n);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, mat); m.name = 'boulder-range'; m.frustumCulled = false;
  root.add(m);
  root.userData.stats = { tris: pos.length / 9 };
  return root;
}
