// MUSEUM NIGHT — 24 × 16 m, a grand hall 7 m high with a coffered ceiling, twin stairs to a balcony.
//
//   back ──────────────────────────────────────────────────────────────────
//   │ PAINTINGS (damask)   │ GRAND HALL: dinosaur on a plinth, columns,  │ MODERN ART     │
//   │  upstairs: ANCIENT   │ velvet ropes, balcony at 3.6 m (stairs on   │ (stripes, dots,│
//   │  WORLDS gallery      │ both sides), coffered ceiling at 7 m        │  a mobile)     │
//   ├ SCULPTURE ROOM ──────┼──── FOYER: ticket desk, turnstiles ─────────┼ GIFT SHOP ─────┤
//   front (low wall, night windows)
//
// Loops: hall ↔ paintings ↔ sculpture room ↔ foyer ↔ hall, hall ↔ modern ↔ gift shop ↔ foyer;
// upstairs, the two staircases + balcony make a loop through the hall. Night: deep wall colours,
// moonlit windows and pools of spotlight on the floors.
import { boxGeo, cylGeo, sphereGeo, latheGeo } from '../geo.js';
import { P } from '../atlas.js';
import { seeded } from '../util.js';
import { Q } from './patterns.js';
import { F, aabb, wall, floor, slab, stairs, railing, picture, shelves, rug, stack } from './lib.js';

const W = 24; const D = 16; const X0 = -12; const X1 = 12; const Z0 = -8; const Z1 = 8;
const HALL = 7.0; const UP = 3.6; const WING = 3.6; const FOY = 4.4; const HZ1 = 3; // hall front edge

const C = {
  ink: '#2a2730', bone: '#efe3c4', boneD: '#d9c9a0', gold: '#d9a63a', brass: '#c9993a', velvet: '#b3213a', navy: '#1f2a44', night: '#2b3566',
  marble: '#e9e6e0', stone: '#cfcac0', red: '#e2493b', orange: '#f28c38', yellow: '#f2c14e', green: '#3fa66b', teal: '#2f8f8f', blue: '#3f6fd1', sky: '#8fb3c9',
  pink: '#ef7fa8', purple: '#7d5bc4', lilac: '#b9a3d9', cream: '#f3e7cf', white: '#f8f5ee', wood: '#8a5a3c', plum: '#5a2a4a', mint: '#bfe3d0', lime: '#b5d94a',
};

