// GREENHOUSE AND GARDEN SHED — 20 × 16 m.
//
//   back ───────────────────────────────────────────────────────────────
//   │ GREENHOUSE (glass, ridge 5.2 m)            │ side │ SHED (pegboard,  │
//   │  catwalk along the back wall at 2.2 m      │ yard │  loft at 1.6 m)  │
//   │  staging benches · palms · hanging baskets │      │                  │
//   │  potting bench (striped)                   │ cold frames, logs       │
//   ├──── doors ──────────── GARDEN: veg beds, rose arch, scarecrow, pots ─┤
//   front (low picket fence)
//
// Loops: two greenhouse doors to the garden + a side door to the yard; the shed opens on the yard
// and the garden. Verticality: the catwalk (stairs up the left end), the roof framing (purlins to
// perch on), hanging baskets, trellises, the shed loft and the rose arch.
import { boxGeo, cylGeo, sphereGeo } from '../geo.js';
import { P } from '../atlas.js';
import { seeded } from '../util.js';
import { Q } from './patterns.js';
import { F, aabb, wall, floor, slab, stairs, railing, shelves, stack } from './lib.js';

const W = 20; const D = 16; const X0 = -10; const X1 = 10; const Z0 = -8; const Z1 = 8;
// greenhouse footprint
const GX0 = -9.6; const GX1 = 2.4; const GZ0 = -7.8; const GZ1 = 2.2; const EAVE = 3.0; const RIDGE = 5.2; const RZ = (GZ0 + GZ1) / 2;
const CAT = 2.2; // catwalk height
// shed footprint
const SX0 = 4.8; const SX1 = 9.6; const SZ0 = -7.8; const SZ1 = -2.6; const SH = 2.5; const LOFT = 1.6;

const C = {
  ink: '#2a2730', white: '#f8f5ee', cream: '#f3e7cf', frame: '#eef3f1',
  leaf: '#3f7d4a', leafL: '#6aa84f', leafD: '#2c5e3a', lime: '#b5d94a', olive: '#8a8f3c', moss: '#5f8a4c',
  terracotta: '#c8693f', clay: '#d9875a', red: '#e2493b', pink: '#ef7fa8', coral: '#e07a5f', orange: '#f28c38', yellow: '#f2c14e', purple: '#7d5bc4', lilac: '#b9a3d9', blue: '#3f6fd1', sky: '#8fb3c9', teal: '#2f8f8f',
  wood: '#a8754d', woodD: '#6b4430', shed: '#5f8fa0', brick: '#b8563f', steel: '#9aa7ad',
};

