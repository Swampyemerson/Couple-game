// CORNER MARKET — a small supermarket, 20 × 14 m, ceiling 4 m, with an office mezzanine (y 2.4).
//
//        back wall: fridges ────────────────────────────┬──── office mezzanine (stairs up the right wall)
//   bakery | aisle 1 | aisle 2 | aisle 3 | aisle 4      │ stockroom: pallet racks, box stacks, cart
//        checkouts           | produce crates           │ strip-curtain doors, peek window from the office
//                  entrance (low front wall)
//
// Five parallel aisles of patterned product shelves loop round both ends; hanging aisle signs,
// a duct and long lamps sit in reach of crawlers; the stockroom is a second loop through two doors.
import { boxGeo, cylGeo, sphereGeo } from '../geo.js';
import { P } from '../atlas.js';
import { seeded } from '../util.js';
import { Q } from './patterns.js';
import { F, aabb, wall, floor, slab, stairs, railing, picture, shelves, rug, stack } from './lib.js';

const W = 20; const D = 14; const X0 = -10; const X1 = 10; const Z0 = -7; const Z1 = 7;
const CEIL = 4.0; const MZ = 2.4; // mezzanine floor

const C = {
  ink: '#2a2730', cream: '#f6efe2', red: '#e2493b', orange: '#f28c38', yellow: '#f2c14e', mustard: '#e0a43d', lime: '#b5d94a',
  green: '#3fa66b', teal: '#2f8f8f', blue: '#3f6fd1', sky: '#8fb3c9', navy: '#2f3f6d', pink: '#ef7fa8', magenta: '#c94f9a', purple: '#7d5bc4', brown: '#8c5a3c', mint: '#bfe3d0',
  steel: '#9aa7ad', orangeRack: '#f28c38', blueRack: '#3f6fd1', card: '#d2a46a',
};
const AISLES = [
  { key: 'prodA', name: 'BREAKFAST', cols: [C.red, C.yellow, C.blue, C.orange, C.brown, C.mustard] },
  { key: 'prodB', name: 'SNACKS', cols: [C.pink, C.purple, C.green, C.orange, C.yellow, C.magenta] },
  { key: 'prodC', name: 'CANS & JARS', cols: [C.red, C.green, C.cream, C.teal, C.mustard] },
  { key: 'prodD', name: 'CLEANING', cols: [C.blue, C.teal, C.lime, '#ffffff', C.magenta, C.sky] },
];

