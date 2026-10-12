// SPIN CYCLE LAUNDERETTE — a coin-op launderette, 18 × 12 m, ceiling 3.2 m (one floor, 216 m²).
//
//   back wall (subway tile, aqua dado)
//   ┌─ WASH WALL: 8 identical washers + detergent shelf ──┬── BACK ROOM ─────────────┐
//   │                                       open stretch  │ detergent shelving,     │
//   │ D  island of 10 washers (back to back)   of tile    │ box towers, drums,      │
//   │ R  ■ pillar            ■ pillar          (camo)     │ heater, sink, hatch     │
//   │ Y                                                   ├───────── door ──────────┤
//   │ E  clothes rail (shirts to squeeze between)         │ folding tables, carts   │ L
//   │ R  vending: soap + change                           │ bench                   │ O
//   │ S  carts                  ·  ·  ·                   │                         │ S
//   └──────────────── low front wall (open to the camera) ┴─────────────────────────┘ T
//                                                                         SOCK WALL ┘
//
// Camouflage contrast is the point: the tiled walls, the white machine tops, the aqua/white
// checker floor and the identical machine fronts are calm (a stamp lines up perfectly on a bank of
// identical doors); the lost-sock board, the detergent shelves, the box towers and the rail of
// shirts are busy. Loops: the back room has two doors and a service hatch; the aisles run round
// both islands. Verticality: the dryer wall is two machines high (a 1.8 m ledge), a vent duct and
// strip lights hang in reach of crawlers, the shelving and box towers climb to 2 m.
import { boxGeo, cylGeo, sphereGeo } from '../geo.js';
import { P } from '../atlas.js';
import { seeded } from '../util.js';
import { Q } from './patterns.js';
import { F, aabb, wall, floor, slab, picture, shelves, table } from './lib.js';

const W = 18; const D = 12; const X0 = -9; const X1 = 9; const Z0 = -6; const Z1 = 6;
const CEIL = 3.2;
const BRX = 3; // back-room west wall
const BRZ = -1; // back-room south wall
const DADO = 1.1;

const C = {
  ink: '#2a2730', white: '#f7fbfa', machine: '#f4f8f8', cream: '#f6efd9', aqua: '#8fd6cd', aquaD: '#3fa9a3', navy: '#2f3f6d', coral: '#ef6f5e',
  yellow: '#f2c14e', pink: '#ef7fa8', lilac: '#b9a3d9', steel: '#9aa7ad', blue: '#3f6fd1', red: '#e2493b', green: '#3fa66b', orange: '#f28c38',
  purple: '#7d5bc4', brown: '#8c5a3c', card: '#d2a46a', lime: '#b5d94a', teal: '#2f8f8f', sky: '#8fb3c9',
};

const wrap = (w, h, fn) => { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) fn(ox * w, oy * h); };