function build(atlas) {
  atlas.add('marble', Q.marble({ bg: '#e9e6e0', vein: '#b8b2a8', vein2: '#d6d1c8' }), { size: 'L' });
  atlas.add('damask', Q.damask({ bg: '#7a1f33', fg: '#9c3048', accent: C.gold }), { size: 'L' });
  atlas.add('nightwin', P.window({ sky: '#2b3566', cloud: '#4b5687', frame: '#d9d2c4', hill: '#1d2440' }), { size: 'L', repeat: false });
  atlas.add('floorchk', P.checker({ a: '#2a2730', b: '#e9e6e0', n: 4, grout: '#9a948a' }), { size: 'M' });
  atlas.add('parquet', P.herringbone({ a: '#b07a4f', b: '#9a6640', seam: '#6b4430' }), { size: 'M' });
  atlas.add('coffer', Q.grid({ bg: '#e6dccb', line: '#b8a888', n: 2, lw: 9, dot: '#d9a63a' }), { size: 'M' });
  atlas.add('mosaic', Q.scales({ a: '#2f8f8f', b: '#d9a63a', line: '#1f2a44' }), { size: 'M' });
  atlas.add('modern1', P.stripes({ cols: ['#f8f5ee', '#f8f5ee', '#e2493b', '#f8f5ee', '#2a2730'], widths: [4, 4, 1, 1, 0.5], n: 2 }), { size: 'M' });
  atlas.add('modern2', P.dots({ bg: '#f2c14e', fg: '#f8f5ee', n: 4, r: 0.22 }), { size: 'M' });
  atlas.add('giftwall', P.bands({ cols: ['#f2c14e', '#f2c14e', '#ef7fa8', '#f8f5ee'], widths: [5, 5, 1, 1], n: 1 }), { size: 'M' });
  atlas.add('sculptwall', P.dots({ bg: '#2b3566', fg: '#4b5687', n: 3, r: 0.16 }), { size: 'M' });
  atlas.add('art1', Q.pic({ kind: 'stars', cols: ['#1f3a7a', '#6fa8dc', '#ffd23f', '#ffe9a6'] }), { size: 'M', repeat: false });
  atlas.add('art2', Q.pic({ kind: 'wave', cols: ['#e7dcc0', '#2f5d9a', '#ffffff', '#e2493b'] }), { size: 'M', repeat: false });
  atlas.add('art3', Q.pic({ kind: 'portrait', cols: ['#3f6f4f', '#2a2730', '#f2c9a8', '#5a3a2a'] }), { size: 'M', repeat: false });
  atlas.add('art4', P.art({ style: 'blocks', cols: [C.red, C.blue, C.yellow] }), { size: 'M', repeat: false });
  atlas.add('art5', P.art({ style: 'circles', cols: [C.pink, C.teal, C.yellow, C.red, C.purple], bg: '#1f2a44' }), { size: 'M', repeat: false });
  atlas.add('art6', P.art({ style: 'sunset', cols: [C.purple, C.pink, C.orange, C.yellow, '#3c6e4f'] }), { size: 'M', repeat: false });
  atlas.add('art7', Q.pic({ kind: 'still', cols: ['#5a3a2a', '#d9a63a', '#e2493b', '#3fa66b'] }), { size: 'M', repeat: false });
  atlas.add('art8', Q.pic({ kind: 'landscape', cols: ['#f6d0a0', '#7d5bc4', '#3f6f4f'] }), { size: 'M', repeat: false });
  atlas.add('art9', Q.pic({ kind: 'dino', cols: ['#bfe3d0', '#2f8f8f', '#d9a63a'] }), { size: 'M', repeat: false });
  atlas.add('art10', P.art({ style: 'waves', cols: [C.blue, C.teal, C.green, C.yellow, C.orange, C.red] }), { size: 'M', repeat: false });
  atlas.add('plush', Q.scales({ a: '#3fa66b', b: '#b5d94a', line: '#2c5e3a' }), { size: 'M' });
  atlas.add('meander', P.bands({ cols: ['#1f2a44', '#d9a63a', '#1f2a44', '#e8dcc0'], widths: [1, 1, 1, 4], n: 2 }), { size: 'M' });
  atlas.add('sarc', P.bands({ cols: ['#d9a63a', '#2f5d9a', '#d9a63a', '#2f8f8f', '#e2493b'], widths: [2, 1, 1, 1, 0.5], n: 3 }), { size: 'M' });
  atlas.add('postcards', Q.products({ cols: [C.blue, C.pink, C.yellow, C.teal, C.red, C.purple], rows: 1, bg: '#f8f5ee' }), { w: 240, h: 64 });
  atlas.add('signDino', Q.sign({ bg: C.navy, fg: C.yellow, text: 'DINOSAURS', sub: 'Late Cretaceous · 66 million years', border: C.gold }), { w: 240, h: 80, repeat: false });
  atlas.add('signGift', Q.sign({ bg: C.pink, fg: '#ffffff', text: 'GIFT SHOP', border: C.plum }), { w: 240, h: 80, repeat: false });
  atlas.add('signAncient', Q.sign({ bg: '#e8dcc0', fg: '#1f2a44', text: 'ANCIENT WORLDS', sub: 'upstairs', border: C.gold }), { w: 240, h: 80, repeat: false });
  atlas.add('signModern', Q.sign({ bg: '#ffffff', fg: C.red, text: 'MODERN', sub: 'please do not touch' }), { w: 240, h: 80, repeat: false });
  atlas.add('signTix', Q.sign({ bg: C.teal, fg: '#ffffff', text: 'TICKETS', border: '#1f5f5f' }), { w: 240, h: 80, repeat: false });
  atlas.add('bannerA', Q.diag({ cols: ['#b3213a', '#d9a63a', '#f3e7cf'], n: 2 }), { size: 'M', repeat: false });
  atlas.add('bannerB', Q.argyle({ a: '#1f2a44', b: '#2f8f8f', c: '#d9a63a', line: '#f3e7cf' }), { size: 'M', repeat: false });
  atlas.add('rings', P.rings({ n: 3 }), { size: 'S' });
  atlas.add('stripeS', P.stripes({ cols: [C.red, '#ffffff'], n: 3 }), { size: 'S' });

  return function* fill(b) {
    const r = seeded('museum');
    yield 'shell';
    // ── shell ──
    const T = 0.2;
    b.add(boxGeo(W + 0.9, 0.36, D + 0.9, { round: 0.04 }), { at: [0, -0.2, 0], color: '#3a3550' });
    b.add(boxGeo(W + 2.4, 0.1, D + 3.0, {}), { at: [0, -0.33, 0.5], color: '#2b3566', outline: false });
    aabb(b, X0 - T, 0, Z0 - T, X1 + T, HALL, Z0, { color: '#d6d1c8', tile: 'marble', rep: 2.0, outline: false, collide: { wall: true, name: 'back' } });
    aabb(b, X0 - T, 0, Z0, X0, HALL, Z1, { color: '#d6d1c8', tile: 'marble', rep: 2.0, outline: false, collide: { wall: true, name: 'left' } });
    aabb(b, X1, 0, Z0, X1 + T, HALL, Z1, { color: '#d6d1c8', tile: 'marble', rep: 2.0, outline: false, collide: { wall: true, name: 'right' } });
    aabb(b, X0 - T, 0, Z1, X1 + T, 0.7, Z1 + T, { color: '#d6d1c8', tile: 'marble', rep: 1.0, outline: true, collide: { wall: true, name: 'front' } });
    b.collide(X0 - T, 0.7, Z1, X1 + T, HALL + 2, Z1 + 0.4, { wall: false, climb: false, name: 'front-guard' });
    b.collide(X0 - T - 0.1, HALL, Z0 - T - 0.1, X1 + T + 0.1, HALL + 3, Z1 + 0.4, { wall: false, climb: false, name: 'roof-guard' }); // keep off the wall tops
    // entrance columns on the low front wall
    for (const x of [-2.2, 2.2]) b.add(latheGeo([[0.3, 0], [0.26, 0.15], [0.22, 0.3], [0.2, 3.6], [0.28, 3.75], [0.3, 3.9]], { radial: 14 }), { at: [x, 0, Z1 - 0.05], color: C.marble, collide: { wall: true, perch: true, name: 'perch:front-column' } });

    yield 'floors';
    // floors
    floor(b, -6, Z0, 6, HZ1, 0, { tile: 'floorchk', rep: 2.0 });
    floor(b, -6, HZ1, 6, Z1, 0, { tile: 'marble', rep: 2.0, color: '#f4f1ea' });
    floor(b, X0, Z0, -6, 2, 0, { tile: 'parquet', rep: 1.2 });
    floor(b, X0, 2, -6, Z1, 0, { tile: 'floorchk', rep: 1.4, color: '#c9c2d8' });
    floor(b, 6, Z0, X1, 2, 0, { color: '#e9e6e0' });
    floor(b, 6, 2, X1, Z1, 0, { tile: 'parquet', rep: 1.0, color: '#f0d9c0' });

    yield 'outer wall skins';
    // ── outer wall skins per room (night windows on the back + sides) ──
    const skin = (side, a0, a1, y0, y1, d) => {
      const o = { tile: d.tile, rep: d.rep || 1, color: d.color || '#ffffff', outline: false }; const rep = Array.isArray(o.rep) ? o.rep[0] : o.rep;
      if (side === 'back') aabb(b, a0, y0, Z0, a1, y1, Z0 + 0.004, { ...o, faces: ['pz'], uvOff: [a0 / rep, 0] });
      if (side === 'left') aabb(b, X0, y0, a0, X0 + 0.004, y1, a1, { ...o, faces: ['px'], uvOff: [-a1 / rep, 0] });
      if (side === 'right') aabb(b, X1 - 0.004, y0, a0, X1, y1, a1, { ...o, faces: ['nx'], uvOff: [a0 / rep, 0] });
    };
    const DM = { tile: 'damask', rep: 1.2 }; const MB = { tile: 'marble', rep: 2.0, color: '#d8dce8' }; const M1 = { tile: 'modern1', rep: 1.4 }; const M2 = { tile: 'modern2', rep: 0.8 };
    const SC = { tile: 'sculptwall', rep: 0.9 }; const GW = { tile: 'giftwall', rep: [1.2, WING] }; const AN = { tile: 'meander', rep: [1.0, 3.4], color: '#ffffff' };
    skin('back', X0, -6, 0, UP, DM); skin('left', Z0, 2, 0, UP, DM); skin('left', 2, Z1, 0, WING, SC);
    skin('back', -6, 6, 0, HALL, MB);
    skin('back', 6, X1, 0, WING, M1); skin('right', Z0, 2, 0, WING, M2); skin('right', 2, Z1, 0, WING, GW);
    skin('back', X0, -6, UP, HALL, AN); skin('left', Z0, 2, UP, HALL, AN);
    const win = (side, c, y, w, h) => {
      const o = { tile: 'nightwin', rep: 1, color: '#ffffff', outline: false, fit: true };
      if (side === 'back') aabb(b, c - w / 2, y, Z0, c + w / 2, y + h, Z0 + 0.012, { ...o, faces: ['pz'] });
      if (side === 'left') aabb(b, X0, y, c - w / 2, X0 + 0.012, y + h, c + w / 2, { ...o, faces: ['px'] });
      if (side === 'right') aabb(b, X1 - 0.012, y, c - w / 2, X1, y + h, c + w / 2, { ...o, faces: ['nx'] });
    };
    win('back', -3.2, 4.6, 1.4, 2.0); win('back', 3.2, 4.6, 1.4, 2.0); win('back', 0, 5.0, 1.8, 1.6);
    win('left', 5.0, 1.2, 1.2, 1.4); win('right', 5.0, 1.4, 1.0, 1.2); win('left', -3.0, UP + 1.0, 1.4, 1.6);

    yield 'interior walls';
    // ── interior walls ──
    const trim = C.gold;
    wall(b, { x0: -6, z0: Z0, x1: -6, z1: Z1, h: UP, t: 0.2, n: DM, p: MB, trim, open: [{ c: -2.0, w: 2.4, top: 3.0 }, { c: 5.4, w: 1.8, top: 2.6 }], name: 'w:left-wing' });
    yield 'sculpture-room side of';
    // sculpture-room side of that wall (z > 2) is the sculpture paper
    aabb(b, -6.1 - 0.004, 0, 2, -6.1, UP, 4.5, { faces: ['nx'], tile: 'sculptwall', rep: 0.9, color: '#ffffff', outline: false });
    aabb(b, -6.1 - 0.004, 0, 6.3, -6.1, UP, Z1, { faces: ['nx'], tile: 'sculptwall', rep: 0.9, color: '#ffffff', outline: false });
    aabb(b, -6.1 - 0.004, 2.6, 4.5, -6.1, UP, 6.3, { faces: ['nx'], tile: 'sculptwall', rep: 0.9, color: '#ffffff', outline: false });
    wall(b, { x0: -6, z0: Z0, x1: -6, z1: HZ1, y: UP, h: HALL - UP, t: 0.2, n: AN, p: MB, trim, open: [{ c: -6.6, w: 1.6, top: 2.4 }], name: 'w:left-up' });
    wall(b, { x0: 6, z0: Z0, x1: 6, z1: Z1, h: WING, t: 0.2, n: MB, p: M1, trim, open: [{ c: -2.0, w: 2.4, top: 3.0 }, { c: 5.4, w: 1.8, top: 2.6 }], name: 'w:right-wing' });
    aabb(b, 6.1, 0, 2, 6.1 + 0.004, WING, 4.5, { faces: ['px'], tile: 'giftwall', rep: [1.2, WING], color: '#ffffff', outline: false });
    aabb(b, 6.1, 0, 6.3, 6.1 + 0.004, WING, Z1, { faces: ['px'], tile: 'giftwall', rep: [1.2, WING], color: '#ffffff', outline: false });
    aabb(b, 6.1, 2.6, 4.5, 6.1 + 0.004, WING, 6.3, { faces: ['px'], tile: 'giftwall', rep: [1.2, WING], color: '#ffffff', outline: false });
    wall(b, { x0: 6, z0: Z0, x1: 6, z1: HZ1, y: WING, h: HALL - WING, t: 0.2, both: MB, name: 'w:right-up' });
    wall(b, { x0: X0, z0: 2, x1: -6, z1: 2, y: UP, h: HALL - UP, t: 0.2, n: AN, p: MB, name: 'w:ancient-front' });
    wall(b, { x0: X0, z0: 2, x1: -6, z1: 2, h: UP, t: 0.2, n: DM, p: SC, trim, open: [{ c: -9.0, w: 1.6, top: 2.6 }, { c: -11.0, w: 1.0, bottom: 1.0, top: 1.8 }], name: 'w:paint-sculpt' });
    wall(b, { x0: 6, z0: 2, x1: X1, z1: 2, h: WING, t: 0.2, n: M1, p: GW, trim, open: [{ c: 9.0, w: 1.6, top: 2.6 }], name: 'w:modern-gift' });
    yield 'hall';
    // hall / foyer: one great arch, the hall wall above it
    wall(b, { x0: -6, z0: HZ1, x1: 6, z1: HZ1, h: HALL, t: 0.3, n: MB, p: MB, trim, open: [{ c: 0, w: 7.6, top: 4.2 }], name: 'w:hall-front' });

    yield 'ceilings';
    // ── ceilings ──
    slab(b, -6, Z0, 6, HZ1, HALL + 0.15, { thick: 0.15, lid: true, under: { tile: 'coffer', rep: 2.0 }, name: 'ceil:hall' });
    for (let x = -4; x <= 4; x += 2) aabb(b, x - 0.1, HALL - 0.3, Z0, x + 0.1, HALL, HZ1, { color: '#d9cdb5', outline: true, collide: { wall: false, ceil: true, perch: true, name: 'perch:coffer-beam' } });
    for (let z = -6; z <= 2; z += 2) aabb(b, -6, HALL - 0.3, z - 0.1, 6, HALL, z + 0.1, { color: '#d9cdb5', outline: true, collide: { wall: false, ceil: true, perch: true, name: 'perch:coffer-beam' } });
    slab(b, X0, Z0, -6, 2, UP, { under: { color: '#f2e7da' }, edge: C.gold, name: 'ceil:paintings' });
    floor(b, X0, Z0, -6, 2, UP, { tile: 'mosaic', rep: 0.9 });
    slab(b, X0, 2, -6, Z1, UP + 0.15, { thick: 0.15, lid: true, under: { color: '#d0d4e6' }, name: 'ceil:sculpture' });
    slab(b, X0, Z0, -6, 2, HALL + 0.15, { thick: 0.15, lid: true, under: { tile: 'coffer', rep: 1.6 }, name: 'ceil:ancient' });
    slab(b, 6, Z0, X1, Z1, WING + 0.15, { thick: 0.15, lid: true, under: { color: '#f4f1ea' }, name: 'ceil:right-wing' });
    slab(b, -6, HZ1, 6, Z1, FOY + 0.15, { thick: 0.15, lid: true, under: { tile: 'coffer', rep: 1.4 }, name: 'ceil:foyer' });
    yield 'balcony across the';
    // balcony across the back of the hall + twin stairs
    slab(b, -6, Z0, 6, -5.0, UP, { under: { color: '#e6dccb' }, edge: C.gold, name: 'ceil:balcony' });
    floor(b, -6, Z0, 6, -5.0, UP, { tile: 'parquet', rep: 1.0 });
    const SR = UP / 20; const RUN = 0.3;
    for (const s of [-1, 1]) stairs(b, { x: s * 5.3, z: -5.0 + 20 * RUN, dir: 'z-', width: 1.25, n: 20, rise: SR, run: RUN, tread: { color: '#b3213a' }, stringer: C.gold, railSide: -s, rail: C.gold, name: 'grand-stairs' });
    railing(b, -4.62, -5.0, 4.62, -5.0, UP, { color: C.gold, top: C.gold, gap: 0.2, name: 'balcony' });
    for (const x of [-3.9, 3.9]) b.add(latheGeo([[0.32, 0], [0.26, 0.2], [0.24, UP - 0.4], [0.32, UP - 0.25], [0.36, UP - 0.2]], { radial: 14 }), { at: [x, 0, -5.25], color: C.marble, tile: 'marble', rep: 1.0, collide: { wall: true, perch: true, name: 'perch:column' } });
    yield 'tall hall columns';
    // tall hall columns along the sides (inside the stairs)
    for (const z of [-2.5, 0.5]) for (const x of [-3.9, 3.9]) b.add(latheGeo([[0.38, 0], [0.32, 0.25], [0.28, HALL - 0.6], [0.38, HALL - 0.4], [0.42, HALL - 0.3]], { radial: 16 }), { at: [x, 0, z], color: C.marble, tile: 'marble', rep: 1.2, collide: { wall: true, perch: true, name: 'perch:column' } });

    yield 'grand hall';
    // ── GRAND HALL: dinosaur skeleton on its plinth, velvet ropes, benches, signs ──
    const dz = -1.0;
    aabb(b, -3.0, 0, dz - 1.2, 3.0, 0.3, dz + 1.2, { color: '#3a3550', outline: true, collide: { wall: true, name: 'dino-plinth' } });
    aabb(b, -3.05, 0.3, dz - 1.25, 3.05, 0.34, dz + 1.25, { color: C.gold, outline: true, collide: { wall: false, name: 'dino-plinth-top' } });
    dino(b, 0, 0.34, dz);
    yield 'velvet ropes on';
    // velvet ropes on brass posts around the plinth
    const ropePosts = [[-3.6, dz - 1.7], [0, dz - 1.7], [3.6, dz - 1.7], [3.6, dz + 1.7], [0, dz + 1.7], [-3.6, dz + 1.7]];
    for (const [x, z] of ropePosts) {
      b.add(latheGeo([[0.14, 0], [0.12, 0.04], [0.03, 0.06], [0.03, 0.85], [0.05, 0.9], [0.0, 0.95]], { radial: 10 }), { at: [x, 0, z], color: C.brass, collide: { wall: false, perch: true, name: 'perch:rope-post' } });
    }
    const rope = (x0, z0, x1, z1) => {
      const n = 4;
      for (let i = 0; i < n; i++) {
        const t0 = i / n; const t1 = (i + 1) / n; const sag = (t) => 0.82 - Math.sin(t * Math.PI) * 0.18;
        const ax = x0 + (x1 - x0) * t0; const az = z0 + (z1 - z0) * t0; const bx = x0 + (x1 - x0) * t1; const bz = z0 + (z1 - z0) * t1;
        const ay = sag(t0); const by = sag(t1); const L = Math.hypot(bx - ax, by - ay, bz - az);
        const yaw = Math.atan2(bx - ax, bz - az); const pitch = Math.asin((by - ay) / L);
        b.add(cylGeo(0.025, 0.025, L, { radial: 6 }), { at: [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2], rot: [Math.PI / 2 - pitch, yaw, 0], color: C.velvet, outline: i % 2 === 0 });
      }
    };
    for (let i = 0; i < ropePosts.length; i++) { const [x0, z0] = ropePosts[i]; const [x1, z1] = ropePosts[(i + 1) % ropePosts.length]; if (!(i === 2 || i === 5)) rope(x0, z0, x1, z1); }
    b.collide(-3.65, 0.6, dz - 1.75, 3.65, 0.85, dz - 1.65, { wall: false, perch: true, name: 'perch:rope' });
    b.collide(-3.65, 0.6, dz + 1.65, 3.65, 0.85, dz + 1.75, { wall: false, perch: true, name: 'perch:rope' });
    yield 'dinosaur sign on';
    // dinosaur sign on a stand + two benches
    const ds = F(b, -2.0, 1.6, Math.PI);
    ds.box(1.2, 0.44, 0.05, [0, 1.15, 0], { color: '#ffffff', tile: 'signDino', rep: 1, fit: true, faces: ['pz', 'nz'], outline: true, rot: [-0.25, 0, 0] });
    ds.cyl(0.025, 0.025, 1.0, [0, 0.5, 0.05], { color: C.brass, radial: 6, collide: { wall: false, perch: true, name: 'perch:sign-stand' } });
    ds.cyl(0.18, 0.2, 0.03, [0, 0.015, 0.05], { color: C.brass });
    for (const x of [-1.6, 1.6]) {
      const bn = F(b, x, 2.2);
      bn.box(1.6, 0.12, 0.5, [0, 0.42, 0], { color: C.velvet, round: 0.04, collide: { wall: false, ceil: true, name: 'bench' } });
      for (const sx of [-0.7, 0.7]) bn.box(0.1, 0.36, 0.42, [sx, 0.18, 0], { color: C.gold, collide: { wall: true, name: 'bench-leg' } });
      bn.blob(0, 0, 0.9, 0.35);
    }
    yield 'hanging banners in';
    // hanging banners in the hall (huge patterns to cling to, landmarks from the balcony)
    for (const [x, tile, col] of [[-4.7, 'bannerA', C.velvet], [4.7, 'bannerB', C.navy]]) {
      b.add(boxGeo(0.03, 2.8, 1.5, { fit: true }), { at: [x, HALL - 1.75, -1.0], color: '#ffffff', tile, rep: 1, outline: true, collide: { wall: true, name: 'banner' } });
      aabb(b, x - 0.04, HALL - 0.38, -1.85, x + 0.04, HALL - 0.32, -0.15, { color: C.gold, outline: true, collide: { wall: false, perch: true, name: 'perch:banner-rod' } });
      for (const z of [-1.7, -0.3]) b.add(cylGeo(0.006, 0.006, 0.32, { radial: 3, caps: false }), { at: [x, HALL - 0.18, z], color: C.ink, outline: false });
      void col;
    }
    yield 'paintings on the';
    // paintings on the hall walls: under the balcony and high on the side walls
    picture(b, -2.6, 1.7, Z0 + 0.01, 1.4, 1.0, 'z+', 'art10', { frame: C.gold, depth: 0.06 });
    picture(b, 2.6, 1.7, Z0 + 0.01, 1.4, 1.0, 'z+', 'art5', { frame: C.gold, depth: 0.06 });
    picture(b, -5.89, 5.0, -1.0, 2.0, 1.4, 'x+', 'art2', { frame: C.gold, depth: 0.06 });
    picture(b, 5.89, 5.0, -1.0, 2.0, 1.4, 'x-', 'art6', { frame: C.gold, depth: 0.06 });
    yield 'a display case';
    // a display case of fossils under the balcony
    const fc = F(b, 0, -7.3);
    fc.box(2.4, 0.9, 0.8, [0, 0.45, 0], { color: C.navy, collide: { wall: true, name: 'fossil-case' } });
    fc.box(2.3, 0.45, 0.7, [0, 1.13, 0], { color: '#cfe8e4', collide: { wall: true, climb: false, name: 'glass-case' } });
    for (let i = 0; i < 5; i++) fc.sph(0.12, 0.06, 0.1, [-0.9 + i * 0.45, 0.96, 0], { color: [C.bone, C.boneD, '#c9b48a', C.bone, '#b8a070'][i], w: 8, h: 5 });
    fc.blob(0, 0, 1.4, 0.5);
    yield 'track lights on';
    // track lights on the coffer beams
    for (const x of [-2, 2]) for (const z of [-4, 0]) b.add(cylGeo(0.07, 0.1, 0.22, { radial: 8 }), { at: [x, HALL - 0.42, z], color: C.ink, rot: [0.4, 0, 0] });

    yield 'paintings gallery';
    // ── PAINTINGS GALLERY (left, ground) ──
    const paint = [['art1', 1.5, 1.1], ['art3', 0.9, 1.2], ['art7', 1.2, 0.9], ['art8', 1.4, 1.0], ['art2', 1.2, 0.9]];
    picture(b, -9.0, 1.7, Z0 + 0.01, 1.8, 1.3, 'z+', 'art1', { frame: C.gold, depth: 0.06 });
    picture(b, X0 + 0.01, 1.6, -5.4, 1.0, 1.3, 'x+', 'art3', { frame: C.gold, depth: 0.06 });
    picture(b, X0 + 0.01, 1.6, -1.6, 1.3, 1.0, 'x+', 'art7', { frame: C.gold, depth: 0.06 });
    picture(b, -6.11, 1.6, -5.6, 1.4, 1.0, 'x-', 'art8', { frame: C.gold, depth: 0.06 });
    picture(b, -9.0, 1.6, 1.89, 1.2, 0.9, 'z-', 'art2', { frame: C.gold, depth: 0.06 });
    void paint;
    yield 'a big easel';
    // a big easel painting mid-room (walk round it), ottoman bench, rope barrier
    const ea = F(b, -9.0, -3.2, 0.5);
    for (const sx of [-1, 1]) ea.box(0.06, 2.0, 0.06, [sx * 0.5, 1.0, 0], { color: C.wood, rot: [0.1, 0, sx * -0.08], collide: false });
    ea.box(0.06, 1.9, 0.06, [0, 0.95, -0.5], { color: C.wood, rot: [-0.3, 0, 0] });
    ea.box(1.2, 0.9, 0.05, [0, 1.35, 0.08], { tile: 'art6', rep: 1, fit: true, color: '#ffffff', rot: [0.1, 0, 0] });
    ea.box(1.1, 0.06, 0.14, [0, 0.86, 0.12], { color: C.wood, collide: { wall: false, perch: true, name: 'perch:easel' } });
    ea.collide(-0.6, 0, -0.55, 0.6, 1.9, 0.18, { wall: true, name: 'easel' });
    ea.blob(0, -0.15, 0.7, 0.5);
    const ot = F(b, -9.2, -0.6);
    ot.box(1.8, 0.4, 0.7, [0, 0.2, 0], { color: '#ffffff', tile: 'damask', rep: 0.7, round: 0.06, collide: { wall: true, name: 'ottoman' } });
    ot.blob(0, 0, 1.0, 0.45);
    rug(b, -9.0, -3.0, 4.0, 7.0, 0, 'meander', { rep: 1.2, color: '#e8dcc0' });
    yield 'sculpture room';
    // ── SCULPTURE ROOM (left front) ──
    const plinth = (x, z, h, shape, col) => {
      aabb(b, x - 0.3, 0, z - 0.3, x + 0.3, h, z + 0.3, { color: C.white, outline: true, collide: { wall: true, name: 'plinth' } });
      if (shape === 'ball') b.add(sphereGeo(0.24, 0.24, 0.24, { w: 12, h: 8 }), { at: [x, h + 0.24, z], color: col, collide: true });
      else if (shape === 'cone') b.add(cylGeo(0.0, 0.26, 0.6, { radial: 12 }), { at: [x, h + 0.3, z], color: col, collide: true });
      else if (shape === 'ring') b.add(latheGeo([[0.2, 0], [0.3, 0.1], [0.2, 0.2], [0.1, 0.1], [0.2, 0]], { radial: 14 }), { at: [x, h, z], color: col, rot: undefined, collide: true });
      else if (shape === 'stack') { for (let k = 0; k < 3; k++) b.add(boxGeo(0.34 - k * 0.07, 0.18, 0.34 - k * 0.07), { at: [x, h + 0.09 + k * 0.18, z], yaw: k * 0.5, color: [C.red, C.yellow, C.blue][k], collide: k === 0 }); }
      else if (shape === 'head') { b.add(sphereGeo(0.18, 0.24, 0.2, { w: 12, h: 8 }), { at: [x, h + 0.36, z], color: col, collide: true }); b.add(cylGeo(0.08, 0.12, 0.14, { radial: 10 }), { at: [x, h + 0.07, z], color: col }); }
      b.blob(x, z, 0.4, 0.4, { a: 0.28 });
    };
    plinth(-10.6, 3.6, 0.9, 'head', C.marble); plinth(-8.6, 4.4, 0.6, 'ball', C.blue); plinth(-7.2, 6.6, 1.1, 'cone', C.gold);
    plinth(-10.8, 6.8, 0.7, 'stack', C.red); plinth(-9.0, 7.0, 0.5, 'ring', C.pink);
    yield 'a big reclining';
    // a big reclining figure on a low block
    aabb(b, -9.6, 0, 5.4, -7.6, 0.45, 6.0, { color: C.stone, outline: true, collide: { wall: true, name: 'figure-block' } });
    b.add(sphereGeo(0.9, 0.35, 0.28, { w: 14, h: 8 }), { at: [-8.6, 0.72, 5.7], color: '#9fb4c7', rot: [0, 0, 0.15], collide: { wall: true, name: 'figure' } });
    b.add(sphereGeo(0.22, 0.24, 0.22, { w: 10, h: 8 }), { at: [-7.7, 1.0, 5.7], color: '#9fb4c7' });
    b.blob(-8.6, 5.7, 1.2, 0.5);

    yield 'ancient worlds';
    // ── ANCIENT WORLDS (upstairs left) ──
    const U = UP;
    const sa = F(b, -9.0, -3.0, 0, U);
    sa.box(0.9, 0.6, 2.2, [0, 0.3, 0], { color: '#ffffff', tile: 'sarc', rep: [0.9, 0.6], round: 0.12, seg: 1, collide: { wall: true, name: 'sarcophagus' } });
    sa.box(0.8, 0.12, 2.1, [0, 0.66, 0], { color: C.gold, round: 0.06 });
    sa.sph(0.28, 0.12, 0.3, [0, 0.74, -0.75], { color: C.gold, w: 10, h: 6 });
    sa.blob(0, 0, 0.6, 1.3);
    for (const [x, z, s, col] of [[-11.3, -7.2, 1.0, '#c8693f'], [-11.3, -5.6, 0.8, '#2f8f8f'], [-7.0, -7.3, 1.2, '#c8693f'], [-11.2, 1.0, 0.9, '#1f2a44'], [-7.2, 1.2, 0.7, '#d9a63a']]) {
      aabb(b, x - 0.35, U, z - 0.35, x + 0.35, U + 0.5, z + 0.35, { color: C.stone, outline: true, collide: { wall: true, name: 'vase-plinth' } });
      b.add(latheGeo([[0.12 * s, 0], [0.22 * s, 0.15 * s], [0.26 * s, 0.4 * s], [0.12 * s, 0.7 * s], [0.1 * s, 0.82 * s], [0.16 * s, 0.9 * s]], { radial: 14 }), { at: [x, U + 0.5, z], color: col, tile: 'meander', rep: [0.5, 0.45 * s], collide: { wall: true, name: 'vase' } });
      b.blob(x, z, 0.45, 0.45, { y: U + 0.004 });
    }
    yield 'broken columns';
    // broken columns + a mosaic panel + a gold mask in a case
    for (const [x, z, h] of [[-10.6, -1.0, 1.4], [-7.4, -1.0, 0.9], [-10.6, -4.8, 2.1]]) b.add(cylGeo(0.26, 0.28, h, { radial: 14 }), { at: [x, U + h / 2, z], color: C.marble, tile: 'rings', rep: [0.4, 0.3], collide: { wall: true, perch: true, name: 'perch:broken-column' } });
    const mc = F(b, -7.4, -5.2, 0, U);
    mc.box(0.8, 0.9, 0.6, [0, 0.45, 0], { color: C.navy, collide: { wall: true, name: 'mask-case' } });
    mc.box(0.7, 0.5, 0.5, [0, 1.15, 0], { color: '#cfe8e4', collide: { wall: true, climb: false, name: 'glass-case' } });
    mc.sph(0.16, 0.2, 0.08, [0, 1.12, 0.1], { color: C.gold });
    mc.blob(0, 0, 0.5, 0.4);
    aabb(b, X0, U + 0.6, -7.4, X0 + 0.03, U + 2.4, -4.4, { faces: ['px'], tile: 'mosaic', rep: 0.5, color: '#ffffff', outline: true });
    b.add(boxGeo(2.0, 0.66, 0.04, { fit: true, faces: ['nz'] }), { at: [-9.0, U + 2.6, 2 - 0.12], color: '#ffffff', tile: 'signAncient', rep: 1, outline: false });
    yield 'sign at the';
    // sign at the balcony door
    b.add(boxGeo(0.04, 0.5, 1.5, { fit: true, faces: ['px'] }), { at: [-5.88, U + 2.7, -6.6], color: '#ffffff', tile: 'signAncient', rep: 1, outline: false });

    yield 'modern art';
    // ── MODERN ART (right, ground) ──
    picture(b, 9.0, 1.75, Z0 + 0.01, 2.2, 1.6, 'z+', 'art4', { frame: C.ink, depth: 0.05 });
    picture(b, X1 - 0.01, 1.7, -4.8, 1.6, 1.6, 'x-', 'art5', { frame: '#ffffff', depth: 0.05 });
    picture(b, X1 - 0.01, 1.6, -1.2, 1.2, 1.4, 'x-', 'art10', { frame: C.ink, depth: 0.05 });
    picture(b, 6.11, 1.6, -5.5, 1.4, 1.0, 'x+', 'art9', { frame: C.yellow, depth: 0.05 });
    yield 'colourful sculptures';
    // colourful sculptures: a giant red cube, a stack of rings, a yellow arch you can walk through
    aabb(b, 7.4, 0, -6.4, 8.4, 1.0, -5.4, { color: C.red, outline: true, collide: { wall: true, name: 'red-cube' } });
    for (let k = 0; k < 4; k++) b.add(latheGeo([[0.35 - k * 0.05, 0], [0.45 - k * 0.05, 0.08], [0.35 - k * 0.05, 0.16], [0.25 - k * 0.05, 0.08], [0.35 - k * 0.05, 0]], { radial: 16 }), { at: [10.4, k * 0.16, -2.6], color: [C.blue, C.pink, C.yellow, C.teal][k], collide: k === 0 ? { wall: true, name: 'rings' } : false });
    b.collide(10.0, 0, -3.0, 10.8, 0.64, -2.2, { wall: true, name: 'rings-stack' });
    for (const x of [8.0, 9.6]) aabb(b, x - 0.15, 0, -0.4, x + 0.15, 2.0, -0.1, { color: C.yellow, outline: true, collide: { wall: true, perch: true, name: 'arch-leg' } });
    aabb(b, 7.85, 2.0, -0.4, 9.75, 2.3, -0.1, { color: C.yellow, outline: true, collide: { wall: false, ceil: true, perch: true, name: 'perch:arch' } });
    b.blob(8.8, -0.25, 1.1, 0.3);
    yield 'hanging mobile';
    // hanging mobile (perch on the arms)
    const mx = 9.0; const mz = -3.6;
    b.add(cylGeo(0.006, 0.006, 0.8, { radial: 4, caps: false }), { at: [mx, WING - 0.4, mz], color: C.ink, outline: false });
    for (const [dx, y, L, col] of [[0, WING - 0.8, 1.6, C.ink], [0.6, WING - 1.2, 1.0, C.ink]]) {
      aabb(b, mx + dx - L / 2, y - 0.015, mz - 0.015, mx + dx + L / 2, y + 0.015, mz + 0.015, { color: col, outline: false, collide: { wall: false, perch: true, name: 'perch:mobile' } });
    }
    for (const [dx, y, rr, col] of [[-0.8, WING - 1.05, 0.2, C.red], [0.1, WING - 1.5, 0.16, C.blue], [1.1, WING - 1.45, 0.14, C.yellow], [0.6, WING - 0.9, 0.0, C.ink]]) {
      if (!rr) continue;
      b.add(cylGeo(0.004, 0.004, 0.25, { radial: 3, caps: false }), { at: [mx + dx, y + 0.12, mz], color: C.ink, outline: false });
      b.add(cylGeo(rr, rr, 0.02, { radial: 16 }), { at: [mx + dx, y - rr * 0.2, mz], rot: [Math.PI / 2, 0.3, 0], color: col });
    }
    b.add(boxGeo(2.0, 0.66, 0.04, { fit: true, faces: ['pz'] }), { at: [9.0, 2.95, 1.88], color: '#ffffff', tile: 'signModern', rep: 1, outline: false });
    rug(b, 9.4, -3.2, 2.4, 2.4, 0, 'modern2', { rep: 0.8 });

    yield 'gift shop';
    // ── GIFT SHOP (right front) ──
    const gs = F(b, X1 - 0.3, 4.8, -Math.PI / 2);
    const gy = shelves(gs, 3.6, 1.9, 0.5, 4, { color: C.white, tile: null, name: 'gift-shelf' });
    gy.slice(0, 3).forEach((y, i) => {
      for (let k = 0; k < 6; k++) {
        if (i === 1 && k === 3) continue;
        const lx = -1.5 + k * 0.6;
        if (i === 0) { gs.sph(0.14, 0.12, 0.2, [lx, y + 0.13, 0.02], { color: '#ffffff', tile: 'plush', rep: 0.15, w: 8, h: 6 }); gs.sph(0.07, 0.07, 0.09, [lx, y + 0.26, 0.15], { color: C.lime, w: 6, h: 5 }); }
        else if (i === 1) gs.cyl(0.07, 0.07, 0.14, [lx, y + 0.08, 0.05], { color: [C.red, C.blue, C.yellow, C.teal, C.pink, C.purple][k], radial: 8 });
        else gs.box(0.36, 0.26, 0.16, [lx, y + 0.15, 0], { color: [C.navy, C.pink, C.teal, C.yellow, C.red, C.lime][k], tile: 'postcards', rep: [0.4, 0.26] });
      }
    });
    yield 'postcard spinner counter';
    // postcard spinner, counter + till, giant inflatable T-rex
    const ps = F(b, 8.2, 3.4);
    ps.cyl(0.03, 0.03, 1.6, [0, 0.8, 0], { color: C.ink, radial: 6, collide: { wall: false, perch: true, name: 'perch:spinner' } });
    for (let k = 0; k < 4; k++) ps.box(0.5, 1.0, 0.04, [Math.sin(k * Math.PI / 2) * 0.16, 1.05, Math.cos(k * Math.PI / 2) * 0.16], { color: '#ffffff', tile: 'postcards', rep: [0.5, 0.25], uvOff: [k * 0.3, 0], yaw: k * Math.PI / 2 });
    ps.collide(-0.3, 0.5, -0.3, 0.3, 1.6, 0.3, { wall: true, name: 'spinner' });
    ps.cyl(0.25, 0.28, 0.04, [0, 0.02, 0], { color: C.ink });
    ps.blob(0, 0, 0.35, 0.35);
    const ct = F(b, 7.4, 6.6, Math.PI / 2);
    ct.box(2.0, 0.95, 0.7, [0, 0.475, 0], { color: C.pink, tile: 'giftwall', rep: [1.0, 0.95], collide: { wall: true, name: 'gift-counter' } });
    ct.box(2.06, 0.05, 0.76, [0, 0.97, 0], { color: C.white });
    ct.box(0.34, 0.22, 0.3, [0.5, 1.1, 0], { color: C.ink, collide: { wall: true, name: 'till' } });
    ct.box(1.6, 0.5, 0.04, [0, 2.7, 0.0], { color: '#ffffff', tile: 'signGift', rep: 1, fit: true, faces: ['pz', 'nz'], outline: true });
    ct.blob(0, 0, 1.2, 0.45);
    trex(b, 10.0, 7.0, -2.3);
    stack(F(b, 6.9, 2.6), 0, 0, [[0.6, 0.3, 0.45, C.yellow, 'postcards'], [0.5, 0.28, 0.4, C.teal, null, 0.2], [0.42, 0.26, 0.36, C.pink, 'plush', -0.15]]);

    yield 'foyer';
    // ── FOYER (front middle): ticket desk, turnstiles, coat rail, info board ──
    const td = F(b, -3.8, 6.0);
    td.box(2.2, 1.0, 0.7, [0, 0.5, 0], { color: C.teal, round: 0.04, collide: { wall: true, name: 'ticket-desk' } });
    td.box(2.3, 0.05, 0.8, [0, 1.02, 0], { color: C.marble });
    td.box(1.6, 0.5, 0.04, [0, 2.4, 0.2], { color: '#ffffff', tile: 'signTix', rep: 1, fit: true, faces: ['pz', 'nz'], outline: true });
    td.cyl(0.006, 0.006, FOY - 2.65, [-0.6, (FOY + 2.65) / 2, 0.2], { color: C.ink, radial: 3, outline: false });
    td.cyl(0.006, 0.006, FOY - 2.65, [0.6, (FOY + 2.65) / 2, 0.2], { color: C.ink, radial: 3, outline: false });
    td.box(0.3, 0.25, 0.25, [0.6, 1.17, 0], { color: C.ink }); td.box(0.25, 0.2, 0.02, [-0.4, 1.15, 0.1], { color: '#ffffff', tile: 'postcards', rep: 0.3 });
    td.blob(0, 0, 1.3, 0.5);
    for (const x of [1.4, 2.6, 3.8]) {
      const tg = F(b, x, 4.6);
      tg.box(0.18, 0.95, 0.6, [0, 0.475, 0], { color: '#9aa7ad', collide: { wall: true, name: 'turnstile' } });
      tg.box(0.2, 0.05, 0.62, [0, 0.97, 0], { color: C.teal });
      tg.box(0.5, 0.04, 0.04, [0.3, 0.85, 0.0], { color: C.brass });
      tg.blob(0, 0, 0.2, 0.35);
    }
    const crk = F(b, 5.4, 7.2, -Math.PI / 2);
    crk.box(1.6, 0.04, 0.04, [0, 1.7, 0], { color: C.brass, collide: { wall: false, perch: true, name: 'perch:coat-rail' } });
    for (const sx of [-0.78, 0.78]) crk.box(0.04, 1.7, 0.04, [sx, 0.85, 0], { color: C.brass });
    [[C.velvet, 0.9], [C.navy, 1.0], [C.yellow, 0.8], [C.teal, 0.95]].forEach(([col, h2], i) => crk.box(0.38, h2, 0.12, [-0.55 + i * 0.37, 1.68 - h2 / 2, 0], { color: col, round: 0.04 }));
    crk.collide(-0.8, 0.6, -0.1, 0.8, 1.7, 0.1, { wall: true, name: 'coats' });
    crk.blob(0, 0, 0.9, 0.2);
    rug(b, 0, 6.6, 3.0, 1.6, 0, 'meander', { rep: 1.0, color: '#ffffff' });
    for (const x of [-5.2, 5.2]) { b.add(cylGeo(0.3, 0.26, 0.6, { radial: 14 }), { at: [x, 0.3, 3.6], color: C.gold, tile: 'rings', rep: [0.4, 0.3], collide: { wall: true, name: 'urn' } }); b.add(sphereGeo(0.32, 0.36, 0.32, { w: 10, h: 7 }), { at: [x, 0.95, 3.6], color: '#3f7d4a' }); b.blob(x, 3.6, 0.35, 0.35); }

    yield 'spots';
    // ── spots ──
    b.spot('lobby', { x: 0, z: 6.4 });
    b.spot('hiderSpawn', { x: 0, z: 1.65, yaw: Math.PI });
    b.spot('seekerSpawn', { x: 0, z: 7.0, yaw: Math.PI });
    b.spot('spawnA', { x: -1.2, z: 5.0, yaw: Math.PI });
    b.spot('spawnB', { x: 1.2, z: 5.6, yaw: Math.PI });
    b.spot('hiderSpawns', [{ x: 0, z: 1.65, yaw: Math.PI }, { x: -9.0, z: -5.6, yaw: 0 }, { x: 9.4, z: -1.6, yaw: 0 }, { x: 0, z: -6.4, y: UP, yaw: Math.PI }, { x: -9.0, z: -0.4, y: UP, yaw: 0 }]);
    b.spot('seekerSpawns', [{ x: 0, z: 7.0, yaw: Math.PI }, { x: -1.6, z: 6.8, yaw: Math.PI }, { x: 1.6, z: 6.6, yaw: Math.PI }]);
    b.spot('camo', { x: -9.0, z: Z0 + 0.3, y: 0.4, wallNormal: [0, 0, 1], note: 'damask wall of the paintings gallery' });
    b.spot('rug', { x: 0, z: 6.6, yaw: 0 });
    b.probe('ticket-desk-teal', [-3.8 + 1.1 + 0.001, 0.4, 6.0], [1, 0, 0], C.teal);
  };
}