function build(atlas) {
  for (const a of AISLES) atlas.add(a.key, Q.goods({ cols: a.cols }), { w: 480, h: 72 });
  atlas.add('drinks', Q.goods({ cols: [C.red, C.orange, C.lime, C.blue, C.pink, C.yellow, C.teal], bg: '#cfe7ee' }), { w: 480, h: 72 });
  atlas.add('bread', Q.products({ cols: ['#d9a35f', '#c4813f', '#e8c07a', '#9c5a2c'], rows: 1, bg: '#f6efe2' }), { w: 240, h: 64 });
  atlas.add('candy', Q.products({ cols: [C.pink, C.yellow, C.purple, C.lime, C.red], rows: 2, bg: '#ffffff' }), { w: 112, h: 112 });
  AISLES.forEach((a, i) => atlas.add('sign' + i, Q.sign({ bg: '#ffffff', fg: [C.red, C.purple, C.green, C.blue][i], text: a.name, sub: 'AISLE ' + (i + 1) }), { w: 240, h: 80, repeat: false }));
  atlas.add('signBakery', Q.sign({ bg: '#fff3d6', fg: C.brown, text: 'BAKERY', sub: 'fresh every morning' }), { w: 240, h: 80, repeat: false });
  atlas.add('signFresh', Q.sign({ bg: C.green, fg: '#ffffff', text: 'FRESH', sub: 'fruit & veg', border: '#1f6b43' }), { w: 240, h: 80, repeat: false });
  atlas.add('signStaff', Q.sign({ bg: C.yellow, fg: C.ink, text: 'STAFF ONLY' }), { w: 240, h: 80, repeat: false });
  atlas.add('signPay', Q.sign({ bg: C.red, fg: '#ffffff', text: 'PAY HERE', border: '#9c2a20' }), { w: 240, h: 80, repeat: false });
  atlas.add('floor', P.checker({ a: '#f4efe6', b: '#bfe3d0', n: 4, grout: '#d6d0c4' }), { size: 'M' });
  atlas.add('concrete', P.soil({ base: '#b9b4ab', speck: '#a39d93', stone: '#cfcac0' }), { size: 'M' });
  atlas.add('wallband', P.bands({ cols: ['#f6efe2', '#f6efe2', C.teal, '#f6efe2', C.red], widths: [6, 6, 1.2, 0.4, 0.5], n: 1 }), { size: 'M' });
  atlas.add('block', P.bricks({ brick: '#d9d4c8', alt: '#cfc9bc', mortar: '#a9a296', rows: 6, cols: 3 }), { size: 'M' });
  atlas.add('ceilgrid', Q.grid({ bg: '#f4f1ea', line: '#c9c2b4', n: 2, lw: 4 }), { size: 'M' });
  atlas.add('slats', Q.slats({ n: 4 }), { size: 'M' });
  atlas.add('carton', Q.grid({ bg: '#ffffff', line: 'rgb(214,214,214)', n: 1, lw: 10 }), { size: 'M' });
  atlas.add('oranges', Q.fruit({ bg: '#8c5a3c', cols: [C.orange, '#f6a23c', '#e8832a'] }), { size: 'M' });
  atlas.add('apples', Q.fruit({ bg: '#8c5a3c', cols: [C.red, '#c8321f', '#e86a4f'] }), { size: 'M' });
  atlas.add('limes', Q.fruit({ bg: '#8c5a3c', cols: [C.lime, '#8fc23a', C.green] }), { size: 'M' });
  atlas.add('lemons', Q.fruit({ bg: '#8c5a3c', cols: [C.yellow, '#ffe066', '#f2b632'], leaf: '#2f7d4f' }), { size: 'M' });
  atlas.add('belt', P.stripes({ cols: ['#2a2730', '#3a3740'], n: 6 }), { size: 'M' });
  atlas.add('wire', Q.grid({ bg: '#e7ecef', line: '#8a969c', n: 4, lw: 3 }), { size: 'M' });
  atlas.add('poster1', Q.pic({ kind: 'still', cols: [C.yellow, C.red, C.green, C.orange] }), { size: 'M', repeat: false });
  atlas.add('poster2', Q.pic({ kind: 'wave', cols: [C.sky, C.blue, '#ffffff', C.yellow] }), { size: 'M', repeat: false });
  atlas.add('mat', P.chevron({ cols: [C.red, C.ink, C.mustard], n: 2 }), { size: 'M' });
  atlas.add('stripes', P.stripes({ cols: [C.red, '#ffffff'], n: 4 }), { size: 'S' });
  atlas.add('label', P.label({ bg: '#ffffff', band: C.red, text: C.ink }), { size: 'S', repeat: false });
  atlas.add('rings', P.rings({ n: 3 }), { size: 'S' });

  return (b) => {
    const r = seeded('market');
    // ── shell ──
    const T = 0.16;
    b.add(boxGeo(W + 0.9, 0.36, D + 0.9, { round: 0.04 }), { at: [0, -0.2, 0], color: '#4b5560' });
    b.add(boxGeo(W + 2.4, 0.1, D + 3.0, {}), { at: [0, -0.33, 0.5], color: '#b9b4ab', outline: false });
    aabb(b, X0 - T, 0, Z0 - T, X1 + T, CEIL, Z0, { tile: 'wallband', rep: [1.6, CEIL], color: '#ffffff', outline: false, collide: { wall: true, name: 'back' } });
    aabb(b, X0 - T, 0, Z0, X0, CEIL, Z1, { tile: 'wallband', rep: [1.6, CEIL], color: '#ffffff', outline: false, collide: { wall: true, name: 'left' } });
    aabb(b, X1, 0, Z0, X1 + T, CEIL, Z1, { tile: 'block', rep: 1.0, color: '#ffffff', outline: false, collide: { wall: true, name: 'right' } });
    // low front with the entrance gap marked by door frames
    aabb(b, X0 - T, 0, Z1, X1 + T, 0.6, Z1 + T, { color: '#e9e3d6', outline: true, collide: { wall: true, name: 'front' } });
    b.collide(X0 - T, 0.6, Z1, X1 + T, CEIL + 2, Z1 + 0.4, { wall: false, climb: false, name: 'front-guard' });
    for (const x of [-1.6, 1.6]) aabb(b, x - 0.08, 0.6, Z1, x + 0.08, 2.4, Z1 + T, { color: C.steel, outline: true });
    aabb(b, -1.68, 2.4, Z1, 1.68, 2.56, Z1 + T, { color: C.steel, outline: true });
    for (const [x0, x1] of [[X0 - T, -1.68], [1.68, X1 + T]]) aabb(b, x0, 2.4, Z1, x1, 2.56, Z1 + T, { color: C.teal, outline: true });
    // ceiling (lid) with a grid underside
    slab(b, X0, Z0, X1, Z1, CEIL + 0.12, { thick: 0.12, lid: true, under: { tile: 'ceilgrid', rep: 1.2 }, name: 'ceil:market' });
    // floors
    floor(b, X0, Z0, 4, Z1, 0, { tile: 'floor', rep: 1.4 });
    floor(b, 4, Z0, X1, Z1, 0, { tile: 'concrete', rep: 1.6 });
    rug(b, 0, 6.3, 3.0, 1.0, 0, 'mat', { rep: 0.6 });

    // ── wall between the shop and the stockroom (strip-curtain doors, office window above) ──
    const SH = { tile: 'wallband', rep: [1.6, CEIL] }; const ST = { tile: 'block', rep: 1.0 };
    wall(b, { x0: 4, z0: Z0, x1: 4, z1: Z1, h: CEIL, t: 0.16, n: SH, p: ST, trim: C.steel, open: [{ c: 0.6, w: 1.5, top: 2.3 }, { c: 5.2, w: 1.2, top: 2.2 }, { c: -4.9, w: 3.6, bottom: MZ + 0.35, top: MZ + 1.45 }], name: 'w:stock' });
    const strips = (zc, w, top) => { for (let i = 0; i < Math.round(w / 0.2); i++) b.add(boxGeo(0.02, top - 0.12, 0.17), { at: [4 + (i % 2 ? 0.03 : -0.03), (top - 0.12) / 2 + 0.12, zc - w / 2 + 0.1 + i * 0.2], color: '#cfe7ec', outline: i % 2 === 0 }); };
    strips(0.6, 1.5, 2.3); strips(5.2, 1.2, 2.2);
    for (const [zc, t] of [[0.6, 'signStaff']]) aabb(b, 3.9, 2.45, zc - 0.6, 3.91, 2.85, zc + 0.6, { faces: ['nx'], tile: t, rep: 1, fit: true, color: '#ffffff', outline: false });

    // ── back wall: fridges with glass doors full of drinks ──
    for (let k = 0; k < 6; k++) {
      const x0 = -9.9 + k * 2.3; const x1 = x0 + 2.2;
      aabb(b, x0, 0, Z0, x1, 2.15, Z0 + 0.75, { color: '#e9f2f4', outline: true, collide: { wall: true, name: 'fridge' } });
      for (let s = 0; s < 4; s++) aabb(b, x0 + 0.08, 0.25 + s * 0.46, Z0 + 0.75, x1 - 0.08, 0.6 + s * 0.46, Z0 + 0.756, { faces: ['pz'], tile: k % 2 ? 'drinks' : 'prodC', rep: [1.6, 0.35], uvOff: [k * 0.37 + s * 0.21, 0], color: k % 2 ? '#ffffff' : '#eef8fb', outline: false });
      for (const x of [x0 + 0.04, (x0 + x1) / 2, x1 - 0.04]) aabb(b, x - 0.03, 0.15, Z0 + 0.75, x + 0.03, 2.1, Z0 + 0.79, { color: C.steel, outline: false });
      aabb(b, x0, 2.15, Z0, x1, 2.45, Z0 + 0.8, { color: k % 2 ? C.blue : C.teal, outline: true, collide: { wall: true, name: 'fridge-top' } });
    }
    b.blob(-3, Z0 + 1.0, 7.2, 0.5, { a: 0.22 });

    // ── bakery shelf on the left wall ──
    const bk = F(b, X0 + 0.32, -1.0, Math.PI / 2);
    const ys = shelves(bk, 6.4, 1.8, 0.55, 5, { color: C.brown, tile: null, name: 'bakery' });
    ys.slice(0, 4).forEach((y, i) => {
      for (let k = 0; k < 9; k++) { if ((i === 1 && k === 4) || (i === 2 && (k === 1 || k === 7))) continue; bk.box(0.52, 0.22, 0.32, [-2.9 + k * 0.72, y + 0.13, 0.05], { color: ['#d9a35f', '#c4813f', '#e8c07a', '#b9773d'][(k + i) % 4], round: 0.08, seg: 1 }); }
    });
    bk.box(2.4, 0.8, 0.03, [0, 2.45, -0.25], { tile: 'signBakery', rep: 1, fit: true, color: '#ffffff' });

    // ── four aisles of gondola shelving ──
    const gz0 = -4.3; const gz1 = 2.2; const GL = gz1 - gz0; const gh = 1.95;
    const levels = [0.12, 0.58, 1.04, 1.5];
    [-7.6, -4.6, -1.6, 1.4].forEach((gx, gi) => {
      const A = AISLES[gi]; const B2 = AISLES[(gi + 1) % 4];
      const zc = (gz0 + gz1) / 2;
      aabb(b, gx - 0.05, 0, gz0, gx + 0.05, gh, gz1, { color: '#e9e3d6', outline: true, collide: { wall: true, name: 'gondola-spine' } });
      aabb(b, gx - 0.5, 0, gz0, gx + 0.5, 0.12, gz1, { color: '#3a3740', outline: true, collide: { wall: false, name: 'gondola-base' } });
      aabb(b, gx - 0.52, gh, gz0 - 0.02, gx + 0.52, gh + 0.05, gz1 + 0.02, { color: [C.red, C.purple, C.green, C.blue][gi], outline: true, collide: { wall: false, name: 'gondola-top' } });
      for (const side of [-1, 1]) {
        const tile = side < 0 ? A.key : B2.key;
        levels.forEach((y, li) => {
          if (li) aabb(b, side < 0 ? gx - 0.5 : gx + 0.05, y - 0.03, gz0, side < 0 ? gx - 0.05 : gx + 0.5, y, gz1, { color: '#f4efe6', outline: true, collide: { wall: false, perch: true, name: 'shelf' } });
          // price-tag edge
          aabb(b, side < 0 ? gx - 0.52 : gx + 0.5, y - 0.06, gz0, side < 0 ? gx - 0.5 : gx + 0.52, y, gz1, { color: C.yellow, outline: false });
          // product blocks with gaps you can tuck into
          const gaps = [((gi * 7 + li * 3 + (side > 0 ? 2 : 0)) % 5) / 5, ((gi * 3 + li * 5 + (side > 0 ? 1 : 3)) % 5) / 5 + 0.1];
          let z = gz0 + 0.05;
          let seg = 0;
          while (z < gz1 - 0.1) {
            const len = Math.min(gz1 - 0.05 - z, 1.0 + r() * 0.8);
            const t = (z - gz0) / GL;
            const gap = (li === 1 || li === 2) && gaps.some((g2) => Math.abs(t - g2) < 0.08);
            if (!gap) {
              const hh = 0.32 + r() * 0.06; const dd = 0.3 + r() * 0.08;
              const x0 = side < 0 ? gx - 0.06 - dd : gx + 0.06; const x1 = side < 0 ? gx - 0.06 : gx + 0.06 + dd;
              aabb(b, x0, y, z, x1, y + hh, z + len - 0.02, { tile, rep: [2.6, hh], uvOff: [seg * 0.31 + li * 0.17, 0], color: '#ffffff', outline: true, collide: { wall: true, name: 'products' } });
            }
            z += gap ? 0.55 : len; seg++;
          }
        });
      }
      // end caps: promo stacks (front) and a cooler bin (back)
      const ec = F(b, gx, gz1 + 0.45);
      stack(ec, 0, 0, [[0.9, 0.3, 0.6, [C.red, C.purple, C.green, C.blue][gi], 'carton'], [0.8, 0.28, 0.55, C.yellow, 'carton', 0.1], [0.66, 0.26, 0.48, '#ffffff', A.key, -0.05]]);
      ec.blob(0, 0, 0.6, 0.45);
      const eb = F(b, gx, gz0 - 0.5);
      eb.box(0.9, 0.7, 0.6, [0, 0.35, 0], { color: '#ffffff', tile: 'wire', rep: 0.4, collide: { wall: true, name: 'bin' } });
      for (let i = 0; i < 6; i++) eb.sph(0.09, 0.09, 0.09, [-0.3 + (i % 3) * 0.3, 0.72, -0.12 + Math.floor(i / 3) * 0.24], { color: [C.yellow, C.red, C.lime][i % 3], w: 8, h: 6 });
      eb.blob(0, 0, 0.55, 0.4);
      // hanging aisle sign over the aisle to its left + a long lamp over the gondola
      const sx = gx - 1.5;
      b.add(boxGeo(1.9, 0.62, 0.04, { fit: true, faces: ['pz', 'nz'] }), { at: [sx, 3.05, zc], color: '#ffffff', tile: 'sign' + gi, rep: 1, outline: false });
      b.add(boxGeo(1.96, 0.68, 0.03), { at: [sx, 3.05, zc], color: [C.red, C.purple, C.green, C.blue][gi], outline: true });
      b.collide(sx - 0.98, 2.71, zc - 0.03, sx + 0.98, 3.39, zc + 0.03, { wall: true, perch: true, name: 'perch:sign' });
      for (const dx of [-0.8, 0.8]) b.add(cylGeo(0.006, 0.006, CEIL - 3.39, { radial: 4, caps: false }), { at: [sx + dx, (CEIL + 3.39) / 2, zc], color: C.ink, outline: false });
      aabb(b, gx - 0.12, 3.3, gz0 + 0.4, gx + 0.12, 3.38, gz1 - 0.4, { color: '#fffbe8', outline: true, collide: { wall: false, perch: true, name: 'perch:lamp' } });
      for (const z of [gz0 + 0.6, gz1 - 0.6]) b.add(cylGeo(0.005, 0.005, CEIL - 3.38, { radial: 4, caps: false }), { at: [gx, (CEIL + 3.38) / 2, z], color: C.ink, outline: false });
      b.blob(gx, zc, 0.65, GL * 0.5, { a: 0.2 });
    });
    // big round duct across the shop
    b.add(cylGeo(0.3, 0.3, 13.6, { radial: 12 }), { at: [-3.0, 3.62, -2.6], rot: [0, 0, Math.PI / 2], color: '#c3ccd1', tile: 'rings', rep: [0.6, 0.5] });
    b.collide(-9.8, 3.32, -2.9, 3.8, 3.92, -2.3, { wall: false, perch: true, name: 'perch:duct' });
    for (const x of [-8, -4, 0]) aabb(b, x - 0.03, 3.9, -2.65, x + 0.03, CEIL, -2.55, { color: C.ink, outline: false });

    // ── checkouts ──
    for (const [cx, n] of [[-7.6, 1], [-4.6, 2]]) {
      const ck = F(b, cx, 4.8);
      ck.box(0.75, 0.86, 2.0, [0, 0.43, 0], { color: [C.teal, C.red][n - 1], collide: { wall: true, name: 'checkout' } });
      ck.box(0.6, 0.02, 1.6, [0, 0.87, 0.1], { color: '#ffffff', tile: 'belt', rep: 0.3, outline: false });
      ck.box(0.8, 0.04, 2.05, [0, 0.9, 0], { color: '#f4efe6', faces: ['px', 'nx', 'pz', 'nz'] });
      ck.box(0.34, 0.22, 0.3, [0.05, 1.0, -0.75], { color: C.ink, collide: { wall: true, name: 'till' } });
      ck.box(0.3, 0.2, 0.03, [0.05, 1.25, -0.66], { color: '#9fd8c8', rot: [-0.4, 0, 0] });
      ck.cyl(0.02, 0.02, 1.4, [-0.3, 1.6, -0.85], { color: C.steel, radial: 6, collide: { wall: false, perch: true, name: 'perch:pole' } });
      ck.box(0.5, 0.36, 0.04, [-0.3, 2.45, -0.85], { tile: 'signPay', rep: 1, fit: true, color: '#ffffff', faces: ['pz', 'nz'], outline: true });
      // cashier's stool on the right; candy rack on the left
      ck.cyl(0.18, 0.18, 0.05, [0.9, 0.7, -0.3], { color: C.mustard, collide: { wall: false, name: 'stool' } });
      ck.cyl(0.025, 0.025, 0.68, [0.9, 0.34, -0.3], { color: C.ink, radial: 6 });
      ck.box(0.35, 1.3, 0.8, [-0.6, 0.65, 0.4], { color: '#ffffff', tile: 'candy', rep: [0.8, 0.65], collide: { wall: true, name: 'candy' } });
      ck.blob(0, 0, 0.6, 1.2, { a: 0.24 });
    }
    // stacked shopping carts + baskets by the door
    for (let i = 0; i < 3; i++) {
      const ct = F(b, -9.2, 6.25 - i * 0.22, Math.PI / 2);
      ct.box(0.9, 0.5, 0.55, [0, 0.65, 0], { color: '#ffffff', tile: 'wire', rep: 0.3, collide: i === 0 ? { wall: true, name: 'carts' } : false });
      ct.box(0.04, 0.04, 0.6, [-0.5, 0.95, 0], { color: C.red });
      for (const [sx, sz] of [[-0.35, -0.22], [0.35, -0.22], [-0.35, 0.22], [0.35, 0.22]]) ct.cyl(0.05, 0.05, 0.03, [sx, 0.05, sz], { color: C.ink, rot: [0, 0, Math.PI / 2], radial: 8 });
    }
    b.collide(-9.85, 0, 5.3, -8.6, 0.4, 6.7, { wall: true, name: 'cart-frame' });
    b.blob(-9.2, 6.0, 0.7, 0.6);
    stack(F(b, -6.0, 6.4), 0, 0, [[0.5, 0.18, 0.36, C.red, 'wire'], [0.5, 0.18, 0.36, C.blue, 'wire', 0.05], [0.5, 0.18, 0.36, C.red, 'wire', -0.04], [0.5, 0.18, 0.36, C.green, 'wire', 0.08]]);
    b.blob(-6.0, 6.4, 0.35, 0.3);

    // ── produce: tilted crates, an orange pyramid, flower buckets ──
    const crate = (x, z, yaw, fruit, h = 0.75) => {
      const cr = F(b, x, z, yaw);
      cr.box(1.0, h, 0.7, [0, h / 2, 0], { color: '#c99a5b', tile: 'slats', rep: [1.0, 0.25], collide: { wall: true, name: 'crate' } });
      cr.box(0.96, 0.04, 0.66, [0, h + 0.05, 0.0], { color: '#ffffff', tile: fruit, rep: 0.5, rot: [0.25, 0, 0], outline: false });
      for (let i = 0; i < 5; i++) cr.sph(0.07, 0.07, 0.07, [-0.36 + i * 0.18, h + 0.1, 0.18 - (i % 2) * 0.1], { color: { oranges: C.orange, apples: C.red, limes: C.lime, lemons: C.yellow }[fruit], w: 8, h: 6, outline: i % 2 === 0 });
      cr.blob(0, 0, 0.6, 0.45);
    };
    crate(0.7, 3.6, 0, 'apples'); crate(1.8, 3.6, 0, 'oranges', 0.68); crate(2.9, 3.6, 0, 'limes'); crate(3.4, 5.2, -Math.PI / 2, 'lemons', 0.62);
    crate(0.7, 5.4, Math.PI, 'oranges', 0.55);
    // orange pyramid on a low table
    const pt = F(b, 1.9, 5.6);
    pt.box(1.1, 0.5, 0.9, [0, 0.25, 0], { color: C.green, collide: { wall: true, name: 'fruit-table' } });
    for (let l = 0; l < 3; l++) for (let i = 0; i < 3 - l; i++) for (let j = 0; j < 3 - l; j++) pt.sph(0.13, 0.13, 0.13, [(i - (2 - l) / 2) * 0.27, 0.62 + l * 0.2, (j - (2 - l) / 2) * 0.27], { color: l === 2 ? C.lime : C.orange, w: 8, h: 6 });
    pt.collide(-0.4, 0.5, -0.4, 0.4, 0.95, 0.4, { wall: true, name: 'pyramid' });
    pt.blob(0, 0, 0.7, 0.55);
    b.add(boxGeo(2.2, 0.7, 0.04, { fit: true, faces: ['pz', 'nz'] }), { at: [2.0, 2.95, 4.6], color: '#ffffff', tile: 'signFresh', rep: 1, outline: false });
    b.add(boxGeo(2.26, 0.76, 0.03), { at: [2.0, 2.95, 4.6], color: C.green, outline: true });
    b.collide(0.87, 2.57, 4.57, 3.13, 3.33, 4.63, { wall: true, perch: true, name: 'perch:sign' });
    for (const x of [1.2, 2.8]) b.add(cylGeo(0.006, 0.006, 0.67, { radial: 4, caps: false }), { at: [x, 3.66, 4.6], color: C.ink, outline: false });
    for (let i = 0; i < 3; i++) {
      const fb = F(b, 3.55, 6.3 - i * 0.5);
      fb.cyl(0.17, 0.14, 0.4, [0, 0.2, 0], { color: [C.teal, C.navy, C.teal][i], collide: true });
      for (let k = 0; k < 5; k++) fb.sph(0.07, 0.06, 0.07, [Math.cos(k * 1.3) * 0.09, 0.62 + (k % 2) * 0.08, Math.sin(k * 1.3) * 0.09], { color: [C.pink, C.yellow, C.red, C.purple, '#ffffff'][(k + i) % 5], w: 8, h: 6 });
      fb.cyl(0.006, 0.006, 0.3, [0, 0.45, 0], { color: C.green, outline: false, radial: 4 });
      fb.blob(0, 0, 0.2, 0.2);
    }
    // front window posters
    picture(b, -5.0, 1.75, Z1 - 0.06, 0.7, 0.9, 'z-', 'poster1', { frame: C.red, depth: 0.02 });
    picture(b, 6.0, 1.75, Z1 - 0.06, 0.9, 0.7, 'z-', 'poster2', { frame: C.blue, depth: 0.02 });

    // ── stockroom: pallet racks you can climb by box stacks, cartons, pallet jack ──
    const rack = (x, z0, z1, lv = [0.15, 1.2, 2.2]) => {
      for (const z of [z0, (z0 + z1) / 2, z1]) for (const dx of [-0.45, 0.45]) aabb(b, x + dx - 0.04, 0, z - 0.04, x + dx + 0.04, lv[lv.length - 1] + 0.1, z + 0.04, { color: C.blueRack, outline: true, collide: { wall: true, perch: true, name: 'perch:upright' } });
      for (const y of lv) {
        aabb(b, x - 0.5, y - 0.08, z0, x + 0.5, y, z1, { color: C.orangeRack, outline: true, collide: { wall: false, name: 'rack-beam' } });
        aabb(b, x - 0.45, y, z0 + 0.05, x + 0.45, y + 0.02, z1 - 0.05, { color: '#c9a274', tile: 'slats', rep: 0.5, outline: false });
      }
      b.blob(x, (z0 + z1) / 2, 0.6, (z1 - z0) / 2 + 0.1, { a: 0.2 });
    };
    rack(9.4, -2.0, 2.4); rack(5.0, 2.4, 6.4, [0.15, 1.2]);
    const cartons = (x, z, y, n, seed) => {
      const rr = seeded(seed); let yy = y;
      for (let i = 0; i < n; i++) {
        const w = 0.5 + rr() * 0.3; const h = 0.3 + rr() * 0.22; const d = 0.4 + rr() * 0.2;
        aabb(b, x - w / 2, yy, z - d / 2, x + w / 2, yy + h, z + d / 2, { color: [C.card, '#c9925a', '#e0b77d', '#ffffff'][(i + seed.length) % 4], tile: i % 3 === 2 ? 'prodB' : 'carton', rep: i % 3 === 2 ? [0.8, h] : [w, h], outline: true, collide: { wall: true, name: 'carton' } });
        yy += h;
      }
      return yy;
    };
    // rack contents (leave cubbies)
    cartons(9.4, -1.4, 0.15, 2, 'r1'); cartons(9.4, 1.6, 0.15, 1, 'r2'); cartons(9.4, -0.6, 1.2, 1, 'r3'); cartons(9.4, 1.0, 1.2, 2, 'r4b'); cartons(9.4, 0.2, 2.2, 1, 'r5');
    cartons(5.0, 3.2, 0.15, 2, 'r6'); cartons(5.0, 5.6, 0.15, 1, 'r7'); cartons(5.0, 4.4, 1.2, 1, 'r8');
    // climbing route: crate → pallet → rack (each ≤ 0.6 up)
    cartons(8.3, -0.6, 0, 1, 'stepA'); cartons(8.2, 0.5, 0, 2, 'stepB');
    cartons(6.6, 4.7, 0, 3, 'stack1'); cartons(7.4, 5.6, 0, 2, 'stack2'); cartons(8.6, 5.9, 0, 4, 'stack3'); cartons(7.6, -1.9, 0, 2, 'stack4');
    b.blob(7.4, 5.2, 1.6, 1.0, { a: 0.22 });
    // pallet jack
    const pj = F(b, 7.6, 2.9, 0.4);
    pj.box(0.55, 0.07, 1.1, [0, 0.07, 0], { color: C.red, collide: false });
    pj.cyl(0.03, 0.03, 1.0, [0, 0.55, -0.6], { color: C.ink, rot: [0.3, 0, 0], radial: 6 });
    pj.box(0.3, 0.3, 0.2, [0, 0.2, -0.55], { color: C.red, collide: { wall: true, name: 'jack' } });
    pj.blob(0, 0, 0.35, 0.6);

    // ── office mezzanine (x 4…10, z −7…−2.5, y 2.4) + stairs up the right wall ──
    slab(b, 4.08, Z0, X1, -2.5, MZ, { under: { color: '#d7d2c8' }, edge: C.ink, name: 'ceil:mezzanine' });
    floor(b, 4.08, Z0, X1, -2.5, MZ, { tile: 'concrete', rep: 1.2, color: '#c9d8e6' });
    for (const [x, z] of [[4.4, -2.7], [7.6, -2.7]]) aabb(b, x - 0.09, 0, z - 0.09, x + 0.09, MZ - 0.2, z + 0.09, { color: C.steel, outline: true, collide: { wall: true, perch: true, name: 'perch:column' } });
    // free-standing stairs in the middle of the stockroom (walk round and under them)
    stairs(b, { x: 5.9, z: -2.5 + 14 * 0.28, dir: 'z-', width: 1.0, n: 14, rise: MZ / 14, run: 0.28, tread: { color: '#8a969c', tile: 'wire', rep: 0.3 }, stringer: C.ink, railSide: 2, rail: C.yellow, name: 'mezz-stairs' });
    railing(b, 4.1, -2.5, 5.35, -2.5, MZ, { color: C.yellow, top: C.yellow, name: 'mezz-a' });
    railing(b, 6.45, -2.5, 9.95, -2.5, MZ, { color: C.yellow, top: C.yellow, name: 'mezz-b' });
    // office stuff
    const desk = F(b, 6.0, -6.3, 0, MZ);
    desk.box(1.6, 0.05, 0.7, [0, 0.74, 0], { color: '#c99a6b', collide: { wall: false, ceil: true, name: 'desk' } });
    for (const sx of [-0.75, 0.75]) desk.box(0.06, 0.72, 0.66, [sx, 0.36, 0], { color: C.ink });
    desk.box(0.5, 0.36, 0.04, [0, 1.0, -0.2], { color: C.ink }); desk.box(0.46, 0.3, 0.01, [0, 1.0, -0.175], { color: '#9fd8c8', outline: false });
    desk.box(0.4, 0.03, 0.15, [0, 0.78, 0.1], { color: '#ffffff' });
    desk.cyl(0.05, 0.045, 0.1, [0.5, 0.82, 0.1], { color: C.red });
    desk.blob(0, 0, 0.9, 0.45);
    const chairM = F(b, 6.0, -5.5, Math.PI, MZ);
    chairM.cyl(0.24, 0.24, 0.06, [0, 0.5, 0], { color: C.blue, collide: { wall: false, name: 'office-chair' } });
    chairM.box(0.42, 0.45, 0.06, [0, 0.8, -0.2], { color: C.blue });
    chairM.cyl(0.03, 0.03, 0.45, [0, 0.25, 0], { color: C.ink, radial: 6 });
    chairM.blob(0, 0, 0.3, 0.3);
    for (let i = 0; i < 4; i++) {
      const lk = F(b, 9.68, -6.4 + i * 0.5, -Math.PI / 2, MZ);
      lk.box(0.48, 1.5, 0.5, [0, 0.75, 0], { color: [C.teal, C.red, C.mustard, C.teal][i], tile: 'stripes', rep: [0.04, 1.5], collide: { wall: true, name: 'locker' } });
    }
    const fc = F(b, 4.5, -6.6, 0, MZ);
    fc.box(0.5, 0.95, 0.55, [0, 0.475, 0], { color: C.steel, tile: 'carton', rep: [0.5, 0.32], collide: { wall: true, name: 'filing' } });
    fc.cyl(0.12, 0.1, 0.12, [0, 1.01, 0], { color: C.pink });
    picture(b, 7.6, MZ + 1.4, Z0 + 0.001, 0.6, 0.45, 'z+', 'poster2', { frame: C.ink });
    // under the office: shelving of cleaning stock and a mop bucket
    const us = F(b, 6.8, Z0 + 0.35);
    shelves(us, 3.0, 1.9, 0.6, 4, { color: C.blueRack, tile: null, name: 'stock-shelf' });
    for (let lv = 0; lv < 3; lv++) us.box(2.6, 0.32, 0.4, [lv === 1 ? -0.6 : 0, 0.05 + lv * 0.62 + 0.18, 0], { color: '#ffffff', tile: 'prodD', rep: [1.6, 0.32], uvOff: [lv * 0.4, 0], collide: { wall: true, name: 'stock' } });
    const mb = F(b, 5.0, -4.0);
    mb.cyl(0.22, 0.2, 0.35, [0, 0.175, 0], { color: C.yellow, collide: true });
    mb.cyl(0.015, 0.015, 1.3, [0.05, 0.7, 0], { color: '#c99a6b', rot: [0, 0, 0.15], radial: 6 });
    mb.blob(0, 0, 0.26, 0.26);

    // ── spots ──
    b.spot('lobby', { x: -1.6, z: 5.8 });
    b.spot('hiderSpawn', { x: -3.0, z: 3.4, yaw: Math.PI });
    b.spot('seekerSpawn', { x: -1.0, z: 6.2, yaw: Math.PI });
    b.spot('spawnA', { x: -6.1, z: 3.2, yaw: Math.PI });
    b.spot('spawnB', { x: 2.9, z: -0.5, yaw: Math.PI });
    b.spot('hiderSpawns', [{ x: -3.0, z: 3.4, yaw: Math.PI }, { x: -0.1, z: -5.4, yaw: 0 }, { x: 6.8, z: 0.4, y: 0, yaw: -Math.PI / 2 }, { x: 5.6, z: -4.5, y: MZ, yaw: 0 }]);
    b.spot('seekerSpawns', [{ x: -1.0, z: 6.2, yaw: Math.PI }, { x: -2.6, z: 6.3, yaw: Math.PI }, { x: 6.1, z: 6.4, yaw: Math.PI }]);
    b.spot('camo', { x: -3.0, z: -6.0, y: 0.25, wallNormal: [0, 0, 1], note: 'fridge doors full of drinks' });
    b.spot('rug', { x: 0, z: 6.3, yaw: 0 });
    b.probe('pay-checkout-red', [-4.6 + 0.375, 0.4, 4.8], [1, 0, 0], C.red);
  };
}

