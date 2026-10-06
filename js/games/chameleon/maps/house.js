// THE WHOLE HOUSE — two floors and an attic-under-the-eaves, 18 × 12 m footprint.
//
//   Upstairs (y 2.8)   Bedroom | Landing | Attic (beams)          (stairwell open to the roof)
//   Ground   (y 0)     Kitchen | Hall    | Stairwell (5.4 m, chandelier)
//                      Dining  | Hall    | Laundry | Bathroom
//
// x runs left→right (−9 … 9), z back→front (−6 … 6). The front wall is low on both floors so the
// diorama reads from outside. Loops: kitchen↔hall↔dining↔kitchen, hall↔laundry↔bathroom↔stairwell↔hall,
// landing↔bedroom↔closet↔landing. The stairwell's open treads, the gallery railings and the attic
// balcony give long see-through sightlines between floors.
import { boxGeo, cylGeo, sphereGeo, latheGeo } from '../geo.js';
import { P } from '../atlas.js';
import { seeded } from '../util.js';
import { Q } from './patterns.js';
import { F, aabb, wall, floor, slab, stairs, railing, picture, table, chair, shelves, pendant, rug, stack } from './lib.js';

const W = 18; const D = 12; const FH = 2.8; const UH = 2.6; const TOP = FH + UH; // 5.4
const X0 = -9; const X1 = 9; const Z0 = -6; const Z1 = 6;

const C = {
  ink: '#2a2730', cream: '#f6efe2', paper: '#f4efe6',
  red: '#e2493b', coral: '#e07a5f', orange: '#f28c38', mustard: '#e0a43d', yellow: '#f2c14e',
  green: '#3fa66b', sage: '#7fa89a', leaf: '#4f7d4f', teal: '#2f8f8f', blue: '#3f6fd1', sky: '#8fb3c9', navy: '#2f3f6d',
  pink: '#ef7fa8', rose: '#e8b4a0', plum: '#7b5ea7', lilac: '#b9a3d9', brown: '#7a4e35', wood: '#a8754d', woodL: '#c99a6b',
};