/** T-rex skeleton facing −x: bones in cream, steel supports. Origin = plinth top centre. */
function dino(b, x, y, z) {
  const bone = C.bone; const r = seeded('dino');
  // spine: vertebrae along a curve from the tail tip (+x) to the neck (−x)
  const spine = [];
  for (let i = 0; i <= 22; i++) {
    const t = i / 22; const sx = 3.0 - t * 4.8;
    const sy = t < 0.55 ? 0.9 + Math.sin(t / 0.55 * Math.PI / 2) * 1.35 : 2.25 + Math.sin((t - 0.55) / 0.45 * Math.PI / 2) * 0.35;
    spine.push([x + sx, y + sy, z]);
  }
  spine.forEach(([sx, sy, sz], i) => {
    const s = 0.07 + Math.min(i, 14) * 0.006;
    b.add(sphereGeo(s * 1.2, s, s, { w: 8, h: 5 }), { at: [sx, sy, sz], color: i % 2 ? bone : C.boneD });
    if (i % 2 === 0 && i > 4) b.add(boxGeo(0.04, s * 2.2, 0.06), { at: [sx, sy + s * 1.4, sz], color: bone, outline: false });
  });
  // skull + jaw + eye hole
  const [hx, hy] = [x - 2.15, y + 2.55];
  b.add(boxGeo(0.75, 0.38, 0.34, { round: 0.08 }), { at: [hx, hy, z], color: bone, rot: [0, 0, 0.12], collide: { wall: true, name: 'skull' } });
  b.add(boxGeo(0.7, 0.12, 0.3, { round: 0.04 }), { at: [hx - 0.02, hy - 0.3, z], color: C.boneD, rot: [0, 0, 0.32] });
  for (const s of [-1, 1]) b.add(sphereGeo(0.06, 0.07, 0.03, { w: 8, h: 5 }), { at: [hx + 0.15, hy + 0.06, z + s * 0.17], color: C.ink, outline: false });
  for (let k = 0; k < 6; k++) b.add(cylGeo(0.0, 0.02, 0.07, { radial: 4 }), { at: [hx - 0.3 + k * 0.1, hy - 0.2, z + 0.12], rot: [Math.PI, 0, 0], color: '#ffffff', outline: false });
  // ribs: pairs of curved bars under the back
  for (let k = 0; k < 7; k++) {
    const [sx, sy] = spine[9 + k];
    for (const s of [-1, 1]) {
      b.add(boxGeo(0.05, 0.6 - k * 0.03, 0.05), { at: [sx, sy - 0.25, z + s * 0.2], rot: [s * 0.35, 0, 0.1], color: bone, outline: true });
      b.add(boxGeo(0.05, 0.3, 0.05), { at: [sx - 0.05, sy - 0.62, z + s * 0.2], rot: [-s * 0.3, 0, 0.1], color: bone, outline: false });
    }
  }
  b.collide(x - 1.0, y + 1.3, z - 0.3, x + 0.2, y + 2.4, z + 0.3, { wall: true, name: 'ribcage' });
  // pelvis + legs
  b.add(boxGeo(0.5, 0.35, 0.42, { round: 0.06 }), { at: [x + 0.35, y + 1.95, z], color: C.boneD, collide: { wall: true, name: 'pelvis' } });
  for (const s of [-1, 1]) {
    const lz = z + s * 0.3;
    b.add(cylGeo(0.07, 0.09, 0.95, { radial: 8 }), { at: [x + 0.3, y + 1.45, lz], rot: [0, 0, -0.35], color: bone });
    b.add(cylGeo(0.05, 0.07, 0.9, { radial: 8 }), { at: [x + 0.32, y + 0.6, lz], rot: [0, 0, 0.3], color: bone });
    b.add(boxGeo(0.4, 0.06, 0.18), { at: [x + 0.1, y + 0.05, lz], color: C.boneD });
    b.collide(x + 0.05, y, lz - 0.08, x + 0.6, y + 1.9, lz + 0.08, { wall: true, perch: true, name: 'perch:dino-leg' });
  }
  // tiny arms
  for (const s of [-1, 1]) b.add(cylGeo(0.025, 0.03, 0.35, { radial: 6 }), { at: [x - 1.35, y + 1.95, z + s * 0.15], rot: [s * 0.4, 0, 0.9], color: bone });
  // steel supports + spine collider (perch along the back)
  for (const sx of [-1.2, 1.4]) b.add(cylGeo(0.025, 0.025, 2.1, { radial: 6 }), { at: [x + sx, y + 1.05, z], color: '#5a5560' });
  b.collide(x - 1.9, y + 2.2, z - 0.1, x + 0.6, y + 2.5, z + 0.1, { wall: false, perch: true, name: 'perch:dino-spine' });
  b.collide(x + 0.6, y + 0.9, z - 0.08, x + 3.1, y + 2.1, z + 0.08, { wall: true, perch: true, name: 'perch:dino-tail' });
  b.blob(x + 0.3, z, 2.2, 0.8, { y: y + 0.004, a: 0.22 });
  void r;
}