export const MARKET = {
  id: 'market', name: 'Corner Market', blurb: 'Five aisles of loud packaging, fridges, a stockroom and an office upstairs.',
  build, size: 'XL', rooms: 7, climbs: 3,
  info: {
    w: W, d: D,
    floors: [{ y: 0, name: 'Shop floor' }, { y: MZ, name: 'Office' }],
    rooms: [
      { name: 'Aisles', floor: 0, y: 0, x0: -10, z0: -5.2, x1: 4, z1: 3.2, landmark: 'hanging aisle signs' },
      { name: 'Fridges', floor: 0, y: 0, x0: -10, z0: -7, x1: 4, z1: -5.2, landmark: 'glass doors full of drinks' },
      { name: 'Checkouts', floor: 0, y: 0, x0: -10, z0: 3.2, x1: -0.2, z1: 7, landmark: 'PAY HERE signs and the cart stack' },
      { name: 'Produce', floor: 0, y: 0, x0: -0.2, z0: 3.2, x1: 4, z1: 7, landmark: 'FRESH sign and the orange pyramid' },
      { name: 'Stockroom', floor: 0, y: 0, x0: 4, z0: -2.5, x1: 10, z1: 7, landmark: 'orange-and-blue pallet racks' },
      { name: 'Under the office', floor: 0, y: 0, x0: 4, z0: -7, x1: 10, z1: -2.5, landmark: 'blue stock shelf and mop bucket' },
      { name: 'Office', floor: 1, y: MZ, x0: 4, z0: -7, x1: 10, z1: -2.5, landmark: 'yellow railing and the lockers' },
    ],
    overview: { y: 12, radius: 18 },
    cams: [
      { name: 'overview', p: [0, 14, 18], t: [0, 1, 0] },
      { name: 'aisles', p: [-3.1, 1.4, 4.0], t: [-3.1, 1.0, -4.5] },
      { name: 'aisle-end', p: [3.2, 2.2, 3.0], t: [-6, 1.2, -1] },
      { name: 'fridges', p: [-0.1, 1.5, -2.0], t: [-6, 1.0, -7] },
      { name: 'checkouts', p: [-2.0, 1.8, 6.6], t: [-7.5, 0.8, 4.2] },
      { name: 'produce', p: [-0.5, 1.6, 3.0], t: [2.5, 0.6, 5.6] },
      { name: 'stockroom', p: [4.6, 1.8, 6.4], t: [8.5, 1.0, -0.5] },
      { name: 'under-office', p: [8.6, 1.4, -1.6], t: [5.5, 0.8, -6.5] },
      { name: 'office', p: [4.6, 3.8, -2.8], t: [8.0, 2.8, -6.5] },
      { name: 'ceiling', p: [-3.0, 3.0, 5.5], t: [-3.0, 3.4, -3] },
    ],
  },
};