function build(atlas) {
  // ── atlas (≈ 7 L, 22 M, 6 S) ──
  atlas.add('planks', P.planks({ base: '#c99a6b', alt: '#b8875b', seam: '#8a5d3b', rows: 6 }), { size: 'L' });
  atlas.add('damask', Q.damask({ bg: '#2f5d73', fg: '#4f86a0', accent: C.mustard }), { size: 'L' });
  atlas.add('bedpaper', P.wallpaper({ bg: '#f6e3e0', stripe: C.rose, thin: C.plum, sprig: C.yellow, leaf: C.sage }), { size: 'L' });
  atlas.add('quilt', Q.quilt({ cols: [C.red, C.teal, C.mustard, C.blue, C.pink, C.green], bg: C.cream }), { size: 'L' });
  atlas.add('window', P.window({ sky: '#a9d2e6', cloud: '#ffffff', frame: '#f4efe6', hill: '#8fbf7a' }), { size: 'L', repeat: false });
  atlas.add('kilim', P.kilim({ field: C.red, border: '#f0d9a8', a: C.teal, b: C.mustard, c: '#f3e7cf', ink: C.ink }), { size: 'L', repeat: false });
  atlas.add('runner', P.stripes({ cols: [C.navy, C.cream, C.red, C.cream, C.mustard, C.cream], widths: [6, 1, 2, 1, 2, 1], n: 1 }), { w: 112, h: 112 });
  atlas.add('herring', P.herringbone({ a: '#c99a6b', b: '#b07a4f', seam: '#7a4e35' }), { size: 'M' });
  atlas.add('kfloor', P.checker({ a: '#2f8f8f', b: '#f3ead6', n: 4 }), { size: 'M' });
  atlas.add('bfloor', P.checker({ a: '#ef9fbf', b: '#fbf6ee', n: 6, grout: '#d9c8c0' }), { size: 'M' });
  atlas.add('subway', P.bricks({ brick: '#f8f5ee', alt: '#eef3f1', mortar: '#9cc7c0', rows: 8, cols: 4 }), { size: 'M' });
  atlas.add('kwall', P.check({ a: '#fbf3d9', b: C.mustard, n: 4 }), { size: 'M' });
  atlas.add('hallpaper', P.stripes({ cols: ['#e9f0e6', C.sage, '#e9f0e6', C.coral], widths: [5, 2, 1, 0.5], n: 2 }), { size: 'M' });
  atlas.add('laundry', P.dots({ bg: '#cfe0e6', fg: '#ffffff', n: 4, r: 0.18 }), { size: 'M' });
  atlas.add('closet', P.chevron({ cols: [C.lilac, '#f3e7ff', C.plum], n: 2 }), { size: 'M' });
  atlas.add('curtain', Q.floral({ bg: '#fff4d6', cols: [C.pink, C.blue, C.orange], leaf: C.green, n: 14 }), { size: 'M' });
  atlas.add('towel', P.stripes({ cols: [C.teal, '#ffffff', C.yellow, '#ffffff'], widths: [3, 1, 1, 1], n: 2 }), { size: 'M' });
  atlas.add('plaid', Q.plaid({ bg: '#c8463b', a: '#2f3f6d', b: '#f2c14e' }), { size: 'M' });
  atlas.add('argyle', Q.argyle({ a: '#f3e7cf', b: C.teal, c: C.coral, line: C.ink }), { size: 'M' });
  atlas.add('wood', P.wood({ n: 6 }), { size: 'M' });
  atlas.add('weave', P.weave({ n: 8, lo: 0.82 }), { size: 'M' });
  atlas.add('panel', Q.grid({ bg: '#ffffff', line: 'rgb(200,200,200)', n: 1, lw: 5 }), { size: 'M' });
  atlas.add('coffer', Q.grid({ bg: '#f4efe6', line: '#c9b8a0', n: 2, lw: 7 }), { size: 'M' });
  atlas.add('shingles', Q.shingles({ a: '#b84a3a', b: '#9c3d30', line: '#5a2a22' }), { size: 'M' });
  atlas.add('bricks', P.bricks({ brick: '#c8705a', alt: '#b5604b', mortar: '#ead9c4', rows: 8, cols: 4 }), { size: 'M' });
  atlas.add('terrazzo', Q.terrazzo({ bg: '#f1ece2', cols: [C.coral, C.teal, C.mustard, C.ink] }), { size: 'M' });
  atlas.add('chevron', P.chevron({ cols: [C.mustard, '#f3e7cf', C.teal], n: 2 }), { size: 'M' });
  atlas.add('pic1', Q.pic({ kind: 'portrait', cols: [C.sky, C.red, '#f2c9a8', C.brown] }), { size: 'M', repeat: false });
  atlas.add('pic2', Q.pic({ kind: 'landscape', cols: ['#bfe3f0', C.green, C.leaf] }), { size: 'M', repeat: false });
  atlas.add('pic3', Q.pic({ kind: 'cat', cols: [C.mustard, C.ink, '#9fe07a', C.pink] }), { size: 'M', repeat: false });
  atlas.add('pic4', Q.pic({ kind: 'still', cols: [C.teal, C.coral, C.red, C.yellow] }), { size: 'M', repeat: false });
  atlas.add('art', P.art({ style: 'blocks', cols: [C.red, C.blue, C.yellow] }), { size: 'M', repeat: false });
  atlas.add('spine', P.spine({ band: '#f6e7b8' }), { size: 'S', repeat: false });
  atlas.add('rings', P.rings({ n: 3 }), { size: 'S' });
  atlas.add('label', P.label({ bg: '#ffffff', band: C.blue, text: C.ink }), { size: 'S', repeat: false });
  atlas.add('dots', P.dots({ bg: C.red, fg: '#ffffff', n: 3, r: 0.2 }), { size: 'S' });
  atlas.add('stripe', P.stripes({ cols: [C.blue, '#ffffff'], n: 3 }), { size: 'S' });

  return (b) => {
    const r = seeded('house');
    const skin = (side, a0, a1, y0, y1, d, inset = 0) => {
      const o = { tile: d.tile, rep: d.rep || 1, color: d.color || '#ffffff', outline: false };
      const rep = o.rep; const e = 0.004 + inset;
      if (side === 'back') aabb(b, a0, y0, Z0, a1, y1, Z0 + e, { ...o, faces: ['pz'], uvOff: [a0 / rep, (y0 % FH) / rep] });
      if (side === 'left') aabb(b, X0, y0, a0, X0 + e, y1, a1, { ...o, faces: ['px'], uvOff: [-a1 / rep, (y0 % FH) / rep] });
      if (side === 'right') aabb(b, X1 - e, y0, a0, X1, y1, a1, { ...o, faces: ['nx'], uvOff: [a0 / rep, (y0 % FH) / rep] });
      if (side === 'front') aabb(b, a0, y0, Z1 - e, a1, y1, Z1, { ...o, faces: ['nz'], uvOff: [-a1 / rep, 0] });
    };
    const win = (side, c, y, w, h) => {
      const o = { tile: 'window', rep: 1, color: '#ffffff', outline: false, fit: true };
      if (side === 'back') aabb(b, c - w / 2, y, Z0, c + w / 2, y + h, Z0 + 0.012, { ...o, faces: ['pz'] });
      if (side === 'left') aabb(b, X0, y, c - w / 2, X0 + 0.012, y + h, c + w / 2, { ...o, faces: ['px'] });
      if (side === 'right') aabb(b, X1 - 0.012, y, c - w / 2, X1, y + h, c + w / 2, { ...o, faces: ['nx'] });
      // sill to perch on
      if (side === 'back') aabb(b, c - w / 2 - 0.08, y - 0.06, Z0, c + w / 2 + 0.08, y, Z0 + 0.12, { color: C.paper, collide: { wall: false, perch: true, name: 'perch:sill' } });
      if (side === 'left') aabb(b, X0, y - 0.06, c - w / 2 - 0.08, X0 + 0.12, y, c + w / 2 + 0.08, { color: C.paper, collide: { wall: false, perch: true, name: 'perch:sill' } });
      if (side === 'right') aabb(b, X1 - 0.12, y - 0.06, c - w / 2 - 0.08, X1, y, c + w / 2 + 0.08, { color: C.paper, collide: { wall: false, perch: true, name: 'perch:sill' } });
    };

    // ── shell: plinth, outer walls (bricks outside), low front ──
    const T = 0.16;
    b.add(boxGeo(W + 0.9, 0.36, D + 0.9, { round: 0.04 }), { at: [0, -0.2, 0], color: '#5a3d2b' });
    b.add(boxGeo(W + 1.6, 0.1, D + 2.2, {}), { at: [0, -0.33, 0.3], color: '#8cbf63', outline: false });
    aabb(b, X0 - T, 0, Z0 - T, X1 + T, TOP, Z0, { tile: 'bricks', rep: 0.9, color: '#ffffff', outline: false, collide: { wall: true, name: 'back' } });
    aabb(b, X0 - T, 0, Z0, X0, TOP, Z1, { tile: 'bricks', rep: 0.9, color: '#ffffff', outline: false, collide: { wall: true, name: 'left' } });
    aabb(b, X1, 0, Z0, X1 + T, TOP, Z1, { tile: 'bricks', rep: 0.9, color: '#ffffff', outline: false, collide: { wall: true, name: 'right' } });
    aabb(b, X0 - T, 0, Z1, X1 + T, 0.7, Z1 + T, { tile: 'bricks', rep: 0.9, color: '#ffffff', outline: true, collide: { wall: true, name: 'front' } });
    aabb(b, X0 - T, FH, Z1 - 0.02, X1 + T, FH + 0.7, Z1 + T, { color: '#f4efe6', outline: true, collide: { wall: true, name: 'front-up' } });
    b.collide(X0 - T, 0.7, Z1, X1 + T, TOP + 1, Z1 + 0.4, { wall: false, climb: false, name: 'front-guard' }); // invisible: no falling out of the diorama
    for (const [x, z] of [[X0 - T, Z0 - T], [X1 + T, Z0 - T]]) b.add(boxGeo(0.06, TOP, 0.06), { at: [x, TOP / 2, z], color: C.ink, outline: false });
    aabb(b, X0 - T - 0.01, TOP - 0.03, Z0 - T - 0.01, X1 + T + 0.01, TOP, Z0 + 0.01, { color: '#3a2f2a', outline: false, faces: ['py', 'pz', 'nz'] });
    aabb(b, X0 - T - 0.01, TOP - 0.03, Z0, X0 + 0.01, TOP, Z1, { color: '#3a2f2a', outline: false, faces: ['py', 'px', 'nx'] });
    aabb(b, X1 - 0.01, TOP - 0.03, Z0, X1 + T + 0.01, TOP, Z1, { color: '#3a2f2a', outline: false, faces: ['py', 'px', 'nx'] });

    // ── floors ──
    floor(b, -9, -6, -2.5, 0.5, 0, { tile: 'kfloor', rep: 1.2 });
    floor(b, -9, 0.5, -2.5, 6, 0, { tile: 'herring', rep: 1.1 });
    floor(b, -2.5, -6, 0.5, 6, 0, { tile: 'planks', rep: 1.4 });
    floor(b, 0.5, -6, 9, 0, 0, { tile: 'planks', rep: 1.4, color: '#e9d6c0' });
    floor(b, 0.5, 0, 4.5, 6, 0, { tile: 'terrazzo', rep: 1.0 });
    floor(b, 4.5, 0, 9, 6, 0, { tile: 'bfloor', rep: 0.9 });
    // upper slabs (ceilings of the ground floor) + their floor skins
    slab(b, -9, -6, 0.5, 6, FH, { under: { color: '#f7f1e6' }, edge: '#3a2f2a', name: 'ceil:ground-west' });
    slab(b, 0.5, 0, 9, 6, FH, { under: { color: '#f7f1e6' }, edge: '#3a2f2a', name: 'ceil:ground-east' });
    floor(b, -9, -6, -2.5, 1, FH, { tile: 'planks', rep: 1.3 });
    floor(b, -9, 1, -2.5, 6, FH, { tile: 'planks', rep: 1.3, color: '#e7d2ea' });
    floor(b, -2.5, -6, 0.5, 6, FH, { tile: 'planks', rep: 1.4 });
    floor(b, 0.5, 0, 9, 6, FH, { tile: 'planks', rep: 1.6, color: '#d9c6a6' });
    // lids: stairwell (coffered, chandelier) and bedroom (ceiling fan); shingles on top for the outside view
    slab(b, 0.5, -6, 9, 0, TOP + 0.2, { under: { tile: 'coffer', rep: 1.2 }, lid: true, name: 'ceil:stairwell' });
    slab(b, -9, -6, -2.5, 1, TOP + 0.2, { under: { color: '#fbf3ee' }, lid: true, name: 'ceil:bedroom' });

    // ── outer wall skins per room ──
    const K = { tile: 'kwall', rep: 0.7 }; const DM = { tile: 'damask', rep: 1.1 }; const HL = { tile: 'hallpaper', rep: 0.9 };
    const SW = { color: '#f2e6d6' }; const LA = { tile: 'laundry', rep: 0.6 }; const BA = { tile: 'subway', rep: 0.55 };
    const BR = { tile: 'bedpaper', rep: 0.9 }; const CL = { tile: 'closet', rep: 0.7 }; const AT = { color: '#e2cfb0', tile: 'wood', rep: 0.9 };
    skin('back', -9, -2.5, 0, UH, K); skin('back', -9, -2.5, 0.9, 1.5, { tile: 'subway', rep: 0.5 }, 0.006);
    skin('left', -6, 0.5, 0, UH, K); skin('left', 0.5, 6, 0, UH, DM);
    skin('back', -2.5, 0.5, 0, UH, HL); skin('back', -2.5, 0.5, FH, TOP, HL);
    skin('back', 0.5, 9, 0, TOP, SW); skin('right', -6, 0, 0, TOP, SW);
    skin('right', 0, 6, 0, UH, BA);
    skin('back', -9, -2.5, FH, TOP, BR); skin('left', -6, 1, FH, TOP, BR); skin('left', 1, 6, FH, TOP, CL);
    skin('right', 0, 6, FH, TOP, AT);
    win('back', -5.0, 1.55, 1.3, 0.85); win('left', 3.2, 1.0, 1.4, 1.1); win('back', 4.5, 3.6, 1.6, 1.3); win('right', -3, 1.2, 1.2, 1.2);
    win('back', -5.8, FH + 1.0, 1.5, 1.1); win('left', -2.5, FH + 1.0, 1.1, 1.0); win('right', 3, FH + 1.2, 1.2, 0.9); win('right', 3, 1.3, 0.9, 0.8);

    // ── ground-floor interior walls ──
    const trim = '#f4efe6';
    wall(b, { x0: -2.5, z0: -6, x1: -2.5, z1: 0.5, h: UH, n: K, p: HL, trim, open: [{ c: -1.4, w: 1.0 }, { c: -4.3, w: 1.3, bottom: 0.95, top: 1.75 }], name: 'w:kitchen-hall' });
    wall(b, { x0: -2.5, z0: 0.5, x1: -2.5, z1: 6, h: UH, n: DM, p: HL, trim, open: [{ c: 3.6, w: 1.5, top: 2.25 }], name: 'w:dining-hall' });
    wall(b, { x0: -9, z0: 0.5, x1: -2.5, z1: 0.5, h: UH, n: K, p: DM, trim, open: [{ c: -5.2, w: 1.1 }, { c: -8.2, w: 0.34, top: 0.42 }], name: 'w:kitchen-dining' });
    wall(b, { x0: 0.5, z0: -6, x1: 0.5, z1: 0, h: UH, n: HL, p: SW, trim, open: [{ c: -2.6, w: 2.2, top: 2.35 }], name: 'w:hall-stair' });
    wall(b, { x0: 0.5, z0: 0, x1: 0.5, z1: 6, h: UH, n: HL, p: LA, trim, open: [{ c: 3.4, w: 1.0 }], name: 'w:hall-laundry' });
    wall(b, { x0: 0.5, z0: 0, x1: 9, z1: 0, h: UH, n: SW, p: LA, trim, open: [{ c: 2.4, w: 1.0 }, { c: 6.8, w: 1.0 }], name: 'w:stair-south' });
    // bath side of that same wall is tiled
    skin2(b, 4.5, 9, 0.07, BA);
    wall(b, { x0: 4.5, z0: 0, x1: 4.5, z1: 6, h: UH, n: LA, p: BA, trim, open: [{ c: 4.6, w: 1.0 }, { c: 1.6, w: 0.9, bottom: 1.1, top: 1.7 }], name: 'w:laundry-bath' });
    // ── upstairs walls ──
    wall(b, { x0: -2.5, z0: -6, x1: -2.5, z1: 1, y: FH, h: UH, n: BR, p: HL, trim, open: [{ c: -1.6, w: 1.0 }], name: 'w:bed-landing' });
    wall(b, { x0: -2.5, z0: 1, x1: -2.5, z1: 6, y: FH, h: UH, n: CL, p: HL, trim, open: [{ c: 4.4, w: 1.0 }], name: 'w:closet-landing' });
    wall(b, { x0: -9, z0: 1, x1: -2.5, z1: 1, y: FH, h: UH, n: BR, p: CL, trim, open: [{ c: -7.4, w: 1.0 }, { c: -4.2, w: 1.0, bottom: 1.0, top: 1.6 }], name: 'w:bed-closet' });
    wall(b, { x0: 0.5, z0: 0, x1: 0.5, z1: 6, y: FH, h: UH, n: HL, p: AT, trim, open: [{ c: 1.8, w: 1.0 }, { c: 4.6, w: 1.0, bottom: 0.9, top: 1.6 }], name: 'w:landing-attic' });
    railing(b, 0.5, -4.85, 0.5, 0, FH, { name: 'gallery' });
    railing(b, 0.6, 0, 9, 0, FH, { name: 'attic-balcony' });
    railing(b, 0.5, -6, 0.5, -5.97, FH, { h: 0.95 });

    // ── STAIRS (stairwell back wall, climbing toward the landing) ──
    const st = stairs(b, { x: 0.5 + 16 * 0.28, z: -5.42, dir: 'x-', width: 1.05, n: 16, rise: FH / 16, run: 0.28, tread: { color: '#b07a4f', tile: 'wood', rep: 0.5 }, stringer: '#6b4430', railSide: 1, name: 'stairs' });
    void st;
    // runner on the treads is implied by colour; under-stair storage
    const us = F(b, 2.0, -5.5);
    us.box(0.5, 0.45, 0.4, [0, 0.225, 0], { color: C.teal, collide: { wall: true, name: 'understair-box' } });
    us.box(0.45, 0.3, 0.38, [0, 0.6, 0.0], { color: C.mustard, yaw: 0.2, collide: { wall: true, name: 'understair-box2' } });
    us.cyl(0.14, 0.16, 0.36, [0.85, 0.18, 0.1], { color: C.red, collide: true }); // vacuum
    us.cyl(0.02, 0.02, 0.8, [0.85, 0.7, 0.1], { color: C.ink, rot: [0.3, 0, 0], outline: false });
    for (let i = 0; i < 4; i++) us.box(0.12, 0.08, 0.28, [-0.6 + i * 0.16, 0.04, 0.35], { color: [C.red, C.blue, C.yellow, C.green][i] });
    us.blob(0.2, 0, 0.9, 0.4);

    // ── STAIRWELL: chandelier, clock, bench, plant, rug, mirror ──
    rug(b, 5.2, -2.6, 3.4, 2.4, 0, 'kilim', { fit: true });
    const ch = F(b, 5.2, -2.7);
    ch.cyl(0.012, 0.012, 1.25, [0, TOP - 0.62, 0], { color: C.ink, radial: 5, outline: false });
    ch.cyl(0.08, 0.14, 0.06, [0, TOP - 0.03, 0], { color: C.mustard });
    ch.lathe([[0.02, 0], [0.18, 0.12], [0.1, 0.35], [0.04, 0.5]], [0, TOP - 1.75, 0], { color: C.mustard, radial: 12 });
    b.add(cylGeo(0.75, 0.75, 0.04, { radial: 20 }), { at: [5.2, TOP - 1.68, -2.7], color: C.mustard, collide: { wall: false, perch: true, name: 'perch:chandelier' } });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2; const px = 5.2 + Math.cos(a) * 0.72; const pz = -2.7 + Math.sin(a) * 0.72;
      b.add(cylGeo(0.035, 0.035, 0.16, { radial: 6 }), { at: [px, TOP - 1.58, pz], color: C.cream });
      b.add(sphereGeo(0.035, 0.06, 0.035, { w: 6, h: 5 }), { at: [px, TOP - 1.46, pz], color: '#ffd23f', outline: false });
    }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.add(sphereGeo(0.05, 0.08, 0.05, { w: 6, h: 5 }), { at: [5.2 + Math.cos(a) * 0.4, TOP - 1.82, -2.7 + Math.sin(a) * 0.4], color: '#cfe8f0' }); }
    // grandfather clock against the right wall
    const gc = F(b, 8.62, -3.8, -Math.PI / 2);
    gc.box(0.6, 2.1, 0.45, [0, 1.05, 0], { color: '#7a3e2a', tile: 'wood', rep: 0.6, collide: { wall: true, name: 'clock' } });
    gc.box(0.7, 0.3, 0.5, [0, 2.25, 0], { color: '#5e2e20', collide: { wall: true, name: 'clock-top' } });
    gc.cyl(0.2, 0.2, 0.03, [0, 1.75, 0.235], { color: C.cream, rot: [Math.PI / 2, 0, 0] });
    gc.box(0.3, 0.8, 0.02, [0, 0.9, 0.23], { color: '#e0a43d' });
    gc.blob(0, 0, 0.45, 0.35);
    // bench + cushions, coat stand, umbrella stand, big plant
    const be = F(b, 8.55, -1.4, -Math.PI / 2);
    be.box(1.5, 0.08, 0.45, [0, 0.45, 0], { color: C.brown, tile: 'wood', rep: 0.6, collide: { wall: false, ceil: true, name: 'bench' } });
    for (const sx of [-0.68, 0.68]) be.box(0.08, 0.45, 0.4, [sx, 0.225, 0], { color: C.brown, collide: { wall: true, name: 'bench-leg' } });
    be.box(0.5, 0.12, 0.4, [-0.35, 0.55, 0], { color: '#ffffff', tile: 'argyle', rep: 0.3, collide: true });
    be.box(0.45, 0.4, 0.12, [0.4, 0.68, -0.1], { color: '#ffffff', tile: 'plaid', rep: 0.3, rot: [-0.2, 0, 0], collide: true });
    be.blob(0, 0, 0.9, 0.35);
    const cs = F(b, 1.2, -0.6);
    cs.cyl(0.025, 0.025, 1.8, [0, 0.9, 0], { color: C.brown, radial: 8, collide: { wall: false, perch: true, name: 'perch:coat-stand' } });
    cs.cyl(0.2, 0.22, 0.04, [0, 0.02, 0], { color: C.brown });
    cs.box(0.42, 0.85, 0.1, [0.12, 1.25, 0], { color: C.mustard, round: 0.02, rot: [0, 0.4, 0.1] });
    cs.box(0.36, 0.7, 0.1, [-0.1, 1.32, 0.08], { color: '#ffffff', tile: 'plaid', rep: 0.35, rot: [0, -0.6, -0.1] });
    cs.sph(0.16, 0.08, 0.16, [0, 1.84, 0], { color: C.red });
    cs.blob(0, 0, 0.3, 0.3);
    plantPot(b, 1.2, -1.6, 0, 1.5, 'h1', C.coral);
    plantPot(b, 8.4, -5.5, 0, 1.7, 'h2', C.teal);
    // round mirror over the bench
    b.add(cylGeo(0.45, 0.45, 0.04, { radial: 20 }), { at: [X1 - 0.03, 1.6, -1.4], rot: [0, 0, Math.PI / 2], color: C.mustard });
    b.add(cylGeo(0.38, 0.38, 0.01, { radial: 20 }), { at: [X1 - 0.055, 1.6, -1.4], rot: [0, 0, Math.PI / 2], color: '#d6ecf2', outline: false });

    // ── HALL: runner rug, framed photos, console, shoe rack ──
    rug(b, -1.0, 0, 1.1, 10.5, 0, 'runner', { rep: [1.1, 1.0] });
    const photos = [['pic1', 0.42, 0.52], ['pic2', 0.6, 0.42], ['pic3', 0.4, 0.4], ['pic4', 0.45, 0.55], ['art', 0.55, 0.45]];
    [-4.6, -3.2, 1.2, 2.2, 5.0].forEach((z, i) => { const [t, w2, h2] = photos[i % 5]; picture(b, -2.43, 1.45 + (i % 2) * 0.15, z, w2, h2, 'x+', t, { frame: [C.ink, C.mustard, '#ffffff', C.red, C.teal][i], mat: '#fbf7ee' }); });
    [-5.0, 1.6, 4.6].forEach((z, i) => { const [t, w2, h2] = photos[(i + 2) % 5]; picture(b, 0.43, 1.5, z, w2, h2, 'x-', t, { frame: [C.teal, C.ink, C.mustard][i] }); });
    const cn = F(b, 0.25, -0.8, -Math.PI / 2);
    table(cn, 1.1, 0.35, 0.8, { top: C.teal, tile: null, leg: '#1f5f5f' });
    cn.cyl(0.07, 0.09, 0.22, [-0.3, 0.91, 0], { color: C.coral }); cn.sph(0.12, 0.1, 0.12, [-0.3, 1.1, 0], { color: C.green });
    cn.box(0.2, 0.05, 0.14, [0.25, 0.83, 0], { color: C.mustard });
    const sr = F(b, -2.25, 5.4, Math.PI / 2);
    sr.box(0.9, 0.04, 0.3, [0, 0.3, 0], { color: C.brown, collide: { wall: false, name: 'shoerack' } });
    sr.box(0.9, 0.04, 0.3, [0, 0.02, 0], { color: C.brown });
    for (const sx of [-0.43, 0.43]) sr.box(0.04, 0.32, 0.3, [sx, 0.16, 0], { color: C.brown, collide: { wall: true, name: 'shoerack-side' } });
    for (let i = 0; i < 4; i++) { const col = [C.red, C.blue, C.mustard, C.pink][i]; sr.box(0.1, 0.09, 0.26, [-0.3 + i * 0.2, 0.36, 0], { color: col, round: 0.03 }); sr.box(0.1, 0.09, 0.26, [-0.3 + i * 0.2 + 0.05, 0.085, 0], { color: [C.green, C.ink, C.coral, C.teal][i], round: 0.03 }); }
    sr.blob(0, 0, 0.55, 0.25);
    const um = F(b, 0.2, 5.5);
    um.cyl(0.14, 0.12, 0.5, [0, 0.25, 0], { color: C.blue, tile: 'stripe', rep: 0.2, collide: true });
    um.cyl(0.015, 0.015, 0.8, [0.03, 0.6, 0], { color: C.red, rot: [0.15, 0, 0.1], outline: false });
    um.cyl(0.015, 0.015, 0.8, [-0.04, 0.6, 0.02], { color: C.yellow, rot: [-0.1, 0, -0.12], outline: false });
    um.blob(0, 0, 0.2, 0.2);
    pendant(b, -1.0, -2.5, UH, 2.05, { shade: C.mustard });
    pendant(b, -1.0, 2.5, UH, 2.05, { shade: C.teal });

    // ── KITCHEN: counters, island + pot rack, fridge, pantry, table bits ──
    const cab = { color: '#7fa89a', tile: 'panel', rep: [0.6, 0.85] };
    aabb(b, -8.95, 0, -5.95, -3.0, 0.88, -5.35, { ...cab, outline: true, collide: { wall: true, name: 'counter-back' } });
    aabb(b, -9.0, 0.88, -6.0, -2.95, 0.93, -5.3, { color: '#f4efe6', outline: true, collide: { wall: false, name: 'counter-top' } });
    aabb(b, -8.95, 1.5, -5.95, -6.4, 2.2, -5.6, { ...cab, outline: true, collide: { wall: true, ceil: true, name: 'upper-cab-a' } });
    aabb(b, -3.6, 1.5, -5.95, -3.0, 2.2, -5.6, { ...cab, outline: true, collide: { wall: true, ceil: true, name: 'upper-cab-b' } });
    // sink + tap + kettle + jars
    aabb(b, -5.5, 0.9, -5.9, -4.5, 0.935, -5.4, { color: '#c9d6dc', outline: true });
    b.add(cylGeo(0.02, 0.02, 0.3, { radial: 6 }), { at: [-5.0, 1.08, -5.85], color: '#9aa7ad' });
    b.add(boxGeo(0.03, 0.03, 0.18), { at: [-5.0, 1.22, -5.78], color: '#9aa7ad' });
    b.add(latheGeo([[0.1, 0], [0.12, 0.12], [0.08, 0.2], [0.02, 0.22]], { radial: 12 }), { at: [-3.7, 0.93, -5.6], color: C.red });
    for (let i = 0; i < 4; i++) b.add(cylGeo(0.06, 0.06, 0.16 + i * 0.03, { radial: 10 }), { at: [-8.6 + i * 0.16, 0.93 + (0.16 + i * 0.03) / 2, -5.7], color: [C.yellow, C.coral, C.teal, C.plum][i] });
    // stove + hood
    aabb(b, -7.4, 0.935, -5.9, -6.6, 0.96, -5.35, { color: C.ink, outline: true });
    for (const [x, z] of [[-7.2, -5.75], [-6.8, -5.75], [-7.2, -5.5], [-6.8, -5.5]]) b.add(cylGeo(0.08, 0.08, 0.01, { radial: 10 }), { at: [x, 0.97, z], color: '#5a5560', outline: false });
    // fridge + pantry on the left wall
    aabb(b, -8.95, 0, -4.9, -8.25, 1.95, -4.05, { color: '#e9f2f4', outline: true, collide: { wall: true, name: 'fridge' } });
    aabb(b, -8.24, 1.2, -4.85, -8.23, 1.21, -4.1, { color: '#b7c6cc', outline: false });
    for (let i = 0; i < 5; i++) aabb(b, -8.24, 1.35 + (i % 3) * 0.14, -4.75 + i * 0.12, -8.22, 1.45 + (i % 3) * 0.14, -4.67 + i * 0.12, { color: [C.red, C.yellow, C.blue, C.pink, C.green][i], outline: false });
    const pan = F(b, -8.72, -2.6, Math.PI / 2);
    shelves(pan, 1.4, 1.9, 0.5, 5, { color: '#f4efe6', tile: null, name: 'pantry' });
    for (let lv = 0; lv < 4; lv++) {
      let x = -0.62;
      while (x < 0.6) {
        const k = r.int(3); const col = [C.red, C.mustard, C.teal, C.coral, C.blue, C.green, C.pink][r.int(7)];
        const y = 0.04 + lv * 0.465;
        if (k === 0) { const hh = 0.18 + r() * 0.1; pan.box(0.12, hh, 0.2, [x + 0.06, y + hh / 2, 0.02], { color: col }); x += 0.14; } else { pan.cyl(0.05, 0.05, 0.14, [x + 0.05, y + 0.07, 0.04], { color: col, tile: 'label', rep: [1, 0.14], fit: false, radial: 8 }); x += 0.12; }
        if (lv === 1 && x > -0.1 && x < 0.3) x = 0.35; // a gap to hide in
      }
    }
    // island with an open shelf you can slip into
    const is = F(b, -5.6, -2.7);
    is.box(2.2, 0.05, 1.1, [0, 0.905, 0], { color: '#f4efe6', collide: { wall: false, ceil: true, name: 'island-top' } });
    is.box(1.9, 0.86, 0.7, [0, 0.43, -0.15], { color: C.navy, tile: 'panel', rep: [0.475, 0.86], collide: { wall: true, name: 'island' } });
    is.box(1.9, 0.04, 0.38, [0, 0.42, 0.37], { color: C.navy, collide: { wall: false, ceil: true, name: 'island-shelf' } });
    for (let i = 0; i < 3; i++) is.cyl(0.14, 0.14, 0.12, [-0.6 + i * 0.6, 0.5, 0.38], { color: [C.red, C.mustard, C.teal][i] });
    is.blob(0, 0, 1.25, 0.65, { a: 0.25 });
    for (const sx of [-0.7, 0, 0.7]) {
      const s2 = F(b, ...is.W(sx, 0.95));
      s2.cyl(0.18, 0.18, 0.05, [0, 0.7, 0], { color: C.coral, collide: { wall: false, name: 'stool' } });
      s2.cyl(0.025, 0.025, 0.68, [0, 0.34, 0], { color: C.ink, radial: 6 });
      s2.cyl(0.14, 0.16, 0.02, [0, 0.01, 0], { color: C.ink });
      s2.blob(0, 0, 0.22, 0.22);
    }
    // hanging pot rack over the island
    const pr = F(b, -5.6, -2.7);
    for (const [sx, sz] of [[-0.8, -0.3], [0.8, -0.3], [-0.8, 0.3], [0.8, 0.3]]) pr.cyl(0.008, 0.008, 0.6, [sx, UH - 0.3, sz], { color: C.ink, radial: 4, outline: false });
    pr.box(1.7, 0.04, 0.66, [0, UH - 0.62, 0], { color: '#3a3a3a', faces: ['py', 'ny', 'px', 'nx', 'pz', 'nz'], collide: { wall: false, perch: true, ceil: true, name: 'perch:pot-rack' } });
    for (let i = 0; i < 5; i++) {
      const px = -0.65 + i * 0.32; const pc = [C.coral, '#9aa7ad', C.teal, C.mustard, C.red][i]; const rr = 0.1 + (i % 2) * 0.04;
      pr.cyl(0.006, 0.006, 0.2, [px, UH - 0.74, 0], { color: C.ink, radial: 4, outline: false });
      pr.cyl(rr, rr * 0.85, 0.12, [px, UH - 0.9, 0], { color: pc });
    }
    pendant(b, -5.6, -0.8, UH, 2.1, { shade: C.red });
    // little breakfast table + chairs under the window side
    const kt = F(b, -3.5, -0.6);
    table(kt, 0.9, 0.9, 0.74, { top: '#f4efe6', tile: null, leg: C.ink, cloth: 'kwall', clothRep: 0.4 });
    for (const [lx, yaw] of [[-0.62, Math.PI / 2], [0.62, -Math.PI / 2]]) chair(F(b, ...kt.W(lx, 0), yaw), { color: C.mustard, leg: C.brown });
    kt.cyl(0.07, 0.06, 0.18, [0, 0.83, 0], { color: C.sky }); kt.sph(0.08, 0.07, 0.08, [0, 0.98, 0], { color: C.pink });
    // fruit bowl + bin
    b.add(sphereGeo(0.24, 0.12, 0.24, { w: 12, h: 6, thetaMax: Math.PI / 2 }), { at: [-5.6, 1.05, -2.6], rot: [Math.PI, 0, 0], color: C.teal });
    for (let i = 0; i < 4; i++) b.add(sphereGeo(0.07, 0.07, 0.07, { w: 8, h: 6 }), { at: [-5.68 + (i % 2) * 0.14, 1.05, -2.66 + Math.floor(i / 2) * 0.12], color: [C.orange, C.red, C.yellow, C.green][i], outline: false });
    b.add(cylGeo(0.18, 0.16, 0.5, { radial: 12 }), { at: [-3.2, 0.25, -4.9], color: C.mustard, collide: true });
    b.blob(-3.2, -4.9, 0.22, 0.22);
    b.blob(-6, -5.65, 3.1, 0.5, { a: 0.24 });

    // ── DINING: big table with a tablecloth tent, sideboard, chairs, rug ──
    rug(b, -5.8, 3.3, 4.2, 3.0, 0, 'kilim', { fit: true });
    const dt = F(b, -5.8, 3.3);
    table(dt, 2.4, 1.2, 0.76, { top: C.wood, leg: C.brown, cloth: 'argyle', clothRep: 0.45, drop: 0.42 });
    for (const lx of [-0.75, 0, 0.75]) for (const s of [-1, 1]) chair(F(b, ...dt.W(lx, s * 0.92), s > 0 ? Math.PI : 0), { color: s > 0 ? C.teal : C.coral, leg: C.ink });
    for (let i = 0; i < 3; i++) { dt.cyl(0.03, 0.03, 0.24, [-0.5 + i * 0.5, 0.9, 0], { color: C.cream, radial: 6 }); dt.cyl(0.08, 0.06, 0.03, [-0.5 + i * 0.5, 0.78, 0], { color: C.mustard }); }
    dt.lathe([[0.06, 0], [0.12, 0.1], [0.05, 0.24], [0.07, 0.3]], [0.15, 0.77, 0.25], { color: C.blue });
    dt.sph(0.12, 0.1, 0.12, [0.15, 1.1, 0.25], { color: C.pink });
    pendant(b, -5.8, 3.3, UH, 1.95, { shade: C.mustard, r: 0.3 });
    const sb = F(b, -8.68, 3.3, Math.PI / 2);
    sb.box(1.8, 0.85, 0.5, [0, 0.47, 0], { color: C.mustard, tile: 'panel', rep: [0.6, 0.6], collide: { wall: true, name: 'sideboard' } });
    for (const sx of [-0.8, 0.8]) sb.box(0.06, 0.05, 0.06, [sx, 0.025, 0], { color: C.ink });
    for (let i = 0; i < 5; i++) sb.cyl(0.14, 0.14, 0.015, [-0.6 + i * 0.3, 1.05, -0.2], { color: [C.blue, '#ffffff', C.red, '#ffffff', C.teal][i], rot: [Math.PI / 2 - 0.25, 0, 0] });
    sb.box(1.6, 0.03, 0.08, [0, 0.92, -0.2], { color: C.brown });
    sb.blob(0, 0, 1.0, 0.32);
    plantPot(b, -8.5, 5.4, 0, 1.4, 'h3', C.mustard);
    plantPot(b, -3.1, 5.4, 0, 1.1, 'h4', C.blue);
    picture(b, -5.8, 1.65, 0.57, 1.2, 0.8, 'z+', 'art', { frame: C.ink });
    // a dog bed by the pet door
    const db = F(b, -7.6, 1.2);
    db.lathe([[0.4, 0], [0.42, 0.14], [0.36, 0.16], [0.32, 0.06]], [0, 0, 0], { color: '#ffffff', tile: 'plaid', rep: 0.4, collide: true });
    db.blob(0, 0, 0.45, 0.45);

    // ── LAUNDRY: washer + dryer, drying rack, basket, ironing board, shelf ──
    for (const [x, col] of [[1.1, '#f4f7f8'], [1.85, '#f4f7f8']]) {
      aabb(b, x - 0.33, 0, 5.25, x + 0.33, 0.86, 5.9, { color: col, outline: true, collide: { wall: true, name: 'washer' } });
      b.add(cylGeo(0.22, 0.22, 0.03, { radial: 16 }), { at: [x, 0.45, 5.24], rot: [Math.PI / 2, 0, 0], color: '#9cc7d9' });
      aabb(b, x - 0.28, 0.75, 5.23, x - 0.1, 0.8, 5.25, { color: C.ink, outline: false });
    }
    const lsh = F(b, 1.5, 5.75, Math.PI);
    lsh.box(1.6, 0.04, 0.3, [0, 1.55, 0], { color: '#ffffff', collide: { wall: false, perch: true, name: 'laundry-shelf' } });
    for (let i = 0; i < 5; i++) lsh.box(0.14, 0.28, 0.16, [-0.6 + i * 0.3, 1.71, 0], { color: [C.blue, C.pink, C.green, C.orange, C.teal][i], tile: 'label', rep: [0.14, 0.28], fit: false });
    const dr = F(b, 3.1, 2.4, 0.4);
    for (const sx of [-0.6, 0.6]) { dr.box(0.03, 1.2, 0.03, [sx, 0.6, -0.3], { color: '#bfc7cc', rot: [0.25, 0, 0] }); dr.box(0.03, 1.2, 0.03, [sx, 0.6, 0.3], { color: '#bfc7cc', rot: [-0.25, 0, 0] }); }
    for (let i = 0; i < 3; i++) dr.box(1.25, 0.02, 0.02, [0, 1.12, -0.15 + i * 0.15], { color: '#bfc7cc' });
    dr.collide(-0.62, 0.95, -0.25, 0.62, 1.15, 0.25, { wall: false, perch: true, name: 'perch:drying-rack' });
    [['towel', 0.55, 0.7], ['plaid', 0.4, 0.5], ['argyle', 0.35, 0.45], ['dots', 0.3, 0.35]].forEach(([t, w2, h2], i) => dr.box(w2, h2, 0.015, [-0.35 + i * 0.28, 1.12 - h2 / 2, -0.15 + (i % 3) * 0.15], { color: '#ffffff', tile: t, rep: 0.3 }));
    dr.blob(0, 0, 0.7, 0.4, { a: 0.15 });
    const lb = F(b, 3.7, 4.8);
    lb.lathe([[0.3, 0], [0.34, 0.42], [0.3, 0.42]], [0, 0, 0], { color: '#d9c4a0', tile: 'weave', rep: 0.15, collide: true });
    lb.sph(0.32, 0.18, 0.32, [0, 0.42, 0], { color: '#ffffff', tile: 'plaid', rep: 0.3, thetaMax: Math.PI / 2 });
    lb.blob(0, 0, 0.4, 0.4);
    const ib = F(b, 2.7, 0.75);
    ib.box(1.3, 0.04, 0.36, [0, 0.82, 0], { color: '#ffffff', tile: 'stripe', rep: 0.3, round: 0.015, collide: { wall: false, perch: true, ceil: true, name: 'perch:ironing' } });
    for (const s of [-1, 1]) ib.box(0.03, 1.0, 0.03, [0, 0.4, 0], { color: '#9aa7ad', rot: [0, 0, s * 0.6] });
    ib.blob(0, 0, 0.7, 0.25, { a: 0.15 });
    pendant(b, 2.5, 3, UH, 2.1, { shade: C.sky });

    // ── BATHROOM: clawfoot tub + shower curtain, toilet, vanity, towel rail, mat ──
    const tb = F(b, 7.9, 4.6);
    tb.box(1.0, 0.5, 1.7, [0, 0.42, 0], { color: '#fbf7ee', round: 0.18, seg: 2, collide: { wall: true, name: 'tub' } });
    tb.box(0.82, 0.02, 1.5, [0, 0.62, 0], { color: '#9cd0dc', outline: false });
    for (const [sx, sz] of [[-0.38, -0.7], [0.38, -0.7], [-0.38, 0.7], [0.38, 0.7]]) tb.sph(0.06, 0.09, 0.06, [sx, 0.09, sz], { color: C.mustard });
    tb.blob(0, 0, 0.6, 0.95);
    // curtain rail (perch) + curtain hanging along the open side of the tub
    aabb(b, 7.3, 2.05, 3.6, 7.33, 2.08, 6.0, { color: '#9aa7ad', collide: { wall: false, perch: true, name: 'perch:curtain-rail' } });
    for (let i = 0; i < 4; i++) b.add(boxGeo(0.03, 1.6, 0.42), { at: [7.31 + (i % 2) * 0.05, 1.25, 3.85 + i * 0.36], color: '#ffffff', tile: 'curtain', rep: 0.45, uvOff: [i * 0.3, 0] });
    b.collide(7.28, 0.5, 3.62, 7.4, 2.05, 5.2, { wall: true, name: 'curtain' });
    const to = F(b, 5.2, 5.6, Math.PI);
    to.box(0.4, 0.5, 0.18, [0, 0.65, 0.12], { color: '#fbf7ee', round: 0.04, collide: { wall: true, name: 'cistern' } });
    to.lathe([[0.12, 0], [0.16, 0.3], [0.2, 0.42]], [0, 0, -0.1], { color: '#fbf7ee', collide: true });
    to.box(0.36, 0.03, 0.42, [0, 0.43, -0.12], { color: C.pink, round: 0.012 });
    to.blob(0, -0.05, 0.3, 0.35);
    const va = F(b, 8.7, 1.5, -Math.PI / 2);
    va.box(1.1, 0.8, 0.5, [0, 0.4, 0], { color: C.teal, tile: 'panel', rep: [0.55, 0.8], collide: { wall: true, name: 'vanity' } });
    va.box(1.16, 0.05, 0.54, [0, 0.82, 0], { color: '#fbf7ee', collide: { wall: false, name: 'vanity-top' } });
    va.cyl(0.2, 0.15, 0.08, [0, 0.86, 0.02], { color: '#fbf7ee' });
    va.box(0.75, 0.9, 0.03, [0, 1.65, -0.22], { color: '#d6ecf2', collide: { wall: true, name: 'mirror' } });
    va.box(0.85, 1.0, 0.025, [0, 1.65, -0.235], { color: C.mustard });
    va.cyl(0.04, 0.04, 0.14, [0.35, 0.92, 0.05], { color: C.pink }); va.cyl(0.03, 0.03, 0.18, [0.42, 0.94, -0.05], { color: C.blue });
    va.blob(0, 0, 0.65, 0.32);
    aabb(b, 5.0, 1.2, 0.09, 6.2, 1.24, 0.15, { color: '#9aa7ad', collide: { wall: false, perch: true, name: 'perch:towel-rail' } });
    aabb(b, 5.15, 0.55, 0.12, 5.65, 1.22, 0.14, { color: '#ffffff', tile: 'towel', rep: 0.4 });
    aabb(b, 5.7, 0.7, 0.12, 6.1, 1.22, 0.14, { color: '#ffffff', tile: 'dots', rep: 0.25 });
    rug(b, 6.6, 3.4, 1.0, 0.65, 0, 'chevron', { rep: 0.4 });
    plantPot(b, 5.0, 0.5, 0, 0.9, 'h5', C.pink);
    // rubber duck
    b.add(sphereGeo(0.06, 0.05, 0.07, { w: 8, h: 6 }), { at: [7.9, 0.67, 4.2], color: C.yellow });
    b.add(sphereGeo(0.035, 0.035, 0.035, { w: 8, h: 6 }), { at: [7.9, 0.74, 4.15], color: C.yellow });

    // ── BEDROOM (upstairs): bed with quilt (squeeze under), nightstands, dresser, fan, armchair ──
    const Y = FH;
    rug(b, -5.4, -2.6, 3.4, 2.6, Y, 'chevron', { rep: 0.7 });
    const bd = F(b, -5.4, -4.5, 0, Y);
    bd.box(1.7, 0.08, 2.1, [0, 0.3, 0], { color: C.brown, collide: { wall: false, ceil: true, name: 'bed-base' } });
    for (const [sx, sz] of [[-0.8, -1.0], [0.8, -1.0], [-0.8, 1.0], [0.8, 1.0]]) bd.box(0.08, 0.3, 0.08, [sx, 0.15, sz], { color: C.brown });
    bd.box(1.6, 0.24, 2.0, [0, 0.46, 0.0], { color: '#fbf7ee', round: 0.05, collide: { wall: false, name: 'mattress' } });
    bd.box(1.74, 0.06, 1.5, [0, 0.6, 0.32], { color: '#ffffff', tile: 'quilt', rep: 0.85, round: 0.03 });
    for (const s of [-1, 1]) bd.box(1.74, 0.42, 0.04, [0, 0.4, 0.32 + s * 0], { color: '#ffffff', tile: 'quilt', rep: 0.85, faces: ['pz'] });
    bd.box(0.04, 0.38, 1.5, [-0.89, 0.42, 0.32], { color: '#ffffff', tile: 'quilt', rep: 0.85 });
    bd.box(0.04, 0.38, 1.5, [0.89, 0.42, 0.32], { color: '#ffffff', tile: 'quilt', rep: 0.85 });
    bd.box(0.04, 0.38, 1.78, [0, 0.42, 1.07], { color: '#ffffff', tile: 'quilt', rep: 0.85, yaw: Math.PI / 2 });
    bd.box(0.62, 0.16, 0.38, [-0.4, 0.66, -0.75], { color: '#ffffff', tile: 'stripe', rep: 0.25, round: 0.06 });
    bd.box(0.62, 0.16, 0.38, [0.4, 0.66, -0.75], { color: C.pink, round: 0.06 });
    bd.box(1.8, 1.1, 0.08, [0, 0.55, -1.04], { color: C.navy, round: 0.03, collide: { wall: true, name: 'headboard' } });
    bd.collide(-0.8, 0.34, -1.0, 0.8, 0.64, 1.07, { wall: true, name: 'bed-sides' });
    bd.blob(0, 0, 1.0, 1.2, { a: 0.3 });
    for (const sx of [-1.25, 1.25]) {
      const ns = F(b, ...bd.W(sx, -0.75), 0, Y);
      ns.box(0.5, 0.55, 0.42, [0, 0.275, 0], { color: C.mustard, tile: 'panel', rep: [0.5, 0.27], collide: { wall: true, name: 'nightstand' } });
      ns.cyl(0.05, 0.08, 0.2, [0, 0.65, 0], { color: C.teal });
      ns.cyl(0.12, 0.18, 0.2, [0, 0.85, 0], { color: '#ffffff', tile: 'stripe', rep: 0.15 });
      ns.blob(0, 0, 0.32, 0.3);
    }
    const dre = F(b, -8.65, -1.4, Math.PI / 2, Y);
    dre.box(1.3, 0.95, 0.5, [0, 0.475, 0], { color: C.coral, tile: 'panel', rep: [0.65, 0.31], collide: { wall: true, name: 'dresser' } });
    dre.box(0.9, 0.7, 0.03, [0, 1.35, -0.22], { color: '#d6ecf2' });
    dre.box(1.0, 0.8, 0.02, [0, 1.35, -0.235], { color: C.navy });
    for (let i = 0; i < 4; i++) dre.box(0.08, 0.2 + i * 0.03, 0.08, [-0.45 + i * 0.12, 1.05 + i * 0.015, 0.05], { color: [C.pink, C.blue, C.yellow, C.green][i] });
    dre.blob(0, 0, 0.75, 0.32);
    const ac = F(b, -3.6, -0.6, -Math.PI * 0.8, Y);
    ac.box(0.8, 0.26, 0.75, [0, 0.22, 0], { color: '#ffffff', tile: 'plaid', rep: 0.35, round: 0.05, collide: { wall: true, name: 'armchair' } });
    ac.box(0.8, 0.55, 0.18, [0, 0.62, -0.3], { color: '#ffffff', tile: 'plaid', rep: 0.35, round: 0.06, collide: { wall: true, name: 'armchair-back' } });
    for (const sx of [-1, 1]) ac.box(0.15, 0.45, 0.75, [sx * 0.4, 0.3, 0], { color: '#ffffff', tile: 'plaid', rep: 0.35, round: 0.05 });
    ac.blob(0, 0, 0.55, 0.5);
    plantPot(b, -8.5, 0.5, Y, 1.3, 'h6', C.blue);
    // ceiling fan (perch on the blades)
    const fan = F(b, -5.4, -2.6, 0, Y);
    fan.cyl(0.02, 0.02, 0.5, [0, UH - 0.25, 0], { color: C.ink, radial: 6 });
    fan.cyl(0.14, 0.1, 0.14, [0, UH - 0.55, 0], { color: C.ink });
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; fan.box(0.8, 0.02, 0.18, [Math.cos(a) * 0.5, UH - 0.56, Math.sin(a) * 0.5], { color: '#c9a274', tile: 'wood', rep: 0.4, yaw: -a }); }
    fan.collide(-0.9, UH - 0.57, -0.09, 0.9, UH - 0.55, 0.09, { wall: false, perch: true, name: 'perch:fan-a' });
    fan.collide(-0.09, UH - 0.57, -0.9, 0.09, UH - 0.55, 0.9, { wall: false, perch: true, name: 'perch:fan-b' });
    fan.sph(0.12, 0.08, 0.12, [0, UH - 0.66, 0], { color: '#fff3c4' });
    picture(b, -5.4, Y + 1.85, -5.97, 0.9, 0.6, 'z+', 'pic2', { frame: C.mustard });

    // ── CLOSET (upstairs): clothes rails of patterns, shoe tower, hat boxes, mirror, pouf ──
    const garments = ['plaid', 'argyle', 'towel', 'dots', 'stripe', 'curtain', 'quilt', 'chevron'];
    const rail = (x0, z0, x1, z1, n, seed) => {
      const rr = seeded(seed); const alongX = Math.abs(z1 - z0) < 0.01;
      const L = alongX ? x1 - x0 : z1 - z0;
      aabb(b, alongX ? x0 : x0 - 0.02, Y + 1.7, alongX ? z0 - 0.02 : z0, alongX ? x1 : x0 + 0.02, Y + 1.74, alongX ? z0 + 0.02 : z1, { color: '#9aa7ad', collide: { wall: false, perch: true, name: 'perch:clothes-rail' } });
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n; const h2 = 0.7 + rr() * 0.45; const w2 = L / n - 0.02;
        const tile = garments[(i + seed.length) % garments.length];
        const c = alongX ? [x0 + L * t, z0] : [x0, z0 + L * t];
        b.add(boxGeo(alongX ? w2 : 0.08, h2, alongX ? 0.08 : w2, { round: 0.02 }), { at: [c[0], Y + 1.68 - h2 / 2, c[1]], color: '#ffffff', tile, rep: 0.35, yaw: (rr() - 0.5) * 0.15 });
      }
      b.collide(alongX ? x0 : x0 - 0.06, Y + 0.6, alongX ? z0 - 0.06 : z0, alongX ? x1 : x0 + 0.06, Y + 1.7, alongX ? z0 + 0.06 : z1, { wall: true, name: 'clothes' });
    };
    rail(-8.7, 1.6, -8.7, 5.6, 9, 'clA');
    rail(-8.4, 5.7, -4.6, 5.7, 8, 'clBB');
    const sh2 = F(b, -3.0, 2.0, -Math.PI / 2, Y);
    shelves(sh2, 1.2, 1.6, 0.4, 5, { color: '#f4efe6', tile: null, name: 'shoe-tower' });
    for (let lv = 0; lv < 4; lv++) for (let i = 0; i < 3; i++) if (!(lv === 2 && i === 1)) sh2.box(0.24, 0.12, 0.3, [-0.38 + i * 0.38, 0.1 + lv * 0.39, 0], { color: [C.red, C.mustard, C.blue, C.pink, C.green, C.ink][(lv * 3 + i) % 6], round: 0.04 });
    stack(F(b, -4.0, 5.55, 0, Y), 0, 0, [[0.5, 0.3, 0.5, C.pink, 'dots'], [0.42, 0.26, 0.42, C.mustard, null, 0.3], [0.34, 0.22, 0.34, C.teal, 'stripe', 0.6]]);
    const pf = F(b, -6.2, 3.5, 0, Y);
    pf.cyl(0.38, 0.4, 0.42, [0, 0.21, 0], { color: '#ffffff', tile: 'closet', rep: 0.5, collide: true, radial: 16 });
    pf.blob(0, 0, 0.45, 0.45);
    rug(b, -6.2, 3.5, 2.2, 1.6, Y, 'argyle', { rep: 0.6 });
    aabb(b, -2.62, Y + 0.1, 4.95, -2.58, Y + 1.9, 5.65, { color: '#d6ecf2', outline: true });

    // ── LANDING (upstairs hall): runner, bookcase, laundry hamper, window seat ──
    rug(b, -1.0, -0.3, 1.0, 9.0, Y, 'runner', { rep: [1.0, 1.0] });
    const bk = F(b, -2.25, -3.8, Math.PI / 2, Y);
    shelves(bk, 1.6, 1.9, 0.36, 5, { color: C.brown, name: 'landing-books' });
    const bcols = [C.teal, C.red, C.mustard, C.leaf, C.plum, C.coral, '#f3e7cf', C.ink, C.blue, C.pink];
    for (let lv = 0; lv < 4; lv++) {
      let x = -0.74; let k = lv * 3;
      while (x < 0.7) {
        if ((lv === 1 && x > -0.2 && x < 0.3) || (lv === 3 && x > 0.2)) { x += 0.05; continue; }
        const w2 = 0.04 + r() * 0.03; const h2 = 0.24 + r() * 0.14;
        bk.box(w2, h2, 0.26, [x + w2 / 2, 0.04 + lv * 0.4675 + h2 / 2, 0], { color: bcols[k++ % bcols.length], tile: 'spine', rep: [w2, h2], fit: false });
        x += w2 + 0.006;
      }
    }
    const hp = F(b, -2.1, 2.2, 0, Y);
    hp.cyl(0.24, 0.22, 0.6, [0, 0.3, 0], { color: '#ffffff', tile: 'weave', rep: 0.15, collide: true, radial: 14 });
    hp.blob(0, 0, 0.3, 0.3);
    plantPot(b, 0.1, 5.4, Y, 1.2, 'h7', C.coral);
    picture(b, -2.43, Y + 1.5, -0.2, 0.5, 0.6, 'x+', 'pic3', { frame: C.red });
    picture(b, 0.43, Y + 1.5, 3.6, 0.5, 0.4, 'x-', 'pic4', { frame: C.ink });

    // ── ATTIC (upstairs, over laundry + bathroom): beams, boxes, trunk, rocking horse, dress form ──
    // roof: rafters slope from the balcony (y 5.4 at z 0) down to the low front (y 3.6 at z 6)
    const zr0 = 0.0; const yr0 = TOP + 0.1; const zr1 = 6.0; const yr1 = FH + 0.75;
    const slope = Math.atan2(yr0 - yr1, zr1 - zr0); const rl = Math.hypot(zr1 - zr0, yr0 - yr1);
    for (let i = 0; i < 8; i++) {
      const x = 0.7 + i * 1.18;
      b.add(boxGeo(0.12, 0.16, rl), { at: [x, (yr0 + yr1) / 2, (zr0 + zr1) / 2], rot: [slope, 0, 0], color: '#8a5d3b', tile: 'wood', rep: 0.8 });
    }
    // boards over the back half of the roof (a ceiling to hang from), open at the front for the view
    const bz1 = 2.6; const by1 = yr0 - (bz1 - zr0) * Math.tan(slope);
    b.add(boxGeo(8.5, 0.04, bz1 / Math.cos(slope)), { at: [4.75, (yr0 + by1) / 2 + 0.1, bz1 / 2], rot: [slope, 0, 0], color: '#c9a274', tile: 'planks', rep: 1.2 });
    b.collide(0.5, by1 + 0.05, 0, 9, yr0 + 0.2, bz1, { wall: false, ceil: true, name: 'ceil:attic-boards' });
    b.collide(0.3, yr0 + 0.2, -0.2, 9.2, yr0 + 2.5, bz1 + 0.2, { wall: false, climb: false, name: 'roof-guard' });
    // collar beam + purlins (thin, perchable)
    aabb(b, 0.5, FH + 1.9, 3.0, 9, FH + 2.04, 3.14, { color: '#7a4e35', tile: 'wood', rep: 0.8, outline: true, collide: { wall: false, perch: true, name: 'perch:attic-beam' } });
    aabb(b, 0.5, FH + 1.2, 4.6, 9, FH + 1.34, 4.74, { color: '#7a4e35', tile: 'wood', rep: 0.8, outline: true, collide: { wall: false, perch: true, name: 'perch:attic-beam-low' } });
    for (const x of [2.5, 6.5]) aabb(b, x - 0.07, FH, 4.6, x + 0.07, FH + 1.2, 4.74, { color: '#7a4e35', outline: true, collide: { wall: true, perch: true, name: 'perch:attic-post' } });
    const tr = F(b, 7.6, 4.9, 0, Y);
    tr.box(1.2, 0.55, 0.65, [0, 0.275, 0], { color: C.navy, round: 0.03, collide: { wall: true, name: 'trunk' } });
    tr.box(1.24, 0.06, 0.69, [0, 0.58, 0], { color: C.mustard });
    for (const sx of [-0.35, 0.35]) tr.box(0.06, 0.57, 0.67, [sx, 0.29, 0], { color: C.mustard });
    tr.blob(0, 0, 0.7, 0.4);
    stack(F(b, 3.7, 5.2, 0, Y), 0, 0, [[0.7, 0.5, 0.6, '#c99a6b', null], [0.6, 0.4, 0.5, '#d2a46a', null, 0.25], [0.45, 0.35, 0.4, C.coral, 'dots', -0.2]]);
    stack(F(b, 1.3, 5.3, 0, Y), 0, 0, [[0.8, 0.22, 0.5, C.teal, 'stripe'], [0.7, 0.2, 0.45, C.red, null, 0.1], [0.6, 0.18, 0.4, C.mustard, null, -0.1]]);
    // rocking horse
    const rh = F(b, 5.4, 2.4, 0.6, Y);
    for (const s of [-1, 1]) rh.box(0.05, 0.08, 1.0, [s * 0.2, 0.06, 0], { color: C.red, round: 0.02 });
    rh.box(0.3, 0.3, 0.65, [0, 0.55, 0], { color: '#fbf7ee', round: 0.1, seg: 2, collide: { wall: true, name: 'horse' } });
    rh.box(0.18, 0.4, 0.2, [0, 0.82, 0.3], { color: '#fbf7ee', rot: [0.4, 0, 0], round: 0.06 });
    rh.box(0.06, 0.3, 0.2, [0, 0.9, 0.22], { color: C.mustard, rot: [0.4, 0, 0] });
    for (const [sx, sz] of [[-0.12, -0.25], [0.12, -0.25], [-0.12, 0.25], [0.12, 0.25]]) rh.box(0.05, 0.42, 0.05, [sx, 0.28, sz], { color: '#fbf7ee' });
    rh.box(0.32, 0.03, 0.28, [0, 0.71, -0.02], { color: C.red });
    rh.blob(0, 0, 0.35, 0.55);
    // dress form + old lamp + rolled rug
    const df = F(b, 2.2, 2.1, 0, Y);
    df.cyl(0.18, 0.2, 0.03, [0, 0.015, 0], { color: C.ink }); df.cyl(0.02, 0.02, 0.9, [0, 0.45, 0], { color: C.ink, radial: 6 });
    df.lathe([[0.02, 0], [0.18, 0.08], [0.15, 0.3], [0.2, 0.5], [0.1, 0.62], [0.04, 0.66]], [0, 0.85, 0], { color: '#ffffff', tile: 'curtain', rep: 0.3, collide: true });
    df.blob(0, 0, 0.25, 0.25);
    b.add(cylGeo(0.18, 0.18, 2.2, { radial: 12 }), { at: [6.2, Y + 0.18, 0.6], rot: [0, 0, Math.PI / 2], color: '#ffffff', tile: 'kilim', rep: 0.6, collide: { wall: true, name: 'rolled-rug' } });
    b.blob(6.2, 0.6, 1.2, 0.25, { y: Y + 0.004 });
    const ol = F(b, 8.4, 2.2, 0, Y);
    ol.cyl(0.015, 0.015, 1.4, [0, 0.7, 0], { color: C.ink, radial: 6 });
    ol.cyl(0.15, 0.25, 0.28, [0, 1.48, 0], { color: '#ffffff', tile: 'quilt', rep: 0.3 });
    ol.cyl(0.16, 0.18, 0.03, [0, 0.015, 0], { color: C.ink });
    ol.blob(0, 0, 0.22, 0.22);
    // string lights along the collar beam
    for (let i = 0; i < 14; i++) b.add(sphereGeo(0.035, 0.05, 0.035, { w: 6, h: 4 }), { at: [0.9 + i * 0.58, FH + 1.82 - Math.sin((i % 2) * 1.2) * 0.05, 3.07], color: [C.pink, C.yellow, C.teal, C.coral][i % 4], outline: false });

    // ── spots ──
    b.spot('lobby', { x: -1.0, z: 2.6, y: 0 });
    b.spot('hiderSpawn', { x: -1.0, z: 0.5, y: 0, yaw: Math.PI });
    b.spot('seekerSpawn', { x: -1.0, z: 5.0, y: 0, yaw: Math.PI });
    b.spot('spawnA', { x: -1.4, z: -2.0, y: 0, yaw: 0 });
    b.spot('spawnB', { x: 3.0, z: -2.6, y: 0, yaw: -Math.PI / 2 });
    b.spot('hiderSpawns', [{ x: -1.0, z: 0.5, y: 0, yaw: Math.PI }, { x: 5.0, z: -1.5, y: 0, yaw: Math.PI }, { x: -1.0, z: -1.0, y: FH, yaw: Math.PI }]);
    b.spot('seekerSpawns', [{ x: -1.0, z: 5.0, y: 0, yaw: Math.PI }, { x: -0.6, z: 4.6, y: 0, yaw: Math.PI }]);
    b.spot('camo', { x: -6.6, z: 5.85, wallNormal: [0, 0, -1], y: 0.45, note: 'damask strip on the dining-room wall' });
    b.spot('rug', { x: 5.2, z: -2.6, yaw: 0 });
    b.spot('overview', { y: 11, radius: 17 });
    b.probe('hall-console-teal', [0.25, 0.801, -0.8], [0, 1, 0], C.teal);
  };
}