/** Giant inflatable T-rex toy in the gift shop (a big green blob to hide against). */
function trex(b, x, z, yaw) {
  const f = F(b, x, z, yaw);
  f.sph(0.55, 0.6, 0.45, [0, 0.95, 0], { color: '#ffffff', tile: 'plush', rep: 0.3, w: 12, h: 8, collide: { wall: true, name: 'trex-body' } });
  f.sph(0.3, 0.3, 0.32, [0, 1.75, 0.25], { color: '#ffffff', tile: 'plush', rep: 0.3, w: 10, h: 7, collide: { wall: true, name: 'trex-head' } });
  f.sph(0.22, 0.12, 0.3, [0, 1.65, 0.55], { color: C.lime, w: 8, h: 6 });
  for (const s of [-1, 1]) { f.sph(0.06, 0.06, 0.06, [s * 0.16, 1.88, 0.42], { color: '#ffffff', w: 6, h: 5 }); f.cyl(0.12, 0.15, 0.55, [s * 0.25, 0.28, 0.05], { color: C.green, collide: true }); }
  f.sph(0.15, 0.15, 0.55, [0, 0.55, -0.6], { color: C.green, rot: [0.6, 0, 0], w: 8, h: 6 });
  f.blob(0, 0, 0.7, 0.7);
}