/** A front-loading washer face (not repeating): control strip, drawer, knobs, a big porthole. */
const washerFront = () => (g, w, h) => {
  g.fillStyle = '#f4f8f8'; g.fillRect(0, 0, w, h);
  g.fillStyle = C.aqua; g.fillRect(0, 0, w, h * 0.17);
  g.fillStyle = '#d6e4e4'; g.fillRect(w * 0.06, h * 0.045, w * 0.3, h * 0.085);
  g.fillStyle = C.navy; g.fillRect(w * 0.42, h * 0.05, w * 0.2, h * 0.075);
  g.fillStyle = C.coral; g.beginPath(); g.arc(w * 0.72, h * 0.085, h * 0.035, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.ink; g.beginPath(); g.arc(w * 0.86, h * 0.085, h * 0.035, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#c3d3d3'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  const cx = w / 2; const cy = h * 0.6; const R = w * 0.37;
  g.fillStyle = '#b9c7ca'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#7f9298'; g.beginPath(); g.arc(cx, cy, R * 0.86, 0, Math.PI * 2); g.fill();
  const gr = g.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R * 0.78);
  gr.addColorStop(0, '#9fd8e6'); gr.addColorStop(0.55, '#3b7f99'); gr.addColorStop(1, '#1d3a56');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 0.74, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(cx - R * 0.3, cy - R * 0.35, R * 0.22, R * 0.1, -0.7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#d6e4e4'; g.fillRect(w * 0.1, h * 0.93, w * 0.8, h * 0.03);
};
/** A dryer face: cream, a coral strip, dials, a chrome handle and a smaller porthole. */
const dryerFront = () => (g, w, h) => {
  g.fillStyle = C.cream; g.fillRect(0, 0, w, h);
  g.fillStyle = C.coral; g.fillRect(0, 0, w, h * 0.17);
  g.fillStyle = '#fff3d6'; g.fillRect(w * 0.06, h * 0.045, w * 0.3, h * 0.085);
  for (let i = 0; i < 3; i++) { g.fillStyle = C.ink; g.beginPath(); g.arc(w * (0.5 + i * 0.16), h * 0.085, h * 0.035, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#d8cdb1'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  const cx = w / 2; const cy = h * 0.58; const R = w * 0.33;
  g.fillStyle = '#d8dde0'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8b8f94'; g.beginPath(); g.arc(cx, cy, R * 0.84, 0, Math.PI * 2); g.fill();
  const gr = g.createRadialGradient(cx - R * 0.2, cy - R * 0.3, R * 0.1, cx, cy, R * 0.74);
  gr.addColorStop(0, '#f1dca8'); gr.addColorStop(0.6, '#8a6a4a'); gr.addColorStop(1, '#3a2a22');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 0.72, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c3cacf'; g.fillRect(w * 0.88, h * 0.4, w * 0.045, h * 0.34);
  g.fillStyle = '#e8d9b5'; g.fillRect(w * 0.1, h * 0.93, w * 0.8, h * 0.03);
};
/** The lost-sock board: cork covered in odd socks, pegs and tags (repeats, drawn wrapped). */
const socksTile = () => (g, w, h, r) => {
  g.fillStyle = '#d9b98a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 220; i++) { g.fillStyle = i % 2 ? '#c9a574' : '#e8cca1'; wrap(w, h, (ox, oy) => { g.fillRect(ox + r() * w, oy + r() * h, 2 + r() * 3, 2 + r() * 2); }); }
  const cols = [C.red, C.blue, C.yellow, C.green, C.pink, C.purple, C.orange, C.teal, '#ffffff', C.navy, C.lime, C.coral];
  for (let i = 0; i < 34; i++) {
    const x = r() * w; const y = r() * h; const a = (r() - 0.5) * 2.2; const c = cols[i % cols.length]; const c2 = cols[(i * 5 + 3) % cols.length];
    const kind = i % 3; const s = 0.8 + r() * 0.5;
    wrap(w, h, (ox, oy) => {
      g.save(); g.translate(x + ox, y + oy); g.rotate(a); g.scale(s, s);
      g.fillStyle = c; g.fillRect(-7, -22, 14, 26); // leg
      g.beginPath(); g.ellipse(2, 7, 15, 8, 0.1, 0, Math.PI * 2); g.fill(); // foot
      g.beginPath(); g.arc(-7, 7, 7, 0, Math.PI * 2); g.fill(); // heel
      g.fillStyle = c2;
      if (kind === 0) { g.fillRect(-7, -22, 14, 5); g.fillRect(-7, -12, 14, 3); } // cuff + stripe
      else if (kind === 1) { for (let k = 0; k < 4; k++) g.fillRect(-7, -20 + k * 7, 14, 3); } // stripes
      else { for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(-3 + (k % 2) * 7, -17 + k * 5, 2, 0, Math.PI * 2); g.fill(); } } // spots
      g.fillStyle = '#b08a4c'; g.fillRect(-2, -24, 4, 6); // peg
      g.restore();
    });
  }
  g.fillStyle = '#fffbe8';
  for (let i = 0; i < 5; i++) wrap(w, h, (ox, oy) => { g.fillRect(ox + r() * w, oy + r() * h, 12, 8); });
};

function build(atlas) {
  atlas.add('floor', P.checker({ a: '#f7fbfa', b: C.aqua, n: 4 }), { size: 'L' });
  atlas.add('subway', P.bricks({ brick: '#f7fbfa', alt: '#edf4f3', mortar: '#bfd0ce', rows: 12, cols: 6 }), { size: 'L' });
  atlas.add('subwayAqua', P.bricks({ brick: '#8fd6cd', alt: '#7fcbc2', mortar: '#d9efec', rows: 12, cols: 6 }), { size: 'M' });
  atlas.add('washer', washerFront(), { w: 128, h: 144, repeat: false });
  atlas.add('dryer', dryerFront(), { w: 128, h: 144, repeat: false });
  atlas.add('socks', socksTile(), { size: 'L' });
  atlas.add('shirtPlaid', Q.plaid({ bg: '#c8463b', a: C.navy, b: C.yellow }), { size: 'S' });
  atlas.add('shirtPlaid2', Q.plaid({ bg: '#3f6fd1', a: '#f7fbfa', b: C.coral }), { size: 'S' });
  atlas.add('shirtStripe', P.stripes({ cols: [C.navy, '#f7fbfa'], n: 4 }), { size: 'S' });
  atlas.add('shirtDots', P.dots({ bg: C.yellow, fg: C.purple, n: 4, r: 0.2 }), { size: 'S' });
  atlas.add('towel', P.stripes({ cols: [C.coral, '#f7fbfa', C.coral, C.aquaD], widths: [3, 1, 3, 2], n: 2 }), { size: 'S' });
  atlas.add('cloth', P.cloth({ bg: '#e9eef0', fold: '#c3ced2', cols: [C.pink, C.sky, C.yellow, C.lilac] }), { size: 'M' });
  atlas.add('soap', Q.products({ cols: [C.blue, C.coral, C.yellow, C.green, C.purple, C.orange, C.teal, C.pink], rows: 1, bg: '#f7fbfa' }), { w: 480, h: 72 });
  atlas.add('soapBox', Q.products({ cols: [C.blue, C.coral, C.yellow, C.green, C.red], rows: 2, bg: '#ffffff' }), { size: 'M' });
  atlas.add('block', P.bricks({ brick: '#d9d4c8', alt: '#cfc9bc', mortar: '#a9a296', rows: 6, cols: 3 }), { size: 'M' });
  atlas.add('concrete', P.soil({ base: '#b9b4ab', speck: '#a39d93', stone: '#cfcac0' }), { size: 'M' });
  atlas.add('laminate', Q.grid({ bg: '#e4f1ef', line: '#c4dcd8', n: 2, lw: 3 }), { size: 'M' });
  atlas.add('wire', Q.grid({ bg: '#e7ecef', line: '#8a969c', n: 4, lw: 3 }), { size: 'M' });
  atlas.add('ceilgrid', Q.grid({ bg: '#f4f1ea', line: '#c9c2b4', n: 2, lw: 4 }), { size: 'M' });
  atlas.add('wood', P.wood({ n: 6 }), { size: 'M' });
  atlas.add('slats', Q.slats({ n: 4 }), { size: 'M' });
  atlas.add('rings', P.rings({ n: 3 }), { size: 'S' });
  atlas.add('screen', P.screen({ bg: '#243b55', glare: 'rgba(255,255,255,0.22)' }), { size: 'M', repeat: false });
  atlas.add('signSpin', Q.sign({ bg: C.navy, fg: '#f7fbfa', text: 'SPIN CYCLE', sub: 'launderette · open 24 hours', border: C.aquaD }), { w: 240, h: 80, repeat: false });
  atlas.add('signSocks', Q.sign({ bg: C.yellow, fg: C.ink, text: 'LOST SOCKS', sub: 'claim yours', border: C.coral }), { w: 240, h: 80, repeat: false });
  atlas.add('signFold', Q.sign({ bg: '#f7fbfa', fg: C.aquaD, text: 'FOLD HERE', sub: 'please be kind to the tables' }), { w: 240, h: 80, repeat: false });
  atlas.add('signStaff', Q.sign({ bg: C.yellow, fg: C.ink, text: 'STAFF ONLY' }), { w: 240, h: 80, repeat: false });
  atlas.add('signSoap', Q.sign({ bg: '#ffffff', fg: C.coral, text: 'SOAP', sub: 'a scoop for a pound' }), { w: 240, h: 80, repeat: false });
  atlas.add('signChange', Q.sign({ bg: '#ffffff', fg: C.navy, text: 'CHANGE', sub: 'notes in, coins out' }), { w: 240, h: 80, repeat: false });
  atlas.add('signDry', Q.sign({ bg: C.coral, fg: '#ffffff', text: 'DRYERS', sub: '50p for 10 min', border: '#a8402f' }), { w: 240, h: 80, repeat: false });
  atlas.add('poster1', Q.pic({ kind: 'wave', cols: [C.sky, C.blue, '#ffffff', C.yellow] }), { size: 'M', repeat: false });
  atlas.add('poster2', Q.pic({ kind: 'still', cols: [C.coral, C.yellow, C.green, C.aqua] }), { size: 'M', repeat: false });
  atlas.add('label', P.label({ bg: '#ffffff', band: C.coral, text: C.ink }), { size: 'S', repeat: false });

  return function* fill(b) {
    const r = seeded('launderette');
    const T = 0.16;
    yield 'shell';
    // ── shell: plinth, subway-tile walls with an aqua dado, a low front wall ──
    b.add(boxGeo(W + 0.9, 0.36, D + 0.9, { round: 0.04 }), { at: [0, -0.2, 0], color: '#4b6a78' });
    b.add(boxGeo(W + 2.4, 0.1, D + 3.0, {}), { at: [0, -0.33, 0.5], color: '#b9c9cc', outline: false });
    const shellWall = (x0, z0, x1, z1, name, face) => {
      // two tile bands (aqua dado under white), one collider for the whole wall
      aabb(b, x0, 0, z0, x1, DADO, z1, { tile: 'subwayAqua', rep: 0.8, color: '#ffffff', outline: false });
      aabb(b, x0, DADO, z0, x1, CEIL, z1, { tile: 'subway', rep: 0.8, color: '#ffffff', outline: false });
      b.collide(x0, 0, z0, x1, CEIL, z1, { wall: true, name });
      // a white-and-aqua trim line between the bands, on the room side
      const [a0, a1, c0, c1] = face === 'z+' ? [x0, x1, z1, z1 + 0.012] : face === 'x+' ? [x1, x1 + 0.012, z0, z1] : [x0 - 0.012, x0, z0, z1];
      aabb(b, face === 'z+' ? a0 : a0, DADO - 0.03, face === 'z+' ? c0 : c0, face === 'z+' ? a1 : a1, DADO + 0.03, face === 'z+' ? c1 : c1, { color: C.aquaD, outline: false });
    };
    shellWall(X0 - T, Z0 - T, X1 + T, Z0, 'back', 'z+');
    shellWall(X0 - T, Z0, X0, Z1, 'left', 'x+');
    shellWall(X1, Z0, X1 + T, Z1, 'right', 'x-');
    aabb(b, X0 - T, 0, Z1, X1 + T, 0.6, Z1 + T, { color: '#e3f2ef', outline: true, collide: { wall: true, name: 'front' } });
    aabb(b, X0 - T, 0.56, Z1 - 0.02, X1 + T, 0.62, Z1 + T + 0.02, { color: C.aquaD, outline: true });
    b.collide(X0 - T, 0.6, Z1, X1 + T, CEIL + 2, Z1 + 0.4, { wall: false, climb: false, name: 'front-guard' });
    // the lid runs to the walls' inner faces; its outer edge over the wall tops is no place to cling to
    for (const [x0, z0, x1, z1] of [[X0 - T - 0.05, Z0 - T - 0.05, X0, Z1], [X1, Z0 - T - 0.05, X1 + T + 0.05, Z1], [X0 - T - 0.05, Z0 - T - 0.05, X1 + T + 0.05, Z0]]) b.collide(x0, CEIL, z0, x1, CEIL + 0.3, z1, { wall: false, climb: false, name: 'eave-guard' });
    // shop-front frame: two steel posts and a lintel over the middle of the low wall, an OPEN sign
    for (const x of [-1.6, 1.6]) aabb(b, x - 0.08, 0.6, Z1, x + 0.08, 2.4, Z1 + T, { color: C.steel, outline: true });
    aabb(b, -1.68, 2.4, Z1, 1.68, 2.56, Z1 + T, { color: C.steel, outline: true });
    for (const [x0, x1] of [[X0 - T, -1.68], [1.68, X1 + T]]) aabb(b, x0, 2.4, Z1, x1, 2.56, Z1 + T, { color: C.aquaD, outline: true });
    aabb(b, -1.05, 2.58, Z1, 1.05, 2.98, Z1 + 0.06, { color: C.navy, outline: true });
    b.add(boxGeo(1.9, 0.36, 0.01, { fit: true, faces: ['nz'] }), { at: [0, 2.78, Z1 - 0.004], tile: 'signSpin', rep: 1, color: '#ffffff', outline: false });
    yield 'ceiling';
    slab(b, X0, Z0, X1, Z1, CEIL + 0.12, { thick: 0.12, lid: true, under: { tile: 'ceilgrid', rep: 1.2 }, name: 'ceil:launderette' });
    yield 'floors';
    floor(b, X0, Z0, BRX, Z1, 0, { tile: 'floor', rep: 0.8 });
    floor(b, BRX, BRZ, X1, Z1, 0, { tile: 'floor', rep: 0.8 });
    floor(b, BRX, Z0, X1, BRZ, 0, { tile: 'concrete', rep: 1.4 });
    // door mat at the entrance
    b.add(boxGeo(2.6, 0.012, 0.9), { at: [0, 0.012, Z1 - 0.7], color: C.navy, tile: 'shirtStripe', rep: 0.5, outline: true });

    // ── a machine: body + a painted face + a hollow ring round the porthole ──
    const machine = (f, kind) => {
      const dry = kind === 'dryer';
      const w = 0.82; const h = 0.92; const d = 0.76;
      f.box(w, h, d, [0, h / 2, 0], { color: dry ? C.cream : C.machine, collide: { wall: true, name: kind } });
      f.box(w - 0.05, h - 0.05, 0.006, [0, h / 2, d / 2 + 0.003], { faces: ['pz'], tile: kind, rep: 1, fit: true, color: '#ffffff', outline: false });
      f.cyl(dry ? 0.25 : 0.29, dry ? 0.25 : 0.29, 0.05, [0, h * (dry ? 0.42 : 0.4), d / 2 + 0.02], { rot: [Math.PI / 2, 0, 0], caps: false, radial: 16, color: dry ? C.steel : '#c3cdd0' });
    };

    yield 'wash wall';
    // ── wash wall: eight identical washers on the back wall, a detergent shelf and the sign above ──
    const WP = 0.86;
    for (let i = 0; i < 8; i++) machine(F(b, -8.4 + i * WP, Z0 + 0.38, 0), 'washer');
    b.blob(-5.4, Z0 + 0.4, 3.6, 0.5, { a: 0.2 });
    aabb(b, -8.82, 1.62, Z0, -1.95, 1.66, Z0 + 0.34, { color: C.steel, outline: true, collide: { wall: false, perch: true, name: 'perch:shelf' } });
    aabb(b, -8.8, 1.66, Z0 + 0.02, -1.97, 2.0, Z0 + 0.3, { tile: 'soap', rep: [2.6, 0.34], uvOff: [0.17, 0], color: '#ffffff', outline: true, collide: { wall: true, name: 'soap-shelf' } });
    for (const x of [-8.5, -5.4, -2.3]) aabb(b, x - 0.02, 1.4, Z0, x + 0.02, 1.62, Z0 + 0.3, { color: C.steel, outline: false });
    aabb(b, -6.74, 2.26, Z0, -4.06, 2.98, Z0 + 0.05, { color: C.aquaD, outline: true, collide: { wall: true, name: 'sign-board' } });
    b.add(boxGeo(2.6, 0.64, 0.01, { fit: true, faces: ['pz'] }), { at: [-5.4, 2.62, Z0 + 0.055], tile: 'signSpin', rep: 1, color: '#ffffff', outline: false });
    picture(b, 2.35, 1.7, Z0 + 0.0, 0.5, 0.64, 'z+', 'poster2', { frame: C.aquaD, depth: 0.02 });

    yield 'dryer wall';
    // ── dryer wall: nine columns of two stacked dryers along the left wall, a vent duct above ──
    for (let i = 0; i < 9; i++) for (let k = 0; k < 2; k++) {
      const f = F(b, X0 + 0.38, -5.1 + 0.43 + i * WP, Math.PI / 2, k * 0.92);
      machine(f, 'dryer');
    }
    b.blob(-8.5, -1.2, 0.55, 4.2, { a: 0.2 });
    b.add(cylGeo(0.16, 0.16, 8.0, { radial: 12 }), { at: [X0 + 0.3, 2.2, -1.3], rot: [Math.PI / 2, 0, 0], color: '#c3ccd1', tile: 'rings', rep: [0.6, 0.5] });
    b.collide(X0, 2.04, -5.3, X0 + 0.5, 2.36, 2.7, { wall: false, perch: true, name: 'perch:vent' });
    for (const z of [-4.4, -1.3, 1.9]) b.add(cylGeo(0.09, 0.09, CEIL - 2.36, { radial: 8 }), { at: [X0 + 0.3, (CEIL + 2.36) / 2, z], color: '#c3ccd1', tile: 'rings', rep: [0.6, 0.5] });
    b.add(boxGeo(0.02, 0.4, 1.46), { at: [X0 + 0.01, 2.7, -3.2], color: C.coral, outline: true });
    b.add(boxGeo(0.01, 0.36, 1.4, { fit: true, faces: ['px'] }), { at: [X0 + 0.022, 2.7, -3.2], tile: 'signDry', rep: 1, color: '#ffffff', outline: false });

    yield 'wash island';
    // ── the island: ten washers back to back (two rows of five), a hanging sign over it ──
    for (let i = 0; i < 5; i++) {
      machine(F(b, -6.4 + i * WP, -2.62, Math.PI), 'washer');
      machine(F(b, -6.4 + i * WP, -1.86, 0), 'washer');
    }
    b.blob(-4.25, -2.24, 2.4, 0.95, { a: 0.2 });
    for (const x of [-5.2, -3.3]) b.add(cylGeo(0.006, 0.006, CEIL - 2.64, { radial: 4, caps: false }), { at: [x, (CEIL + 2.64) / 2, -2.24], color: C.ink, outline: false });
    // (a thin frame, the sign itself proud of it on both sides: a thick frame hid the sign)
    aabb(b, -5.4, 2.26, -2.245, -3.1, 2.66, -2.235, { color: C.aquaD, outline: true });
    b.collide(-5.4, 2.26, -2.26, -3.1, 2.66, -2.22, { wall: true, perch: true, name: 'perch:island-sign' });
    b.add(boxGeo(2.1, 0.3, 0.03, { fit: true, faces: ['pz', 'nz'] }), { at: [-4.25, 2.46, -2.24], tile: 'signDry', rep: 1, color: '#ffffff', outline: false });
    // folded towels and a detergent bottle on the island
    for (let i = 0; i < 3; i++) b.add(boxGeo(0.4, 0.07 + i * 0.01, 0.28), { at: [-5.6 + i * 1.5, 0.92 + 0.04, -2.62 + (i % 2) * 0.76], yaw: i * 0.3, color: '#ffffff', tile: 'towel', rep: 0.35, outline: true });

    yield 'dryer island';
    // ── a second island: four columns of stacked dryers back to back (a 1.8 m ledge to climb onto) ──
    for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) {
      machine(F(b, -5.4 + i * WP, 0.9, Math.PI, k * 0.92), 'dryer');
      machine(F(b, -5.4 + i * WP, 1.66, 0, k * 0.92), 'dryer');
    }
    b.blob(-4.1, 1.28, 1.9, 0.95, { a: 0.2 });

    yield 'pillars';
    // ── two tiled pillars: wall-pose surfaces in the middle of the room ──
    for (const [px, pz] of [[-0.6, -1.4], [-0.6, 2.4]]) {
      aabb(b, px - 0.25, 0, pz - 0.25, px + 0.25, DADO, pz + 0.25, { tile: 'subwayAqua', rep: 0.8, color: '#ffffff', outline: true });
      aabb(b, px - 0.25, DADO, pz - 0.25, px + 0.25, CEIL, pz + 0.25, { tile: 'subway', rep: 0.8, color: '#ffffff', outline: true });
      b.collide(px - 0.25, 0, pz - 0.25, px + 0.25, CEIL, pz + 0.25, { wall: true, name: 'pillar' });
      b.blob(px, pz, 0.45, 0.45, { a: 0.2 });
    }

    yield 'clothes rail';
    // ── a rolling rail of shirts: eight shirts with 0.2 m gaps between them, squeeze through ──
    const RX0 = -7.5; const RX1 = -1.7; const RZ = 4.6; const RY = 1.62;
    b.add(cylGeo(0.014, 0.014, RX1 - RX0, { radial: 6 }), { at: [(RX0 + RX1) / 2, RY, RZ], rot: [0, 0, Math.PI / 2], color: C.steel, outline: false });
    b.collide(RX0, RY - 0.03, RZ - 0.03, RX1, RY + 0.03, RZ + 0.03, { wall: false, perch: true, name: 'perch:rail' });
    for (const x of [RX0, RX1]) {
      b.add(cylGeo(0.016, 0.016, RY + 0.03, { radial: 6 }), { at: [x, (RY + 0.03) / 2, RZ], color: C.steel, outline: false });
      b.add(boxGeo(0.06, 0.04, 0.9), { at: [x, 0.04, RZ], color: C.steel, outline: true });
      for (const sz of [-0.4, 0.4]) b.add(cylGeo(0.035, 0.035, 0.05, { radial: 8 }), { at: [x, 0.025, RZ + sz], color: C.ink, outline: false });
    }
    const SHIRTS = ['shirtPlaid', 'shirtStripe', 'shirtDots', 'shirtPlaid2', 'shirtStripe', 'shirtPlaid', 'shirtDots', 'shirtPlaid2'];
    SHIRTS.forEach((tile, i) => {
      const x = RX0 + 0.5 + i * 0.7; const sh = F(b, x, RZ, (r() - 0.5) * 0.18);
      const col = ['#ffffff', '#ffffff', '#ffffff', '#ffffff'][i % 4];
      sh.box(0.34, 0.6, 0.05, [0, RY - 0.4, 0], { color: col, tile, rep: 0.35, outline: true });
      sh.box(0.14, 0.15, 0.05, [-0.23, RY - 0.17, 0], { color: col, tile, rep: 0.35, rot: [0, 0, 0.7] });
      sh.box(0.14, 0.15, 0.05, [0.23, RY - 0.17, 0], { color: col, tile, rep: 0.35, rot: [0, 0, -0.7] });
      sh.cyl(0.006, 0.006, 0.1, [0, RY - 0.05, 0], { color: C.steel, radial: 4, outline: false });
      b.collide(x - 0.25, RY - 0.72, RZ - 0.04, x + 0.25, RY - 0.08, RZ + 0.04, { wall: false, climb: false, name: 'shirt' });
    });
    b.blob((RX0 + RX1) / 2, RZ, 2.9, 0.4, { a: 0.14 });

    yield 'vending';
    // ── vending: a soap machine and a change machine against the left wall ──
    const vend = (z, col, label, name) => {
      const v = F(b, X0 + 0.4, z, Math.PI / 2);
      v.box(0.9, 1.8, 0.7, [0, 0.9, 0], { color: col, collide: { wall: true, name: name } });
      v.box(0.7, 0.8, 0.01, [0, 1.15, 0.355], { tile: 'soapBox', rep: [0.9, 0.8], color: '#ffffff', outline: false });
      v.box(0.7, 0.18, 0.01, [0, 1.65, 0.355], { tile: label, rep: 1, fit: true, color: '#ffffff', outline: false });
      v.box(0.4, 0.1, 0.06, [0, 0.38, 0.37], { color: C.ink });
      v.blob(0, 0, 0.6, 0.5, { a: 0.22 });
    };
    vend(3.55, C.coral, 'signSoap', 'soap-machine');
    vend(4.65, C.navy, 'signChange', 'change-machine');

    yield 'folding area';
    // ── folding tables with piles of laundry, and carts ──
    const tops = [[4.5, 1.7], [6.7, 1.7], [4.5, 3.9], [6.7, 3.9]];
    tops.forEach(([x, z], i) => {
      const f = F(b, x, z, 0);
      table(f, 1.8, 0.8, 0.9, { top: '#a8d9d2', tile: 'laminate', rep: 0.6, leg: C.steel, legW: 0.06 });
      const piles = [['towel', C.coral], ['shirtStripe', '#ffffff'], ['shirtDots', '#ffffff'], ['towel', '#ffffff']];
      for (let k = 0; k < 2; k++) {
        const [pt, pc] = piles[(i + k) % 4];
        const n = 2 + ((i + k) % 3);
        for (let j = 0; j < n; j++) f.box(0.46, 0.06, 0.34, [-0.45 + k * 0.9, 0.9 + 0.03 + j * 0.065, 0.02], { tile: pt, rep: 0.3, color: pc, outline: true, yaw: (j - 1) * 0.08 });
      }
    });
    b.add(boxGeo(2.0, 0.5, 0.04, { fit: true, faces: ['pz'] }), { at: [5.6, 2.55, 2.8], tile: 'signFold', rep: 1, color: '#ffffff', outline: false });
    aabb(b, 4.58, 2.26, 2.77, 6.62, 2.84, 2.83, { color: C.aquaD, outline: true, collide: { wall: false, perch: true, name: 'perch:fold-sign' } });
    for (const x of [4.7, 6.5]) b.add(cylGeo(0.006, 0.006, CEIL - 2.84, { radial: 4, caps: false }), { at: [x, (CEIL + 2.84) / 2, 2.8], color: C.ink, outline: false });
    const cart = (x, z, yaw, tile) => {
      const c = F(b, x, z, yaw);
      c.box(0.78, 0.5, 0.56, [0, 0.5, 0], { color: '#ffffff', tile: 'wire', rep: 0.3, collide: { wall: true, name: 'cart' } });
      c.box(0.7, 0.14, 0.48, [0, 0.82, 0], { color: '#ffffff', tile, rep: 0.4, outline: true });
      c.box(0.04, 0.5, 0.04, [-0.4, 0.95, 0.2], { color: C.steel, outline: false });
      for (const [sx, sz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) c.cyl(0.05, 0.05, 0.04, [sx, 0.07, sz], { color: C.ink, rot: [0, 0, Math.PI / 2], radial: 8 });
      c.blob(0, 0, 0.5, 0.4, { a: 0.2 });
    };
    cart(3.6, 5.3, 0.2, 'cloth'); cart(7.7, 5.1, Math.PI / 2, 'shirtDots'); cart(-1.0, 5.4, -0.3, 'cloth');
    // a bench along the front of the folding area
    const bn = F(b, 5.6, 5.55, 0);
    bn.box(1.6, 0.06, 0.42, [0, 0.46, 0], { color: '#c99a6b', tile: 'wood', rep: 0.7, collide: { wall: false, name: 'bench' } });
    for (const sx of [-0.7, 0.7]) bn.box(0.06, 0.44, 0.38, [sx, 0.22, 0], { color: C.steel, collide: { wall: false, name: 'bench-leg' } });
    bn.blob(0, 0, 0.85, 0.3, { a: 0.2 });

    yield 'sock wall';
    // ── the lost-sock wall: a cork board covered in odd socks, a bench and a basket below ──
    aabb(b, 8.92, 0.5, 0.5, 9.0, 2.5, 5.5, { faces: ['nx'], tile: 'socks', rep: 0.9, color: '#ffffff', outline: false });
    b.collide(8.92, 0.5, 0.5, 9.0, 2.5, 5.5, { wall: true, name: 'sock-board' });
    for (const [y0, y1] of [[0.44, 0.5], [2.5, 2.56]]) aabb(b, 8.88, y0, 0.44, 9.0, y1, 5.56, { color: '#7a4e35', outline: true });
    for (const z of [0.44, 5.5]) aabb(b, 8.88, 0.5, z, 9.0, 2.5, z + 0.06, { color: '#7a4e35', outline: true });
    b.add(boxGeo(0.02, 0.46, 1.66), { at: [8.99, 2.85, 3.0], color: C.coral, outline: true });
    b.add(boxGeo(0.012, 0.42, 1.6, { fit: true, faces: ['nx'] }), { at: [8.975, 2.85, 3.0], tile: 'signSocks', rep: 1, color: '#ffffff', outline: false });
    // 3D socks hanging off pegs: odd colours, odd lengths
    const sockCols = [C.red, C.blue, C.yellow, C.green, C.pink, C.purple, C.orange, C.teal, '#ffffff', C.lime];
    for (let i = 0; i < 12; i++) {
      const z = 0.75 + (i % 6) * 0.78 + (i > 5 ? 0.35 : 0); const y = 2.25 - (i % 3) * 0.28 - (i > 5 ? 0.55 : 0);
      const sk = F(b, 8.86, z, -Math.PI / 2, y);
      sk.box(0.09, 0.26, 0.05, [0, -0.13, 0], { color: sockCols[i % 10], rot: [0, 0, (r() - 0.5) * 0.4], outline: true, tile: i % 2 ? 'shirtStripe' : undefined, rep: 0.2 });
      sk.box(0.17, 0.08, 0.05, [0.04, -0.28, 0], { color: sockCols[(i + 3) % 10], outline: true });
      b.add(boxGeo(0.02, 0.02, 0.02), { at: [8.86, y, z], color: '#b08a4c', outline: false });
    }
    const sb = F(b, 8.5, 3.0, Math.PI / 2);
    sb.box(4.6, 0.06, 0.5, [0, 0.4, 0], { color: '#c99a6b', tile: 'wood', rep: 0.7, collide: { wall: false, name: 'sock-bench' } });
    for (const sx of [-2.1, 0, 2.1]) sb.box(0.06, 0.38, 0.46, [sx, 0.19, 0], { color: C.steel, collide: { wall: false, name: 'sock-bench-leg' } });
    for (const sx of [-1.5, 0.2, 1.7]) {
      sb.cyl(0.2, 0.17, 0.3, [sx, 0.58, 0], { color: '#ffffff', tile: 'wire', rep: 0.3, collide: { wall: false, name: 'sock-basket' } });
      for (let k = 0; k < 4; k++) sb.sph(0.06, 0.05, 0.06, [sx + (k % 2 - 0.5) * 0.14, 0.76 + (k > 1 ? 0.04 : 0), (k % 3 - 1) * 0.07], { color: sockCols[(k + (sx > 0 ? 2 : 0)) % 10], w: 8, h: 6 });
    }
    sb.blob(0, 0, 2.4, 0.4, { a: 0.18 });

    yield 'back room walls';
    // ── back room: two doors and a service hatch ──
    const BW = { tile: 'block', rep: 1.0 }; const SW = { tile: 'subway', rep: 0.8 };
    wall(b, { x0: BRX, z0: Z0, x1: BRX, z1: BRZ, h: CEIL, t: 0.16, n: SW, p: BW, trim: C.steel, open: [{ c: -3.0, w: 1.4, top: 2.2 }], name: 'w:backroom-w' });
    wall(b, { x0: BRX, z0: BRZ, x1: X1, z1: BRZ, h: CEIL, t: 0.16, n: BW, p: SW, trim: C.steel, open: [{ c: 4.7, w: 1.4, top: 2.2 }, { c: 7.4, w: 1.6, bottom: 0.95, top: 1.75 }], name: 'w:backroom-s' });
    b.add(boxGeo(0.7, 0.2, 0.01, { fit: true, faces: ['pz'] }), { at: [4.7, 2.5, BRZ + 0.09], tile: 'signStaff', rep: 1, color: '#ffffff', outline: false });
    // a counter shelf at the hatch
    aabb(b, 6.5, 0.9, BRZ + 0.1, 8.3, 0.95, BRZ + 0.55, { color: '#c99a6b', outline: true, collide: { wall: false, perch: true, name: 'perch:hatch-counter' } });
    for (const x of [6.7, 8.1]) aabb(b, x - 0.03, 0, BRZ + 0.15, x + 0.03, 0.9, BRZ + 0.5, { color: C.steel, outline: false });

    yield 'back room';
    // ── back room: shelving full of detergent, box towers, drums, a heater, a sink ──
    const bs = F(b, 6.55, Z0 + 0.3, 0);
    const ys = shelves(bs, 4.6, 2.0, 0.5, 5, { color: C.blue, tile: null, name: 'detergent' });
    ys.slice(0, 4).forEach((y, lv) => {
      for (let k = 0; k < 6; k++) {
        if ((lv === 1 && k === 3) || (lv === 2 && (k === 0 || k === 5))) continue;
        bs.box(0.62, 0.32 + (k % 3) * 0.04, 0.34, [-1.85 + k * 0.74, y + 0.19, 0.02], { color: '#ffffff', tile: 'soapBox', rep: [0.7, 0.36], uvOff: [k * 0.3 + lv * 0.2, 0], collide: { wall: true, name: 'detergent-box' } });
      }
    });
    bs.box(2.4, 0.3, 0.03, [0, 2.2, -0.2], { tile: 'signStaff', rep: 1, fit: true, color: '#ffffff', faces: ['pz'] });
    const tower = (x, z, items, seed) => {
      const rr = seeded(seed); let yy = 0;
      for (let i = 0; i < items; i++) {
        const w = 0.62 + rr() * 0.2; const h = 0.34 + rr() * 0.12; const d = 0.46 + rr() * 0.14;
        aabb(b, x - w / 2, yy, z - d / 2, x + w / 2, yy + h, z + d / 2, { color: ['#ffffff', C.card, '#e0b77d', '#ffffff'][i % 4], tile: i % 2 ? 'soapBox' : 'wood', rep: i % 2 ? [0.7, h] : 0.4, outline: true, collide: { wall: true, name: 'carton' } });
        yy += h;
      }
      b.blob(x, z, 0.5, 0.42, { a: 0.2 });
      return yy;
    };
    tower(8.4, -2.7, 4, 't1'); tower(8.4, -4.2, 3, 't3');
    // drums, a heater, a sink and a mop bucket
    [[5.0, -3.6, 0.28], [5.65, -3.4, 0.28], [5.3, -4.2, 0.28]].forEach(([x, z, rad], i) => {
      b.add(cylGeo(rad, rad, 0.9, { radial: 14 }), { at: [x, 0.45, z], color: [C.blue, C.teal, C.blue][i], tile: 'rings', rep: [0.5, 0.6], outline: true, collide: { wall: true, name: 'drum' } });
    });
    b.blob(5.3, -3.8, 0.85, 0.7, { a: 0.2 });
    b.add(cylGeo(0.34, 0.34, 1.5, { radial: 14 }), { at: [3.7, 0.75, -5.5], color: '#e9f2f4', tile: 'rings', rep: [0.7, 0.5], outline: true, collide: { wall: true, name: 'heater' } });
    b.add(sphereGeo(0.34, 0.16, 0.34, { w: 14, h: 6, thetaMax: Math.PI / 2 }), { at: [3.7, 1.5, -5.5], color: '#e9f2f4', outline: true });
    b.blob(3.7, -5.5, 0.5, 0.5, { a: 0.22 });
    aabb(b, 3.08, 0, -4.9, 3.68, 0.85, -4.3, { color: '#e9f2f4', outline: true, collide: { wall: true, name: 'sink' } });
    aabb(b, 3.13, 0.85, -4.85, 3.63, 0.9, -4.35, { color: '#b9c7ca', outline: true });
    b.add(cylGeo(0.015, 0.015, 0.3, { radial: 6 }), { at: [3.2, 1.05, -4.6], color: C.steel, outline: false });
    const mb = F(b, 8.5, -5.0, 0);
    mb.cyl(0.22, 0.2, 0.36, [0, 0.18, 0], { color: C.yellow, collide: { wall: true, name: 'mop-bucket' } });
    mb.cyl(0.014, 0.014, 1.4, [0.06, 0.74, 0], { color: '#c99a6b', rot: [0, 0, 0.15], radial: 6 });
    mb.blob(0, 0, 0.28, 0.28);
    b.add(cylGeo(0.006, 0.006, 0.5, { radial: 4, caps: false }), { at: [6.0, CEIL - 0.25, -3.2], color: C.ink, outline: false });
    b.add(sphereGeo(0.09, 0.09, 0.09, { w: 8, h: 6 }), { at: [6.0, CEIL - 0.55, -3.2], color: '#fff3c4', outline: false });

    yield 'lights';
    // ── strip lights hung low enough to perch on, and a hanging dryer-vent loop ──
    [[-6.2, -4.0], [-2.6, -4.0], [-6.2, 0.6], [-2.6, 0.6], [-5.0, 3.6], [0.3, 1.0], [5.2, 2.8], [7.0, 4.6]].forEach(([x, z]) => {
      aabb(b, x - 0.8, 3.0, z - 0.1, x + 0.8, 3.07, z + 0.1, { color: '#fffbe8', outline: true, collide: { wall: false, perch: true, name: 'perch:lamp' } });
      for (const dx of [-0.55, 0.55]) b.add(cylGeo(0.005, 0.005, CEIL - 3.07, { radial: 4, caps: false }), { at: [x + dx, (CEIL + 3.07) / 2, z], color: C.ink, outline: false });
    });
    // a poster by the folding tables
    picture(b, 3.08, 1.8, 4.2, 0.9, 0.7, 'x+', 'poster1', { frame: C.aquaD, depth: 0.02 });

    yield 'spots';
    // ── spots ──
    b.spot('lobby', { x: -0.6, z: 4.2 });
    b.spot('hiderSpawn', { x: -3.6, z: -4.1, yaw: 0 });
    b.spot('seekerSpawn', { x: 0.6, z: 5.1, yaw: Math.PI });
    b.spot('spawnA', { x: -3.8, z: -0.5, yaw: Math.PI });
    b.spot('spawnB', { x: 1.0, z: 0.9, yaw: Math.PI });
    b.spot('hiderSpawns', [{ x: -3.6, z: -4.1, yaw: 0 }, { x: 7.0, z: -3.0, yaw: Math.PI }, { x: 2.0, z: 3.9, yaw: Math.PI }, { x: -6.6, z: 2.8, yaw: Math.PI }]);
    b.spot('seekerSpawns', [{ x: 0.6, z: 5.1, yaw: Math.PI }, { x: -3.5, z: 5.1, yaw: Math.PI }, { x: 2.0, z: 5.3, yaw: Math.PI }]);
    b.spot('camo', { x: 0.5, z: Z0 + 0.3, y: 0.55, wallNormal: [0, 0, 1], note: 'the open stretch of subway tile and aqua dado' });
    b.spot('rug', { x: 0, z: 5.3, yaw: 0 });
    b.probe('washer-top', [-4.68, 0.92, -1.86], [0, 1, 0], C.machine);
  };
}

export const LAUNDERETTE = {
  id: 'launderette', name: 'Spin Cycle Launderette', blurb: 'Rows of identical washers, a wall of lost socks and a rail of shirts to squeeze between.',
  build, size: 'M', rooms: 6, climbs: 3, time: 1.1,
  info: {
    w: W, d: D,
    floors: [{ y: 0, name: 'Shop floor' }],
    rooms: [
      { name: 'Wash wall', floor: 0, y: 0, x0: -9, z0: -6, x1: 3, z1: -3.4, landmark: 'eight washers and the SPIN CYCLE sign' },
      { name: 'Dryer hall', floor: 0, y: 0, x0: -9, z0: -3.4, x1: 3, z1: 2.2, landmark: 'stacked dryers and the washer island' },
      { name: 'Rail corner', floor: 0, y: 0, x0: -9, z0: 2.2, x1: 3, z1: 6, landmark: 'the rail of shirts and the vending machines' },
      { name: 'Folding tables', floor: 0, y: 0, x0: 3, z0: -1, x1: 8.0, z1: 6, landmark: 'four tables and the FOLD HERE sign' },
      { name: 'Lost socks', floor: 0, y: 0, x0: 8.0, z0: -1, x1: 9, z1: 6, landmark: 'the cork board of odd socks' },
      { name: 'Back room', floor: 0, y: 0, x0: 3, z0: -6, x1: 9, z1: -1, landmark: 'detergent shelves and box towers' },
    ],
    overview: { y: 8.5, radius: 12.5 },
    cams: [
      { name: 'overview', p: [0, 11, 14], t: [0, 0.8, 0] },
      { name: 'wash-wall', p: [-3.0, 1.5, 0.0], t: [-5.4, 1.0, -6] },
      { name: 'dryer-hall', p: [-2.0, 1.6, 3.0], t: [-8.6, 1.0, -1.5] },
      { name: 'rail', p: [-2.0, 1.4, 2.6], t: [-6.5, 1.0, 6] },
      { name: 'folding', p: [3.4, 1.8, 5.6], t: [6.0, 0.8, 1.5] },
      { name: 'socks', p: [5.0, 1.6, 3.0], t: [9, 1.4, 3.0] },
      { name: 'back-room', p: [4.0, 1.8, -1.6], t: [7.0, 1.0, -5.5] },
      { name: 'ceiling', p: [-3.0, 2.8, 4.8], t: [-3.0, 3.1, -3] },
    ],
  },
};