function build(atlas) {
  atlas.add('lawn', P.lawn({ a: '#8cbf63', b: '#7bb156', fleck: '#a9d47e' }), { size: 'L' });
  atlas.add('leafy', P.leafy({ base: C.leaf, light: C.leafL, dark: C.leafD, n: 60 }), { size: 'L' });
  atlas.add('blooms', P.blooms({ bg: '#7a5236', leaf: '#4f7d3c', cols: [C.red, C.yellow, C.pink, C.purple, C.white], n: 34 }), { size: 'L' });
  atlas.add('glass', Q.glass({ tint: '#cfe8e4', sheen: 'rgba(255,255,255,0.6)', frame: '#f4f7f6', n: 2 }), { size: 'L' });
  atlas.add('seeds', Q.products({ cols: [C.red, C.yellow, C.purple, C.orange, C.lime, C.pink, C.blue], rows: 1, bg: '#7a4e35' }), { w: 240, h: 64 });
  atlas.add('gravel', P.soil({ base: '#cbc2b2', speck: '#a89c88', stone: '#e4ddcf' }), { size: 'M' });
  atlas.add('soil', P.soil({ base: '#6b4a32', speck: '#4f3523', stone: '#8a7258' }), { size: 'M' });
  atlas.add('bricks', P.bricks({ brick: '#b8563f', alt: '#a14a36', mortar: '#e3d6c3', rows: 8, cols: 4 }), { size: 'M' });
  atlas.add('tiles', P.checker({ a: '#c8693f', b: '#e8b48f', n: 4, grout: '#f3e7cf' }), { size: 'M' });
  atlas.add('planksV', P.stripes({ cols: ['#ffffff', '#e2e2e2', '#f2f2f2', '#d6d6d6'], widths: [6, 0.5, 6, 0.5], n: 3 }), { size: 'M' });
  atlas.add('pegboard', P.dots({ bg: '#d8b48a', fg: '#7a5a3a', n: 6, r: 0.12 }), { size: 'M' });
  atlas.add('oilcloth', P.stripes({ cols: [C.red, C.white, C.yellow, C.white], widths: [3, 1, 2, 1], n: 2 }), { size: 'M' });
  atlas.add('lattice', Q.lattice({ bg: '#4f8a4a', fg: '#f4efe6', n: 3, lw: 0.16 }), { size: 'M' });
  atlas.add('vine', Q.floral({ bg: '#4f8a4a', cols: [C.pink, C.red, '#ffffff'], leaf: '#2c5e3a', n: 14 }), { size: 'M' });
  atlas.add('plaid', Q.plaid({ bg: '#c8463b', a: '#2f3f6d', b: '#f2c14e' }), { size: 'M' });
  atlas.add('wood', P.wood({ n: 6 }), { size: 'M' });
  atlas.add('slats', Q.slats({ n: 5 }), { size: 'M' });
  atlas.add('flag', P.flag({ base: '#c9bcab', dark: '#8f8273', light: '#d8ccbc' }), { size: 'M', repeat: false });
  atlas.add('stripeCush', P.stripes({ cols: [C.blue, C.white], n: 3 }), { size: 'M' });
  atlas.add('gingham', P.check({ a: C.white, b: C.teal, n: 4 }), { size: 'M' });
  atlas.add('cabbage', Q.scales({ a: '#8fc46a', b: '#a9d47e', line: '#4f8a3c' }), { size: 'M' });
  atlas.add('water', P.dots({ bg: '#6fb2c9', fg: '#8cc7d9', n: 3, r: 0.22 }), { size: 'M' });
  atlas.add('signPlants', Q.sign({ bg: C.cream, fg: C.leafD, text: 'GLASSHOUSE', sub: 'please shut the door' }), { w: 240, h: 80, repeat: false });
  atlas.add('rings', P.rings({ n: 3 }), { size: 'S' });
  atlas.add('bark', P.bands({ cols: ['#ffffff', '#cfcfcf', '#e8e8e8'], widths: [3, 1, 2], n: 5 }), { size: 'S' });
  atlas.add('label', P.label({ bg: '#ffffff', band: C.teal, text: C.ink }), { size: 'S', repeat: false });

  return function* fill(b) {
    const r = seeded('greenhouse');
    yield 'ground plinth boundary';
    // ── ground, plinth, boundary ──
    b.add(boxGeo(W + 0.6, 0.3, D + 0.6, { faces: ['py'] }), { at: [0, -0.15, 0], tile: 'lawn', rep: 1.6, color: '#ffffff', outline: false });
    b.add(boxGeo(W + 0.9, 0.5, D + 0.9, { round: 0.05 }), { at: [0, -0.28, 0], color: '#6b4a32' });
    b.add(boxGeo(W + 0.95, 0.08, D + 0.95, { round: 0.03 }), { at: [0, -0.05, 0], color: '#7bb156' });
    yield 'back';
    // back: a tall brick garden wall; sides + front: picket fence
    aabb(b, X0 - 0.2, 0, Z0 - 0.25, X1 + 0.2, 2.2, Z0, { tile: 'bricks', rep: 0.8, color: '#ffffff', outline: true, collide: { wall: true, name: 'back' } });
    aabb(b, X0 - 0.22, 2.2, Z0 - 0.27, X1 + 0.22, 2.28, Z0 + 0.02, { color: '#8a3e2e', outline: true });
    const fenceH = 1.05;
    const pick = (x, z, yaw) => b.add(boxGeo(0.09, fenceH, 0.025, { faces: ['px', 'nx', 'pz', 'nz'] }), { at: [x, fenceH / 2, z], yaw, color: C.white, tile: 'wood', rep: 0.5 });
    const fence = (x0, z0, x1, z1, yaw) => {
      const L = Math.hypot(x1 - x0, z1 - z0); const n = Math.floor(L / 0.16);
      for (let i = 0; i <= n; i++) { const t = i / n; pick(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, yaw); }
      for (const y of [0.25, 0.8]) b.add(boxGeo(L, 0.07, 0.03), { at: [(x0 + x1) / 2, y, (z0 + z1) / 2], yaw, color: C.white, outline: false });
    };
    fence(X0, Z0, X0, Z1, Math.PI / 2); fence(X1, Z0, X1, Z1, Math.PI / 2);
    fence(X0, Z1, -1.0, Z1, 0); fence(1.0, Z1, X1, Z1, 0);
    b.collide(X0 - 0.3, 0, Z0, X0 + 0.03, fenceH, Z1, { wall: true, name: 'left' });
    b.collide(X1 - 0.03, 0, Z0, X1 + 0.3, fenceH, Z1, { wall: true, name: 'right' });
    b.collide(X0, 0, Z1 - 0.03, X1, fenceH, Z1 + 0.3, { wall: true, name: 'front' });
    b.collide(X0 - 0.3, fenceH, Z0, X0 + 0.03, 8, Z1 + 0.3, { wall: false, climb: false, name: 'guard-left' });
    b.collide(X1 - 0.03, fenceH, Z0, X1 + 0.3, 8, Z1 + 0.3, { wall: false, climb: false, name: 'guard-right' });
    b.collide(X0, fenceH, Z1 - 0.03, X1, 8, Z1 + 0.3, { wall: false, climb: false, name: 'guard-front' });
    b.collide(X0, 0, Z1 - 0.03, X1, 8, Z1 + 0.3, { wall: false, climb: false, name: 'guard-gate' });
    b.collide(X0 - 0.2, 2.28, Z0 - 0.3, X1 + 0.2, 8, Z0 + 0.02, { wall: false, climb: false, name: 'guard-back' });
    yield 'gate arch';
    // gate arch
    for (const x of [-1.05, 1.05]) aabb(b, x - 0.06, 0, Z1 - 0.06, x + 0.06, 1.7, Z1 + 0.06, { color: C.woodD, outline: true });
    aabb(b, -1.15, 1.7, Z1 - 0.08, 1.15, 1.82, Z1 + 0.08, { color: C.woodD, outline: true });

    yield 'greenhouse';
    // ── GREENHOUSE ──
    floor(b, GX0, GZ0, GX1, GZ1, 0, { tile: 'tiles', rep: 0.9 });
    floor(b, GX0 + 0.5, RZ - 0.8, GX1 - 0.5, RZ + 0.8, 0.006, { tile: 'gravel', rep: 1.0 });
    const knee = 0.5;
    const glassSide = { tile: 'glass', rep: 1.2, color: '#ffffff' };
    const brickSide = { tile: 'bricks', rep: 0.8, color: '#ffffff' };
    yield 'knee walls';
    // knee walls (all four sides) with door gaps on the front (garden) and right (yard)
    wall(b, { x0: GX0, z0: GZ1, x1: GX1, z1: GZ1, h: knee, t: 0.2, both: brickSide, cap: '#e9e3d8', open: [{ c: -6.2, w: 1.3, top: 2.4 }, { c: -0.6, w: 1.3, top: 2.4 }], name: 'gh-front' });
    wall(b, { x0: GX1, z0: GZ0, x1: GX1, z1: GZ1, h: knee, t: 0.2, both: brickSide, cap: '#e9e3d8', open: [{ c: -1.0, w: 1.3, top: 2.4 }], name: 'gh-right' });
    wall(b, { x0: GX0, z0: GZ0, x1: GX0, z1: GZ1, h: knee, t: 0.2, both: brickSide, cap: '#e9e3d8', name: 'gh-left' });
    yield 'glazing';
    // glazing: back + left + right walls up to the eaves (glass: not climbable); front left open (cutaway)
    aabb(b, GX0, knee, GZ0 + 0.02, GX1, EAVE, GZ0 + 0.06, { ...glassSide, faces: ['pz', 'nz'], outline: false, collide: { wall: true, climb: false, name: 'glass-back' } });
    aabb(b, GX0 - 0.03, knee, GZ0, GX0 + 0.01, EAVE, GZ1, { ...glassSide, faces: ['px', 'nx'], outline: false, collide: { wall: true, climb: false, name: 'glass-left' } });
    for (const [z0, z1] of [[GZ0, -1.65], [-0.35, GZ1]]) aabb(b, GX1 - 0.02, knee, z0, GX1 + 0.02, EAVE, z1, { ...glassSide, faces: ['px', 'nx'], outline: false, collide: { wall: true, climb: false, name: 'glass-right' } });
    aabb(b, GX1 - 0.02, 2.4, -1.65, GX1 + 0.02, EAVE, -0.35, { ...glassSide, faces: ['px', 'nx'], outline: false, collide: { wall: true, climb: false, ceil: true, name: 'glass-over-door' } });
    yield 'white frame';
    // white frame: posts every 1.5 m on all sides, eave beams, rafters to the ridge, purlins
    const post = (x, z) => aabb(b, x - 0.05, knee, z - 0.05, x + 0.05, EAVE, z + 0.05, { color: C.frame, outline: true, collide: { wall: true, perch: true, name: 'perch:post' } });
    for (let x = GX0; x <= GX1 + 0.01; x += 1.5) { if (Math.abs(x + 8.1) > 0.1) post(x, GZ0 + 0.04); if (!(x > -7 && x < -5.4) && !(x > -1.4 && x < 0.2)) post(x, GZ1); }
    for (let z = GZ0 + 1.25; z < GZ1; z += 1.25) { post(GX0, z); if (!(z > -1.7 && z < -0.3)) post(GX1, z); }
    for (const z of [GZ0 + 0.04, GZ1]) aabb(b, GX0 - 0.06, EAVE - 0.06, z - 0.07, GX1 + 0.06, EAVE + 0.06, z + 0.07, { color: C.frame, outline: true, collide: { wall: false, perch: true, name: 'perch:eave' } });
    for (const x of [GX0, GX1]) aabb(b, x - 0.07, EAVE - 0.06, GZ0, x + 0.07, EAVE + 0.06, GZ1, { color: C.frame, outline: true });
    const half = (GZ1 - GZ0) / 2; const rise = RIDGE - EAVE; const ang = Math.atan2(rise, half); const rl = Math.hypot(half, rise);
    for (let x = GX0; x <= GX1 + 0.01; x += 1.5) {
      for (const s of [-1, 1]) b.add(boxGeo(0.08, 0.1, rl), { at: [x, EAVE + rise / 2, RZ + s * half / 2], rot: [s * ang, 0, 0], color: C.frame });
      // gable ends: a vertical king post
      if (x === GX0 || x > GX1 - 0.1) aabb(b, x - 0.05, EAVE, RZ - 0.05, x + 0.05, RIDGE, RZ + 0.05, { color: C.frame, outline: true });
    }
    aabb(b, GX0, RIDGE - 0.08, RZ - 0.08, GX1, RIDGE + 0.06, RZ + 0.08, { color: C.frame, outline: true, collide: { wall: false, perch: true, name: 'perch:ridge' } });
    yield 'purlins';
    // purlins (perches) on both slopes at 1/3 and 2/3
    for (const s of [-1, 1]) for (const k of [0.36, 0.7]) {
      const z = RZ + s * half * (1 - k); const y = EAVE + rise * k;
      aabb(b, GX0, y - 0.05, z - 0.05, GX1, y + 0.05, z + 0.05, { color: C.frame, outline: true, collide: { wall: false, perch: true, name: 'perch:purlin' } });
    }
    yield 'roof glass';
    // roof glass: undersides only (the camera sees in from above), back slope only
    b.add(boxGeo(GX1 - GX0, 0.02, rl, { faces: ['ny'] }), { at: [(GX0 + GX1) / 2, EAVE + rise / 2 + 0.06, RZ - half / 2], rot: [-ang, 0, 0], tile: 'glass', rep: 1.4, color: '#ffffff', outline: false });
    b.collide(GX0, EAVE + 0.1, GZ0, GX1, RIDGE + 0.1, RZ - 0.1, { wall: false, ceil: true, climb: false, name: 'ceil:roof-glass' });
    b.collide(GX0, RIDGE + 0.1, GZ0, GX1, RIDGE + 3, GZ1, { wall: false, climb: false, name: 'roof-guard' });
    yield 'sign over the';
    // sign over the main door
    b.add(boxGeo(1.9, 0.62, 0.04, { fit: true, faces: ['pz'] }), { at: [-3.4, 2.62, GZ1 + 0.05], tile: 'signPlants', rep: 1, color: '#ffffff', outline: false });
    aabb(b, -4.38, 2.3, GZ1 + 0.02, -2.42, 2.94, GZ1 + 0.05, { color: C.leafD, outline: true, collide: { wall: true, perch: true, name: 'perch:sign' } });

    yield 'catwalk along the';
    // catwalk along the back glazing, stairs up the left end
    const cw0 = -8.2; const cw1 = 2.3; const cz0 = GZ0 + 0.08; const cz1 = cz0 + 1.4;
    aabb(b, cw0, CAT - 0.08, cz0, cw1, CAT, cz1, { color: '#8a969c', tile: 'gravel', rep: 0.4, outline: true, collide: { wall: false, ceil: true, name: 'ceil:catwalk' } });
    railing(b, cw0, cz1, cw1, cz1, CAT, { color: C.steel, top: C.teal, gap: 0.22, name: 'catwalk' });
    railing(b, cw1 - 0.02, cz0, cw1 - 0.02, cz1, CAT, { color: C.steel, top: C.teal, name: 'catwalk-end' });
    for (const x of [-6, -3, 0]) aabb(b, x - 0.05, 0, cz1 - 0.08, x + 0.05, CAT - 0.08, cz1 + 0.02, { color: C.steel, outline: true, collide: { wall: true, perch: true, name: 'perch:catwalk-leg' } });
    stairs(b, { x: cw0 - 0.72, z: cz0 + 13 * 0.25 + 0.0, dir: 'z-', width: 1.05, n: 13, rise: CAT / 13, run: 0.25, tread: { color: '#8a969c', tile: 'gravel', rep: 0.3 }, stringer: C.steel, railSide: 1, rail: C.teal, name: 'cat-stairs' });
    aabb(b, cw0 - 1.3, CAT - 0.08, cz0, cw0, CAT, cz0 + 0.3, { color: '#8a969c', outline: true, collide: { wall: false, name: 'cat-landing' } });

    yield 'staging benches under';
    // staging benches under the catwalk (3 tiers) with pots, and along the front
    const pots = (x0, x1, y, z, seed, dz = 0) => {
      const rr = seeded(seed);
      for (let x = x0; x < x1 - 0.2; x += 0.34 + rr() * 0.1) {
        if (rr() < 0.18) continue; // gaps to hide in
        const s = 0.75 + rr() * 0.5; const pz = z + (rr() - 0.5) * dz;
        b.add(cylGeo(0.12 * s, 0.09 * s, 0.2 * s, { radial: 10 }), { at: [x, y + 0.1 * s, pz], color: rr() < 0.7 ? C.terracotta : [C.teal, C.yellow, C.pink][rr.int(3)], tile: 'rings', rep: [0.3, 0.2 * s] });
        const kind = rr.int(4);
        if (kind === 0) b.add(sphereGeo(0.13 * s, 0.11 * s, 0.13 * s, { w: 8, h: 6 }), { at: [x, y + 0.27 * s, pz], color: [C.leaf, C.moss, C.leafL][rr.int(3)] });
        else if (kind === 1) { b.add(cylGeo(0.05 * s, 0.06 * s, 0.25 * s, { radial: 8 }), { at: [x, y + 0.32 * s, pz], color: C.moss }); b.add(sphereGeo(0.05, 0.04, 0.05, { w: 6, h: 4 }), { at: [x, y + 0.47 * s, pz], color: C.pink, outline: false }); }
        else if (kind === 2) for (let k = 0; k < 3; k++) b.add(sphereGeo(0.03 * s, 0.025, 0.12 * s, { w: 6, h: 4 }), { at: [x + Math.cos(k * 2.1) * 0.05, y + 0.28 * s, pz + Math.sin(k * 2.1) * 0.05], rot: [-0.7, k * 2.1, 0], color: C.leafL, outline: false });
        else b.add(sphereGeo(0.1 * s, 0.08 * s, 0.1 * s, { w: 8, h: 5 }), { at: [x, y + 0.25 * s, pz], color: [C.red, C.yellow, C.purple, C.orange][rr.int(4)] });
      }
    };
    const staging = (x0, x1, z0, z1, tiers, seed) => {
      const zc = (z0 + z1) / 2; const dz = z1 - z0;
      tiers.forEach(([y, back], i) => {
        const za = back ? z0 : z0 + dz * i * 0.33; const zb = back ? z0 + dz * 0.4 : z1;
        aabb(b, x0, y - 0.04, za, x1, y, zb, { color: C.wood, tile: 'slats', rep: [0.6, 0.3], outline: true, collide: { wall: false, ceil: true, name: 'staging' } });
        pots(x0 + 0.2, x1, y, (za + zb) / 2, seed + i, (zb - za) * 0.5);
      });
      for (const x of [x0 + 0.05, (x0 + x1) / 2, x1 - 0.05]) for (const z of [z0 + 0.05, z1 - 0.05]) aabb(b, x - 0.03, 0, z - 0.03, x + 0.03, tiers[0][0], z + 0.03, { color: C.woodD, outline: false });
      b.blob((x0 + x1) / 2, zc, (x1 - x0) * 0.55, dz * 0.6, { a: 0.2 });
    };
    staging(-6.2, -0.4, GZ0 + 0.2, GZ0 + 1.1, [[0.8, false]], 'stA');
    staging(-6.2, -0.4, GZ1 - 1.1, GZ1 - 0.25, [[0.85, false]], 'stB');
    yield 'tiered fern stand';
    // tiered fern stand at the left end
    const fs = F(b, GX0 + 0.6, -0.8, Math.PI / 2);
    for (let i = 0; i < 3; i++) { fs.box(1.6, 0.04, 0.32, [0, 0.45 + i * 0.45, -0.1 + i * 0.12], { color: C.white, collide: { wall: false, ceil: true, name: 'fern-stand' } }); }
    for (const sx of [-0.78, 0.78]) fs.box(0.04, 1.4, 0.04, [sx, 0.7, 0.1], { color: C.white, rot: [-0.25, 0, 0] });
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) {
      const [px, pz] = fs.W(-0.5 + k * 0.5, -0.1 + i * 0.12);
      b.add(cylGeo(0.1, 0.08, 0.16, { radial: 10 }), { at: [px, 0.55 + i * 0.45, pz], color: C.terracotta, tile: 'rings', rep: [0.3, 0.16] });
      for (let q = 0; q < 5; q++) b.add(sphereGeo(0.03, 0.02, 0.18, { w: 6, h: 4 }), { at: [px + Math.cos(q * 1.26) * 0.08, 0.7 + i * 0.45, pz + Math.sin(q * 1.26) * 0.08], rot: [-0.9, q * 1.26, 0], color: q % 2 ? C.leafL : C.moss, outline: false });
    }
    fs.blob(0, 0, 0.9, 0.35);

    yield 'central bed with';
    // central bed with the big plants (landmarks): palm, banana, monstera, cactus
    aabb(b, -5.2, 0, RZ - 0.55, -1.8, 0.35, RZ + 0.55, { color: '#ffffff', tile: 'bricks', rep: 0.6, outline: true, collide: { wall: true, name: 'bed-wall' } });
    aabb(b, -5.1, 0.35, RZ - 0.45, -1.9, 0.38, RZ + 0.45, { color: '#ffffff', tile: 'soil', rep: 0.6, outline: false });
    b.collide(-5.1, 0, RZ - 0.45, -1.9, 0.38, RZ + 0.45, { wall: false, name: 'bed-soil' });
    palm(b, -4.4, RZ, 0.38, 3.9, 'palm1');
    banana(b, -2.6, RZ + 0.1, 0.38, 'ban1');
    monstera(b, -3.5, RZ - 0.2, 0.38, 'mon1');
    yield 'potted cactus';
    // potted cactus + big pots elsewhere
    cactus(b, 1.6, 1.4, 'cac1');
    bigPot(b, -8.8, 1.4, 1.2, 'p1', C.terracotta); bigPot(b, 1.6, -6.4, 1.4, 'p2', C.teal);
    palm(b, -7.3, -5.4, 0, 3.4, 'palm2', true);
    yield 'hanging baskets on';
    // hanging baskets on the purlins
    for (const [x, z, col] of [[-7.5, RZ - 1.5, C.pink], [-4.5, RZ + 1.5, C.purple], [-1.5, RZ - 1.5, C.yellow], [1.2, RZ + 1.5, C.red], [-6.2, RZ + 1.5, C.orange]]) {
      const s2 = Math.sign(z - RZ); const yh = EAVE + rise * 0.36; const zp = RZ + s2 * half * 0.64;
      b.add(cylGeo(0.006, 0.006, yh - 2.05, { radial: 4, caps: false }), { at: [x, (yh + 2.05) / 2, zp], color: C.ink, outline: false });
      b.add(sphereGeo(0.3, 0.2, 0.3, { w: 10, h: 6, thetaMax: Math.PI / 2 }), { at: [x, 1.85, zp], rot: [Math.PI, 0, 0], color: '#8a5a3c', tile: 'slats', rep: 0.2, collide: { wall: true, name: 'basket' } });
      b.add(sphereGeo(0.32, 0.16, 0.32, { w: 10, h: 6 }), { at: [x, 1.9, zp], color: '#ffffff', tile: 'vine', rep: 0.3 });
      for (let k = 0; k < 6; k++) b.add(sphereGeo(0.06, 0.05, 0.06, { w: 6, h: 4 }), { at: [x + Math.cos(k) * 0.3, 1.78 - (k % 3) * 0.12, zp + Math.sin(k) * 0.3], color: k % 2 ? col : C.leafL, outline: false });
    }
    yield 'trellis panels with';
    // trellis panels with climbing vines (cling to them)
    for (const [x, z] of [[-9.2, -4.6], [-9.2, -2.2]]) {
      const tf = F(b, x, z, Math.PI / 2);
      tf.box(1.6, 2.2, 0.05, [0, 1.15, 0], { color: C.white, tile: 'lattice', rep: 0.6, collide: { wall: true, name: 'trellis' } });
      tf.box(1.7, 0.06, 0.08, [0, 2.27, 0], { color: C.white });
      for (let k = 0; k < 9; k++) tf.sph(0.16 + r() * 0.08, 0.14, 0.06, [-0.6 + r() * 1.2, 0.3 + k * 0.22, 0.05], { color: '#ffffff', tile: 'vine', rep: 0.25, w: 8, h: 5 });
    }
    yield 'striped potting bench';
    // striped potting bench (right end, by the yard door)
    const pb = F(b, 1.5, -3.6, -Math.PI / 2);
    pb.box(2.0, 0.06, 0.8, [0, 0.9, 0], { color: '#ffffff', tile: 'oilcloth', rep: 0.5, collide: { wall: false, ceil: true, name: 'potting-bench' } });
    pb.box(2.0, 0.6, 0.05, [0, 1.2, -0.38], { color: C.wood, tile: 'wood', rep: 0.5, collide: { wall: true, name: 'bench-back' } });
    pb.box(2.0, 0.04, 0.25, [0, 1.45, -0.25], { color: C.wood, collide: { wall: false, perch: true, name: 'perch:bench-shelf' } });
    pb.box(1.9, 0.04, 0.7, [0, 0.3, 0], { color: C.wood, tile: 'slats', rep: 0.4, collide: { wall: false, ceil: true, name: 'bench-low' } });
    for (const [sx, sz] of [[-0.95, -0.35], [0.95, -0.35], [-0.95, 0.35], [0.95, 0.35]]) pb.box(0.06, 0.88, 0.06, [sx, 0.44, sz], { color: C.woodD });
    for (let i = 0; i < 5; i++) pb.cyl(0.08, 0.06, 0.12, [-0.7 + i * 0.25, 1.53, -0.25], { color: [C.terracotta, C.teal, C.terracotta, C.yellow, C.terracotta][i] });
    pb.box(0.5, 0.25, 0.35, [0.5, 1.06, 0.1], { color: C.clay, collide: true }); // soil tray
    pb.box(0.46, 0.02, 0.31, [0.5, 1.19, 0.1], { color: '#ffffff', tile: 'soil', rep: 0.4, outline: false });
    pb.box(0.6, 0.3, 0.02, [-0.4, 1.25, -0.34], { color: '#ffffff', tile: 'seeds', rep: [0.6, 0.15] });
    for (let i = 0; i < 4; i++) pb.cyl(0.14, 0.11, 0.2, [-0.6 + i * 0.32, 0.42, 0.05], { color: C.terracotta, tile: 'rings', rep: [0.3, 0.2] });
    pb.blob(0, 0, 1.2, 0.5);
    yield 'watering cans';
    // watering cans + a hose reel
    for (const [x, z, col] of [[-0.3, 1.5, C.teal], [-7.4, -1.6, C.yellow]]) {
      const wc = F(b, x, z, 0.6);
      wc.cyl(0.14, 0.16, 0.3, [0, 0.15, 0], { color: col, collide: true });
      wc.cyl(0.02, 0.025, 0.4, [0.22, 0.25, 0], { color: col, rot: [0, 0, -0.9] });
      wc.blob(0, 0, 0.2, 0.2);
    }

    yield 'side yard';
    // ── SIDE YARD (x 2.4…10, z −2.6…2.2): cold frames, log pile, wheelbarrow ──
    floor(b, GX1 + 0.1, -2.6, X1, GZ1, 0, { tile: 'gravel', rep: 1.2 });
    for (const [x, z] of [[4.2, 1.2], [6.2, 1.2]]) {
      const cf = F(b, x, z);
      cf.box(1.6, 0.4, 0.9, [0, 0.2, 0], { color: C.wood, tile: 'slats', rep: 0.3, collide: { wall: true, name: 'cold-frame' } });
      cf.box(1.6, 0.03, 0.95, [0, 0.47, 0.0], { color: '#ffffff', tile: 'glass', rep: 0.8, rot: [0.15, 0, 0], collide: { wall: false, climb: false, name: 'cold-frame-lid' } });
      for (let i = 0; i < 4; i++) cf.sph(0.12, 0.08, 0.12, [-0.55 + i * 0.36, 0.42, 0], { color: C.leafL, w: 8, h: 5, outline: false });
      cf.blob(0, 0, 0.95, 0.55);
    }
    for (let i = 0; i < 6; i++) {
      const row = i < 3 ? 0 : i < 5 ? 1 : 2; const k = i < 3 ? i : i < 5 ? i - 3 : 0;
      b.add(cylGeo(0.14, 0.14, 1.0, { radial: 10 }), { at: [9.4, 0.14 + row * 0.25, -1.9 + k * 0.29 + row * 0.145], rot: [Math.PI / 2, 0, 0], color: '#a87c55', tile: 'bark', rep: 0.3, collide: { wall: true, name: 'logs' } });
    }
    b.blob(9.4, -1.6, 0.4, 0.6);
    const wb = F(b, 7.8, -0.6, 2.2);
    wb.box(0.7, 0.3, 0.95, [0, 0.42, 0], { color: C.red, round: 0.06, collide: { wall: true, name: 'wheelbarrow' } });
    wb.box(0.6, 0.05, 0.8, [0, 0.58, 0], { color: '#ffffff', tile: 'soil', rep: 0.5, outline: false });
    wb.cyl(0.15, 0.15, 0.06, [0, 0.15, 0.55], { color: C.ink, rot: [0, 0, Math.PI / 2] });
    for (const sx of [-1, 1]) wb.box(0.04, 0.04, 0.8, [sx * 0.3, 0.3, -0.6], { color: C.woodD, rot: [0.25, 0, 0] });
    wb.blob(0, 0, 0.5, 0.6);

    yield 'shed';
    // ── SHED ──
    floor(b, SX0, SZ0, SX1, SZ1, 0, { tile: 'wood', rep: 0.8, color: '#c99a6b' });
    const shedOut = { tile: 'planksV', rep: 0.9, color: C.shed }; const shedIn = { tile: 'planksV', rep: 0.9, color: '#e8d6b8' };
    wall(b, { x0: SX0, z0: SZ1, x1: SX1, z1: SZ1, h: SH, t: 0.12, n: shedIn, p: shedOut, trim: C.white, open: [{ c: 6.0, w: 1.1, top: 2.0 }, { c: 8.4, w: 0.9, bottom: 1.0, top: 1.7 }], name: 'shed-front' });
    wall(b, { x0: SX0, z0: SZ0, x1: SX0, z1: SZ1, h: SH, t: 0.12, n: shedOut, p: shedIn, trim: C.white, open: [{ c: -5.0, w: 1.0, top: 2.0 }], name: 'shed-left' });
    wall(b, { x0: SX1, z0: SZ0, x1: SX1, z1: SZ1, h: SH, t: 0.12, n: shedIn, p: shedOut, name: 'shed-right' });
    yield 'pegboard back wall';
    // pegboard back wall (the brick garden wall behind) with tools
    aabb(b, SX0 + 0.1, 0.9, Z0 + 0.0, SX1 - 0.1, 2.2, Z0 + 0.04, { tile: 'pegboard', rep: 0.6, color: '#ffffff', outline: true, collide: { wall: true, name: 'pegboard' } });
    const tools = [[5.3, 1.6, 0.06, 0.9, C.red], [5.7, 1.5, 0.3, 0.12, C.yellow], [6.1, 1.65, 0.05, 1.0, C.woodD], [6.5, 1.4, 0.25, 0.35, C.steel], [6.9, 1.7, 0.4, 0.06, C.blue], [7.4, 1.55, 0.05, 0.8, C.teal], [7.8, 1.6, 0.3, 0.3, C.orange], [8.3, 1.45, 0.06, 0.7, C.red], [8.8, 1.65, 0.35, 0.1, C.purple], [9.2, 1.5, 0.12, 0.5, C.yellow]];
    for (const [x, y, w2, h2, col] of tools) aabb(b, x - w2 / 2, y - h2 / 2, Z0 + 0.04, x + w2 / 2, y + h2 / 2, Z0 + 0.08, { color: col, outline: true });
    yield 'workbench';
    // workbench
    const wk = F(b, 7.2, Z0 + 0.45);
    wk.box(3.2, 0.07, 0.75, [0, 0.9, 0], { color: C.wood, tile: 'wood', rep: 0.6, collide: { wall: false, ceil: true, name: 'workbench' } });
    for (const sx of [-1.5, 1.5]) wk.box(0.08, 0.88, 0.7, [sx, 0.44, 0], { color: C.woodD, collide: { wall: true, name: 'workbench-leg' } });
    wk.box(3.0, 0.04, 0.6, [0, 0.25, 0], { color: C.woodD, collide: { wall: false, ceil: true, name: 'workbench-low' } });
    wk.box(0.2, 0.15, 0.2, [1.2, 1.01, 0.2], { color: C.blue });
    for (let i = 0; i < 4; i++) wk.cyl(0.07, 0.07, 0.16, [-1.2 + i * 0.22, 1.02, 0.1], { color: '#ffffff', tile: 'label', rep: [1, 0.16], fit: false });
    wk.box(0.6, 0.25, 0.02, [0.2, 1.06, 0.25], { color: '#ffffff', tile: 'seeds', rep: [0.6, 0.12] });
    stack(F(b, 6.0, Z0 + 0.45), 0, 0.0, [[0.35, 0.12, 0.35, C.terracotta], [0.3, 0.12, 0.3, C.terracotta], [0.26, 0.12, 0.26, C.clay]], { collide: false });
    wk.blob(0, 0, 1.8, 0.5);
    yield 'loft over the';
    // loft over the back half (y 1.6) reached by a little stair
    slab(b, SX0 + 0.06, SZ0, 6.8, -5.6, LOFT, { thick: 0.1, under: { color: '#d8c4a0' }, edge: C.woodD, name: 'ceil:loft' });
    floor(b, SX0 + 0.06, SZ0, 6.8, -5.6, LOFT, { tile: 'wood', rep: 0.6, color: '#d2a46a' });
    railing(b, SX0 + 0.06, -5.6, 5.95, -5.6, LOFT, { h: 0.7, color: C.woodD, top: C.wood, name: 'loft' });
    stairs(b, { x: 6.4, z: -5.6 + 8 * 0.24, dir: 'z-', width: 0.75, n: 8, rise: LOFT / 8, run: 0.24, tread: { color: C.wood }, stringer: C.woodD, name: 'loft-stairs' });
    for (const [x, z, col] of [[5.3, -7.4, C.red], [5.9, -7.2, C.teal], [5.3, -6.6, C.yellow]]) aabb(b, x - 0.22, LOFT, z - 0.22, x + 0.22, LOFT + 0.35, z + 0.22, { color: col, tile: 'slats', rep: 0.3, outline: true, collide: { wall: true, name: 'loft-box' } });
    yield 'the rolled-up deck';
    // the rolled-up deck chair lies by the railing (maps pass: at the back, with the boxes, it
    // walled off a Tiny-sized pocket nobody could see into from a metre away)
    b.add(cylGeo(0.25, 0.25, 0.7, { radial: 12 }), { at: [5.4, LOFT + 0.25, -5.95], rot: [0, 0, Math.PI / 2], color: '#ffffff', tile: 'gingham', rep: 0.3, collide: { wall: true, name: 'deckchair-roll' } });
    yield 'shelves on the';
    // shelves on the right wall: paint tins, pots, seed packets
    const ss = F(b, SX1 - 0.3, -4.4, -Math.PI / 2);
    shelves(ss, 2.4, 1.9, 0.4, 4, { color: C.wood, tile: null, name: 'shed-shelf' });
    for (let lv = 0; lv < 3; lv++) for (let i = 0; i < 5; i++) if (!(lv === 1 && i === 2)) {
      if (lv === 2) ss.box(0.3, 0.14, 0.04, [-0.9 + i * 0.45, 0.04 + lv * 0.62 + 0.25, 0.1], { color: '#ffffff', tile: 'seeds', rep: [0.6, 0.14], uvOff: [i * 0.3, 0], rot: [-0.2, 0, 0] });
      else ss.cyl(0.11, 0.11, 0.2, [-0.9 + i * 0.45, 0.04 + lv * 0.62 + 0.1, 0.0], { color: [C.red, C.blue, C.yellow, C.teal, C.pink][(i + lv) % 5] });
    }
    yield 'shed lid';
    // shed lid (underside only) + guard; a simple dark roof edge
    slab(b, SX0 - 0.06, SZ0, SX1 + 0.06, SZ1 + 0.06, SH + 0.12, { thick: 0.12, lid: true, under: { color: '#cdb48c', tile: 'planksV', rep: 1.0 }, name: 'ceil:shed' });
    aabb(b, SX0 - 0.2, SH + 0.1, SZ1 + 0.05, SX1 + 0.2, SH + 0.24, SZ1 + 0.25, { color: '#3a2f2a', outline: true });
    yield 'flower pots stacked';
    // flower pots stacked by the door + a garden gnome
    stack(F(b, 5.2, -2.1), 0, 0, [[0.5, 0.3, 0.5, C.terracotta, 'rings'], [0.42, 0.28, 0.42, C.terracotta, 'rings'], [0.34, 0.26, 0.34, C.clay, 'rings']]);
    gnome(b, 4.4, -2.0);

    yield 'garden';
    // ── GARDEN (front): veg beds, rose arch, scarecrow, bench, compost, water butt ──
    floor(b, -1.0, GZ1, 1.0, Z1, 0, { tile: 'gravel', rep: 1.0 });
    floor(b, -7.2, GZ1, -5.2, 3.2, 0, { tile: 'gravel', rep: 1.0 });
    floor(b, -7.2, 3.2, 1.0, 4.4, 0, { tile: 'gravel', rep: 1.0 });
    const veg = (x, z, w, d, kind) => {
      aabb(b, x - w / 2, 0, z - d / 2, x + w / 2, 0.36, z + d / 2, { color: C.wood, tile: 'slats', rep: 0.3, outline: true, collide: { wall: true, name: 'veg-bed' } });
      aabb(b, x - w / 2 + 0.06, 0.36, z - d / 2 + 0.06, x + w / 2 - 0.06, 0.37, z + d / 2 - 0.06, { color: '#ffffff', tile: 'soil', rep: 0.5, outline: false });
      for (let i = 0; i < Math.floor(w / 0.45); i++) for (let j = 0; j < Math.floor(d / 0.45); j++) {
        const px = x - w / 2 + 0.3 + i * 0.45; const pz = z - d / 2 + 0.3 + j * 0.45;
        if (kind === 'cabbage') b.add(sphereGeo(0.16, 0.13, 0.16, { w: 8, h: 6 }), { at: [px, 0.47, pz], color: '#ffffff', tile: 'cabbage', rep: 0.2 });
        else if (kind === 'carrot') for (let k = 0; k < 3; k++) b.add(sphereGeo(0.02, 0.12, 0.04, { w: 5, h: 4 }), { at: [px + (k - 1) * 0.04, 0.48, pz], rot: [0, k, (k - 1) * 0.3], color: C.leafL, outline: false });
        else { b.add(cylGeo(0.01, 0.01, 0.8, { radial: 4 }), { at: [px, 0.77, pz], color: C.woodD, outline: false }); b.add(sphereGeo(0.07, 0.07, 0.07, { w: 6, h: 5 }), { at: [px + 0.05, 0.75, pz], color: C.red }); b.add(sphereGeo(0.12, 0.15, 0.12, { w: 6, h: 5 }), { at: [px, 0.62, pz], color: C.moss, outline: false }); }
      }
      b.blob(x, z, w * 0.55, d * 0.6, { a: 0.18 });
    };
    veg(-8.2, 5.4, 2.4, 1.2, 'cabbage'); veg(-4.4, 5.4, 2.4, 1.2, 'carrot'); veg(-4.4, 7.0, 2.4, 0.7, 'tomato');
    veg(3.0, 6.6, 2.6, 1.0, 'tomato');
    yield 'rose arch over';
    // rose arch over the path (trellis sides, perch on the top)
    for (const x of [-0.95, 0.95]) {
      aabb(b, x - 0.04, 0, 3.2, x + 0.04, 2.2, 3.8, { color: C.white, tile: 'lattice', rep: 0.5, outline: true, collide: { wall: true, name: 'arch-side' } });
      for (let k = 0; k < 6; k++) b.add(sphereGeo(0.14, 0.14, 0.14, { w: 8, h: 5 }), { at: [x + (r() - 0.5) * 0.2, 0.4 + k * 0.33, 3.3 + r() * 0.4], color: '#ffffff', tile: 'vine', rep: 0.25 });
    }
    b.add(cylGeo(1.0, 1.0, 0.6, { radial: 16, open: true, caps: false }), { at: [0, 2.2, 3.5], rot: [Math.PI / 2, 0, 0], color: C.white, outline: true });
    b.collide(-1.0, 2.2, 3.2, 1.0, 2.35, 3.8, { wall: false, perch: true, name: 'perch:arch' });
    for (let k = 0; k < 7; k++) { const a = (k / 6) * Math.PI; b.add(sphereGeo(0.13, 0.13, 0.13, { w: 8, h: 5 }), { at: [Math.cos(a) * 0.98, 2.2 + Math.sin(a) * 0.98, 3.4 + (k % 2) * 0.2], color: k % 2 ? C.pink : C.red }); }
    yield 'scarecrow';
    // scarecrow (plaid shirt) — the garden's landmark
    const sc = F(b, -6.4, 6.2, 0.3);
    sc.cyl(0.04, 0.04, 2.0, [0, 1.0, 0], { color: C.woodD, radial: 6, collide: { wall: false, perch: true, name: 'perch:scarecrow' } });
    sc.box(1.5, 0.05, 0.05, [0, 1.45, 0], { color: C.woodD, collide: { wall: false, perch: true, name: 'perch:scarecrow-arms' } });
    sc.box(0.55, 0.65, 0.22, [0, 1.25, 0], { color: '#ffffff', tile: 'plaid', rep: 0.35, round: 0.05 });
    for (const sx of [-1, 1]) sc.box(0.4, 0.16, 0.16, [sx * 0.45, 1.45, 0], { color: '#ffffff', tile: 'plaid', rep: 0.35 });
    sc.box(0.4, 0.5, 0.18, [0, 0.72, 0], { color: C.blue, round: 0.04 });
    sc.sph(0.17, 0.19, 0.17, [0, 1.75, 0], { color: '#e8c98f' });
    sc.cyl(0.32, 0.32, 0.03, [0, 1.92, 0], { color: '#c9a24a' }); sc.cyl(0.14, 0.17, 0.2, [0, 2.02, 0], { color: '#c9a24a' });
    sc.blob(0, 0, 0.4, 0.3);
    yield 'bench';
    // bench + cushions
    const bn = F(b, 5.4, 4.2, Math.PI);
    bn.box(1.6, 0.06, 0.5, [0, 0.45, 0], { color: C.teal, tile: 'slats', rep: 0.3, collide: { wall: false, ceil: true, name: 'bench' } });
    bn.box(1.6, 0.5, 0.06, [0, 0.75, -0.24], { color: C.teal, tile: 'slats', rep: 0.3, collide: { wall: true, name: 'bench-back' } });
    for (const sx of [-0.75, 0.75]) bn.box(0.06, 0.45, 0.45, [sx, 0.22, 0], { color: '#1f5f5f' });
    bn.box(0.5, 0.42, 0.12, [-0.45, 0.68, -0.15], { color: '#ffffff', tile: 'stripeCush', rep: 0.4, rot: [-0.2, 0, 0], round: 0.04 });
    bn.box(0.45, 0.1, 0.42, [0.4, 0.53, 0], { color: '#ffffff', tile: 'gingham', rep: 0.3, round: 0.03 });
    bn.blob(0, 0, 0.9, 0.35);
    yield 'compost bin water';
    // compost bin, water butt, bird house, pot stack, flower bed along the greenhouse
    const cb = F(b, 8.6, 6.8);
    cb.box(1.1, 0.9, 1.0, [0, 0.45, 0], { color: '#8a6a44', tile: 'slats', rep: [0.4, 0.2], collide: { wall: true, name: 'compost' } });
    cb.blob(0, 0, 0.7, 0.6);
    const butt = F(b, 3.1, 2.8);
    butt.cyl(0.36, 0.33, 0.95, [0, 0.475, 0], { color: C.leafD, collide: true, radial: 14 });
    butt.cyl(0.3, 0.3, 0.02, [0, 0.96, 0], { color: '#ffffff', tile: 'water', rep: 0.3, outline: false });
    butt.blob(0, 0, 0.42, 0.42);
    const bh = F(b, 8.2, 3.2);
    bh.cyl(0.04, 0.04, 1.8, [0, 0.9, 0], { color: C.woodD, radial: 6, collide: { wall: false, perch: true, name: 'perch:birdhouse-pole' } });
    bh.box(0.3, 0.32, 0.3, [0, 1.95, 0], { color: C.yellow, collide: { wall: true, name: 'birdhouse' } });
    bh.box(0.38, 0.06, 0.4, [0, 2.14, 0], { color: C.red, rot: [0, 0, 0.3] }); bh.box(0.38, 0.06, 0.4, [0, 2.14, 0], { color: C.red, rot: [0, 0, -0.3] });
    bh.cyl(0.05, 0.05, 0.02, [0, 1.98, 0.155], { color: C.ink, rot: [Math.PI / 2, 0, 0] });
    bh.blob(0, 0, 0.25, 0.25);
    aabb(b, -9.5, 0, GZ1 + 0.3, -7.4, 0.24, GZ1 + 1.1, { color: '#ffffff', tile: 'blooms', rep: 0.8, outline: true, collide: { wall: false, name: 'flower-bed' } });
    aabb(b, 1.6, 0, GZ1 + 0.3, 2.4, 0.24, GZ1 + 1.6, { color: '#ffffff', tile: 'blooms', rep: 0.8, outline: true, collide: { wall: false, name: 'flower-bed' } });
    yield 'stepping stones in';
    // stepping stones in the lawn
    [[-3.0, 5.8], [-2.2, 6.6], [-1.6, 7.3], [5.8, 5.6], [6.6, 6.4]].forEach(([x, z], i) => b.add(cylGeo(0.3, 0.32, 0.04, { radial: 10, fit: true }), { at: [x, 0.02, z], yaw: i, tile: 'flag', rep: 1, color: '#ffffff' }));

    yield 'spots';
    // ── spots ──
    b.spot('lobby', { x: -0.3, z: 6.0 });
    b.spot('hiderSpawn', { x: -3.4, z: -1.4, yaw: 0 });
    b.spot('seekerSpawn', { x: 0, z: 7.0, yaw: Math.PI });
    b.spot('spawnA', { x: -2.8, z: 6.4, yaw: Math.PI });
    b.spot('spawnB', { x: 6.0, z: 0.0, yaw: Math.PI });
    b.spot('hiderSpawns', [{ x: -3.4, z: -1.4, yaw: 0 }, { x: 6.0, z: -0.2, yaw: Math.PI }, { x: -2.0, z: GZ0 + 0.7, y: CAT, yaw: 0 }, { x: 7.6, z: -4.6, yaw: Math.PI }]);
    b.spot('seekerSpawns', [{ x: 0, z: 7.0, yaw: Math.PI }, { x: -2.4, z: 4.0, yaw: Math.PI }, { x: 6.8, z: 5.6, yaw: Math.PI }]);
    b.spot('camo', { x: -3.0, z: Z0 + 0.3, y: 0.45, wallNormal: [0, 0, 1], note: 'the glazing at the back of the greenhouse' });
    b.spot('rug', { x: -0.3, z: 6.0, yaw: 0 });
    b.probe('watering-can-teal', [-0.3, 0.301, 1.5], [0, 1, 0], C.teal);
  };
}