export const MUSEUM = {
  id: 'museum', name: 'Museum Night', blurb: 'A T-rex under a coffered ceiling, galleries of bold paintings and a gift shop.',
  build, size: 'XL', rooms: 8, climbs: 3,
  info: {
    w: W, d: D,
    floors: [{ y: 0, name: 'Ground' }, { y: UP, name: 'Upstairs' }],
    rooms: [
      { name: 'Grand Hall', floor: 0, y: 0, x0: -6, z0: Z0, x1: 6, z1: HZ1, landmark: 'the T-rex skeleton' },
      { name: 'Balcony', floor: 1, y: UP, x0: -6, z0: Z0, x1: 6, z1: -5.0, landmark: 'gold railing over the dinosaur' },
      { name: 'Paintings', floor: 0, y: 0, x0: X0, z0: Z0, x1: -6, z1: 2, landmark: 'red damask and the starry night' },
      { name: 'Sculpture room', floor: 0, y: 0, x0: X0, z0: 2, x1: -6, z1: Z1, landmark: 'the reclining blue figure' },
      { name: 'Ancient Worlds', floor: 1, y: UP, x0: X0, z0: Z0, x1: -6, z1: 2, landmark: 'the gold sarcophagus' },
      { name: 'Modern art', floor: 0, y: 0, x0: 6, z0: Z0, x1: X1, z1: 2, landmark: 'giant red cube and the mobile' },
      { name: 'Gift shop', floor: 0, y: 0, x0: 6, z0: 2, x1: X1, z1: Z1, landmark: 'the inflatable T-rex' },
      { name: 'Foyer', floor: 0, y: 0, x0: -6, z0: HZ1, x1: 6, z1: Z1, landmark: 'TICKETS desk and the turnstiles' },
    ],
    overview: { y: 10, radius: 14 },
    cams: [
      { name: 'overview', p: [0, 15, 19], t: [0, 1.5, -1] },
      { name: 'hall', p: [0, 1.6, 2.6], t: [0, 2.4, -5] },
      { name: 'hall-up', p: [-5.0, 4.6, -6.5], t: [3, 2.0, 1] },
      { name: 'ceiling', p: [-2, 1.0, 1.5], t: [0, 6.5, -3] },
      { name: 'paintings', p: [-6.8, 1.6, 1.4], t: [-10.5, 1.2, -6] },
      { name: 'sculpture', p: [-6.6, 1.6, 2.6], t: [-10, 0.8, 6.5] },
      { name: 'ancient', p: [-6.6, 5.0, -7.4], t: [-10, 3.8, 0] },
      { name: 'modern', p: [11.3, 1.8, 1.4], t: [7.4, 1.0, -6] },
      { name: 'giftshop', p: [6.6, 1.7, 2.6], t: [10.5, 0.9, 6.8] },
      { name: 'foyer', p: [5.4, 1.8, 3.4], t: [-4, 0.8, 6.5] },
    ],
  },
};