/** Bath-side tiles on the stair-south wall (the wall's p side there is laundry dots). */
function skin2(b, x0, x1, z, d) {
  aabb(b, x0, 0, z, x1, UH, z + 0.004, { faces: ['pz'], tile: d.tile, rep: d.rep, color: '#ffffff', outline: false, uvOff: [x0 / d.rep, 0] });
}

/** Potted plant with a y offset (upper floors). */
function plantPot(b, x, z, y, s, seed, pot) {
  const f = F(b, x, z, 0, y);
  const r = seeded(seed); const ph = 0.42 * s;
  f.lathe([[0.15 * s, 0], [0.21 * s, ph * 0.8], [0.23 * s, ph], [0.2 * s, ph], [0.18 * s, ph * 0.86]], [0, 0, 0], { color: pot, tile: 'rings', rep: [0.4, ph * 1.05], collide: true });
  f.cyl(0.18 * s, 0.18 * s, 0.02, [0, ph * 0.84, 0], { color: '#5b3a28', outline: false });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r() * 0.5; const L = (0.45 + r() * 0.3) * s; const tilt = 0.55 + r() * 0.5;
    f.sph(0.1 * s, 0.025 * s, L * 0.5, [Math.sin(a) * L * 0.42, ph + 0.28 * s + r() * 0.3 * s, Math.cos(a) * L * 0.42], { color: i % 2 ? '#4f7d4f' : '#7aa35a', rot: [-tilt, a, 0], w: 8, h: 5 });
  }
  f.blob(0, 0, 0.32 * s, 0.32 * s);
}