function palm(b, x, z, y0, h, seed, potted = false) {
  const r = seeded(seed);
  if (potted) { b.add(cylGeo(0.4, 0.32, 0.55, { radial: 14 }), { at: [x, 0.275, z], color: C.terracotta, tile: 'rings', rep: [0.4, 0.55], collide: { wall: true, name: 'big-pot' } }); y0 = 0.55; b.blob(x, z, 0.45, 0.45); }
  const segs = 7;
  for (let i = 0; i < segs; i++) b.add(cylGeo(0.1 - i * 0.006, 0.12 - i * 0.006, h / segs, { radial: 8 }), { at: [x + Math.sin(i * 0.3) * 0.04, y0 + (i + 0.5) * h / segs, z], color: i % 2 ? '#a87c55' : '#8f6a48' });
  b.collide(x - 0.1, y0, z - 0.1, x + 0.1, y0 + h, z + 0.1, { wall: true, perch: true, name: 'perch:palm-trunk' });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + r() * 0.3; const L = 0.9 + r() * 0.4;
    b.add(sphereGeo(0.16, 0.02, L * 0.6, { w: 8, h: 4 }), { at: [x + Math.sin(a) * L * 0.5, y0 + h - 0.1 - r() * 0.2, z + Math.cos(a) * L * 0.5], rot: [0.45 + r() * 0.3, a, 0], color: k % 2 ? C.leaf : C.leafL });
  }
  b.add(sphereGeo(0.14, 0.1, 0.14, { w: 8, h: 5 }), { at: [x, y0 + h, z], color: C.moss });
}
function banana(b, x, z, y0, seed) {
  const r = seeded(seed);
  b.add(cylGeo(0.07, 0.1, 1.4, { radial: 8 }), { at: [x, y0 + 0.7, z], color: '#7f9a4a', collide: { wall: true, perch: true, name: 'perch:banana' } });
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + r() * 0.3;
    b.add(sphereGeo(0.24, 0.02, 0.55, { w: 8, h: 4 }), { at: [x + Math.sin(a) * 0.4, y0 + 1.3 + r() * 0.4, z + Math.cos(a) * 0.4], rot: [0.6 + r() * 0.4, a, 0], color: k % 2 ? C.lime : C.leafL });
  }
}
function monstera(b, x, z, y0, seed) {
  const r = seeded(seed);
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9 + r() * 0.3; const L = 0.4 + r() * 0.35;
    b.add(cylGeo(0.012, 0.012, L + 0.2, { radial: 4, caps: false }), { at: [x + Math.sin(a) * L * 0.4, y0 + (L + 0.2) / 2, z + Math.cos(a) * L * 0.4], rot: [Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5], color: C.moss, outline: false });
    b.add(sphereGeo(0.24, 0.02, 0.22, { w: 8, h: 4 }), { at: [x + Math.sin(a) * L, y0 + L + 0.15, z + Math.cos(a) * L], rot: [0.5, a, 0], color: k % 2 ? C.leafD : C.leaf });
  }
}
function cactus(b, x, z, seed) {
  void seed;
  b.add(cylGeo(0.3, 0.25, 0.45, { radial: 12 }), { at: [x, 0.225, z], color: C.yellow, tile: 'rings', rep: [0.4, 0.45], collide: { wall: true, name: 'cactus-pot' } });
  b.add(cylGeo(0.14, 0.15, 1.6, { radial: 10 }), { at: [x, 1.25, z], color: '#5f9a4c', collide: { wall: true, name: 'cactus' } });
  b.add(sphereGeo(0.14, 0.12, 0.14, { w: 10, h: 5, thetaMax: Math.PI / 2 }), { at: [x, 2.05, z], color: '#5f9a4c' });
  for (const [s, y, L] of [[1, 1.2, 0.5], [-1, 1.5, 0.4]]) {
    b.add(cylGeo(0.08, 0.08, 0.25, { radial: 8 }), { at: [x + s * 0.2, y, z], rot: [0, 0, Math.PI / 2], color: '#5f9a4c' });
    b.add(cylGeo(0.08, 0.08, L, { radial: 8 }), { at: [x + s * 0.3, y + L / 2, z], color: '#5f9a4c' });
    b.add(sphereGeo(0.06, 0.06, 0.06, { w: 6, h: 4 }), { at: [x + s * 0.3, y + L + 0.02, z], color: C.pink });
  }
  b.blob(x, z, 0.35, 0.35);
}
function bigPot(b, x, z, s, seed, pot) {
  const r = seeded(seed);
  b.add(cylGeo(0.3 * s, 0.22 * s, 0.5 * s, { radial: 14 }), { at: [x, 0.25 * s, z], color: pot, tile: 'rings', rep: [0.4, 0.5 * s], collide: { wall: true, name: 'big-pot' } });
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + r() * 0.4; const L = (0.4 + r() * 0.3) * s;
    b.add(sphereGeo(0.09 * s, 0.02, L * 0.55, { w: 8, h: 4 }), { at: [x + Math.sin(a) * L * 0.4, 0.5 * s + 0.25 * s + r() * 0.3 * s, z + Math.cos(a) * L * 0.4], rot: [-0.6 - r() * 0.4, a, 0], color: k % 2 ? C.leaf : C.leafL });
  }
  b.blob(x, z, 0.35 * s, 0.35 * s);
}
function gnome(b, x, z) {
  b.add(cylGeo(0.13, 0.15, 0.3, { radial: 10 }), { at: [x, 0.15, z], color: C.blue, collide: true });
  b.add(sphereGeo(0.1, 0.1, 0.1, { w: 8, h: 6 }), { at: [x, 0.38, z], color: '#f2c9a8' });
  b.add(cylGeo(0.0, 0.11, 0.28, { radial: 10 }), { at: [x, 0.58, z], color: C.red });
  b.add(sphereGeo(0.07, 0.08, 0.05, { w: 8, h: 5 }), { at: [x, 0.31, z + 0.07], color: C.white });
  b.blob(x, z, 0.2, 0.2);
}