export const HOUSE = {
  id: 'house', name: 'The Whole House', blurb: 'Two floors, a stairwell chandelier and an attic full of beams.',
  build, size: 'XL', rooms: 10, climbs: 3,
  info: {
    w: W, d: D,
    floors: [{ y: 0, name: 'Downstairs' }, { y: FH, name: 'Upstairs' }],
    rooms: [
      { name: 'Kitchen', floor: 0, y: 0, x0: -9, z0: -6, x1: -2.5, z1: 0.5, landmark: 'pot rack over the navy island' },
      { name: 'Dining room', floor: 0, y: 0, x0: -9, z0: 0.5, x1: -2.5, z1: 6, landmark: 'argyle tablecloth under the yellow lamp' },
      { name: 'Hall', floor: 0, y: 0, x0: -2.5, z0: -6, x1: 0.5, z1: 6, landmark: 'striped runner and the photo wall' },
      { name: 'Stairwell', floor: 0, y: 0, x0: 0.5, z0: -6, x1: 9, z1: 0, landmark: 'gold chandelier and the grandfather clock' },
      { name: 'Laundry', floor: 0, y: 0, x0: 0.5, z0: 0, x1: 4.5, z1: 6, landmark: 'drying rack of towels' },
      { name: 'Bathroom', floor: 0, y: 0, x0: 4.5, z0: 0, x1: 9, z1: 6, landmark: 'clawfoot tub and flowery shower curtain' },
      { name: 'Bedroom', floor: 1, y: FH, x0: -9, z0: -6, x1: -2.5, z1: 1, landmark: 'patchwork quilt and the ceiling fan' },
      { name: 'Closet', floor: 1, y: FH, x0: -9, z0: 1, x1: -2.5, z1: 6, landmark: 'rails of patterned clothes' },
      { name: 'Landing', floor: 1, y: FH, x0: -2.5, z0: -6, x1: 0.5, z1: 6, landmark: 'gallery railing over the stairwell' },
      { name: 'Attic', floor: 1, y: FH, x0: 0.5, z0: 0, x1: 9, z1: 6, landmark: 'sloping beams and the rocking horse' },
    ],
    overview: { y: 11, radius: 17 },
    // screenshot / preview cameras per room: p = eye, t = target
    cams: [
      { name: 'overview', p: [0, 13, 17], t: [0, 1.5, 0] },
      { name: 'kitchen', p: [-3.2, 1.5, 0.0], t: [-6.5, 0.8, -3.6] },
      { name: 'dining', p: [-3.2, 1.6, 5.6], t: [-6.5, 0.6, 2.2] },
      { name: 'hall', p: [-1.0, 1.4, 5.7], t: [-1.0, 0.8, -3] },
      { name: 'stairwell', p: [8.2, 1.7, -0.5], t: [3.0, 2.2, -4.5] },
      { name: 'stairwell-up', p: [0.0, 4.2, -0.3], t: [5.2, 3.6, -3.5] },
      { name: 'laundry', p: [4.0, 1.6, 0.6], t: [1.5, 0.6, 4.5] },
      { name: 'bathroom', p: [5.0, 1.7, 0.6], t: [7.8, 0.6, 4.4] },
      { name: 'bedroom', p: [-3.0, 4.6, 0.6], t: [-5.6, 3.2, -4.0] },
      { name: 'closet', p: [-3.0, 4.5, 1.6], t: [-7.0, 3.4, 5.0] },
      { name: 'landing', p: [-1.0, 4.4, 5.6], t: [-1.0, 3.3, -3.5] },
      { name: 'attic', p: [1.2, 4.6, 0.6], t: [6.0, 3.2, 4.5] },
    ],
  },
};