export const GREENHOUSE = {
  id: 'greenhouse', name: 'Greenhouse & Shed', blurb: 'A glasshouse jungle, a catwalk under the roof, and a shed full of tools.',
  build, size: 'XL', rooms: 7, climbs: 3,
  info: {
    w: W, d: D,
    floors: [{ y: 0, name: 'Ground' }, { y: CAT, name: 'Catwalk' }],
    rooms: [
      { name: 'Greenhouse', floor: 0, y: 0, x0: GX0, z0: GZ0, x1: GX1, z1: GZ1, landmark: 'the palm in the central bed' },
      { name: 'Catwalk', floor: 1, y: CAT, x0: -8.2, z0: GZ0, x1: 2.3, z1: GZ0 + 1.45, landmark: 'teal railing under the glass roof' },
      { name: 'Side yard', floor: 0, y: 0, x0: GX1, z0: -2.6, x1: X1, z1: GZ1, landmark: 'cold frames and the log pile' },
      { name: 'Shed', floor: 0, y: 0, x0: SX0, z0: SZ0, x1: SX1, z1: SZ1, landmark: 'pegboard of tools' },
      { name: 'Shed loft', floor: 0, y: LOFT, x0: SX0, z0: SZ0, x1: 6.8, z1: -5.6, landmark: 'crates over the workbench' },
      { name: 'Vegetable garden', floor: 0, y: 0, x0: X0, z0: GZ1, x1: -1, z1: Z1, landmark: 'the plaid scarecrow' },
      { name: 'Front lawn', floor: 0, y: 0, x0: -1, z0: GZ1, x1: X1, z1: Z1, landmark: 'rose arch over the path' },
    ],
    overview: { y: 9.5, radius: 13 },
    cams: [
      { name: 'overview', p: [0, 13, 17], t: [0, 1, -1] },
      { name: 'greenhouse', p: [1.2, 2.2, 1.6], t: [-5, 1.0, -3.5] },
      { name: 'greenhouse-left', p: [-7.6, 1.8, 1.6], t: [-2, 1.2, -4] },
      { name: 'catwalk', p: [-7.2, 3.0, -6.8], t: [1.5, 2.0, -5] },
      { name: 'roof', p: [-1.2, 1.2, 1.2], t: [-3.0, 4.6, -4] },
      { name: 'potting', p: [-0.3, 1.5, -1.0], t: [1.8, 0.9, -4.2] },
      { name: 'yard', p: [3.0, 1.6, 1.8], t: [8.5, 0.6, -1.5] },
      { name: 'shed', p: [6.0, 1.5, -2.0], t: [7.2, 1.2, -7.6] },
      { name: 'shed-loft', p: [8.8, 2.1, -3.2], t: [5.5, 1.7, -7.0] },
      { name: 'garden', p: [1.5, 1.8, 7.6], t: [-6, 0.8, 4.5] },
      { name: 'lawn', p: [-1.5, 1.6, 7.6], t: [5.5, 0.8, 3.8] },
    ],
  },
};
