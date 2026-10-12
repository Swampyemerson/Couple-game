// CANDY WORKS — a one-room sweet factory diorama, 10 × 8 m (small class, like the three originals).
//
//   back wall: pink-and-white candy stripes (calm) · a counter with a cake dome · SWEETS sign
//   left wall: jar shelves (busy: every jar is a pile of tiny sweets)
//   right wall: lolly wallpaper (busy, swirls) and a row of gumball machines
//   middle: a conveyor belt of chocolate bars, a sprinkle rug, a lollipop forest, a chocolate fountain
//   overhead: a candy-cane rail and a gumdrop chandelier to hang from, a plank ceiling
//
// Small maps had one hider and one seeker spawn: this one lists three of each.
import { boxGeo, cylGeo, sphereGeo } from '../geo.js';
import { P } from '../atlas.js';
import { seeded } from '../util.js';
import { Q } from './patterns.js';
import { F, shelves, table } from './lib.js';

const C = {
  ink: '#3a2a2a', pink: '#f4a6c0', rose: '#e8648f', mint: '#a8e0cc', mintD: '#58b99a', cream: '#fff4e0', choc: '#6b3f2a', chocL: '#8a5a3c',
  red: '#e2493b', yellow: '#f2c14e', orange: '#f28c38', purple: '#8e63c9', blue: '#4f86d9', lime: '#b5d94a', white: '#ffffff', steel: '#b8c2c8',
};

// tile-wrap offsets for a mark at v with reach r: the other copies only matter near an edge (9 copies of every mark
// made these painters 3-4x dearer than they need to be: the wallpaper alone was a 120 ms step on a busy box)
const offs = (v, size, r) => (v < r ? [0, size] : v > size - r ? [-size, 0] : [0]);

/** A swirl lollipop face (not repeating): a spiral of two colours. */
const swirl = (a, b) => (g, w, h) => {
  g.fillStyle = a; g.fillRect(0, 0, w, h);
  g.strokeStyle = b; g.lineWidth = w * 0.11; g.lineCap = 'round'; g.beginPath();
  const cx = w / 2; const cy = h / 2;
  for (let t = 0; t < 4.4 * Math.PI * 2; t += 0.25) { const rr = (t / (4.4 * Math.PI * 2)) * w * 0.45; const x = cx + Math.cos(t) * rr; const y = cy + Math.sin(t) * rr; if (t === 0) g.moveTo(x, y); else g.lineTo(x, y); }
  g.stroke();
};
/** Sprinkles on pale icing (repeats): short coloured capsules at random angles, wrapped across the tile edges. */
const sprinkles = () => (g, w, h, r) => {
  g.fillStyle = '#fbe9f0'; g.fillRect(0, 0, w, h);
  const cols = [C.red, C.yellow, C.blue, C.mintD, C.purple, C.orange, '#ffffff', C.rose];
  g.lineCap = 'round'; g.lineWidth = 3;
  for (let i = 0; i < 150; i++) {
    const x = r() * w; const y = r() * h; const a = r() * Math.PI; const dx = Math.cos(a) * 5; const dy = Math.sin(a) * 5; g.strokeStyle = cols[i % cols.length];
    for (const oy of offs(y, h, 8)) for (const ox of offs(x, w, 8)) { g.beginPath(); g.moveTo(x + ox - dx, y + oy - dy); g.lineTo(x + ox + dx, y + oy + dy); g.stroke(); }
  }
};
/** Lolly wallpaper (repeats): pastel field with small swirl discs (wrapped across the tile edges). */
const lolly = () => (g, w, h) => {
  g.fillStyle = '#fdeaf2'; g.fillRect(0, 0, w, h);
  const discs = [[0.25, 0.25, C.rose, '#ffffff'], [0.75, 0.75, C.mintD, '#ffffff'], [0.75, 0.25, C.yellow, C.orange], [0.25, 0.75, C.purple, '#e7d8f7']];
  const R = w * 0.14;
  for (const [fx, fy, a, b] of discs) {
    for (const oy of offs(fy * h, h, R + 2)) for (const ox of offs(fx * w, w, R + 2)) {
      const cx = fx * w + ox; const cy = fy * h + oy;
      g.fillStyle = a; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      g.strokeStyle = b; g.lineWidth = 3; g.beginPath();
      for (let t = 0; t < 14; t += 0.45) { const rr = (t / 14) * R * 0.9; const x = cx + Math.cos(t) * rr; const y = cy + Math.sin(t) * rr; if (t === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
  }
};

function build(atlas, kit) {
  atlas.add('minty', P.checker({ a: '#fbfffd', b: C.mint, n: 4 }), { size: 'L' });
  atlas.add('stripePink', P.stripes({ cols: [C.pink, '#fff7f9'], n: 5 }), { size: 'L' });
  atlas.add('lolly', lolly(), { size: 'L' });
  atlas.add('sprinkles', sprinkles(), { size: 'L' });
  atlas.add('candies', Q.fruit({ bg: '#fff0f5', cols: [C.red, C.yellow, C.blue, C.mintD, C.purple, C.orange, C.rose], n: 40, leaf: '#fff0f5' }), { size: 'M' });
  atlas.add('gum', Q.fruit({ bg: '#fff9ff', cols: [C.red, C.yellow, C.blue, C.lime, C.purple, C.orange], n: 30, leaf: '#fff9ff' }), { size: 'M' });
  atlas.add('swirlA', swirl(C.rose, '#ffffff'), { size: 'S', repeat: false });
  atlas.add('swirlB', swirl(C.mintD, '#ffffff'), { size: 'S', repeat: false });
  atlas.add('swirlC', swirl(C.yellow, C.orange), { size: 'S', repeat: false });
  atlas.add('swirlD', swirl(C.purple, '#e7d8f7'), { size: 'S', repeat: false });
  atlas.add('cane', P.stripes({ cols: [C.red, '#ffffff'], n: 6 }), { size: 'S' });
  atlas.add('belt', P.stripes({ cols: ['#4a3a44', '#5a4a54'], n: 8 }), { size: 'M' });
  atlas.add('choc', Q.grid({ bg: C.chocL, line: C.choc, n: 4, lw: 5 }), { size: 'M' });
  atlas.add('wood', P.wood({ n: 6 }), { size: 'M' });
  atlas.add('ceil', P.stripes({ cols: ['#fff4e0', '#f3e2c4', '#fbeed6', '#eedbbb'], widths: [7, 0.5, 7, 0.5], n: 3 }), { size: 'M' });
  atlas.add('signSweets', Q.sign({ bg: C.pink, fg: C.red, text: 'CANDY WORKS', sub: 'sweets made daily', border: C.rose }), { w: 240, h: 80, repeat: false });
  atlas.add('rings', P.rings({ n: 3 }), { size: 'S' });
  atlas.add('glass', Q.glass({ tint: '#e6f6f8', sheen: 'rgba(255,255,255,0.6)', frame: '#ffffff', n: 1 }), { size: 'M' });

  return function* fill(b) {
    const { room } = kit;
    const w = 10; const d = 8;
    room(b, {
      w, d, h: 2.6, front: 0.7, floorTile: 'minty', floorRep: 1.1, plinth: '#8a5a6e', ceiling: { tile: 'ceil', rep: 1.1 },
      walls: { back: { tile: 'stripePink', rep: 0.9 }, left: { color: '#fdeaf2' }, right: { tile: 'lolly', rep: 0.7 }, front: { color: '#fdeaf2' }, skirt: '#ffffff' },
    });
    const r = seeded('candy');
    b.add(boxGeo(2.4, 0.5, 0.03, { fit: true, faces: ['pz'] }), { at: [-1.6, 2.0, -d / 2 + 0.02], tile: 'signSweets', rep: 1, color: '#ffffff', outline: false });
    yield 'sprinkle rug';
    // the sprinkle rug in the middle (busy ground)
    b.add(boxGeo(3.2, 0.012, 2.4), { at: [0.3, 0.006, 0.9], tile: 'sprinkles', rep: 0.9, color: '#ffffff', outline: true });
    yield 'jar shelves';
    // ── jar shelves along the left wall: jars of sweets with gaps to tuck into ──
    const js = F(b, -w / 2 + 0.3, -0.3, Math.PI / 2);
    const ys = shelves(js, 6.0, 1.9, 0.44, 5, { color: '#ffffff', tile: null, back: C.pink, name: 'jar-shelf' });
    ys.slice(0, 4).forEach((y, lv) => {
      for (let k = 0; k < 8; k++) {
        if ((lv === 1 && (k === 2 || k === 3)) || (lv === 2 && k === 6) || (lv === 3 && k === 0)) continue;
        const tall = 0.3 + ((k + lv) % 3) * 0.04;
        js.cyl(0.15, 0.15, tall, [-2.6 + k * 0.74, y + 0.02 + tall / 2, 0.01], { color: '#ffffff', tile: k % 2 ? 'candies' : 'gum', rep: 0.3, collide: { wall: true, name: 'jar' }, radial: 12 });
        js.cyl(0.1, 0.1, 0.05, [-2.6 + k * 0.74, y + 0.02 + tall + 0.025, 0.01], { color: [C.red, C.mintD, C.yellow, C.purple][(k + lv) % 4], outline: false, radial: 8 });
      }
    });
    yield 'counter';
    // ── the counter against the back wall: a glass case, a cake dome, a till, three stools ──
    const ct = F(b, 2.5, -3.35, 0);
    ct.box(3.4, 0.95, 0.75, [0, 0.475, 0], { color: C.pink, tile: 'stripePink', rep: 0.9, collide: { wall: true, name: 'counter' } });
    ct.box(3.5, 0.05, 0.85, [0, 0.975, 0], { color: '#ffffff', collide: { wall: false, name: 'counter-top' } });
    ct.box(1.6, 0.34, 0.5, [-0.7, 1.17, 0], { color: '#ffffff', tile: 'candies', rep: 0.4, outline: true });
    ct.box(1.64, 0.02, 0.54, [-0.7, 1.35, 0], { color: '#dff3f6', outline: true });
    ct.sph(0.34, 0.3, 0.34, [0.9, 1.0, 0.0], { color: '#fff4e0', w: 14, h: 7, thetaMax: Math.PI / 2, collide: { wall: false, name: 'cake-dome' } });
    ct.cyl(0.28, 0.28, 0.12, [0.9, 1.06, 0], { color: '#ffd1e0' });
    ct.box(0.4, 0.22, 0.3, [1.4, 1.1, 0.05], { color: C.ink });
    ct.box(0.34, 0.16, 0.02, [1.4, 1.34, -0.05], { color: '#9fd8c8', rot: [-0.4, 0, 0], outline: false });
    ct.blob(0, 0, 1.8, 0.5, { a: 0.24 });
    for (let i = 0; i < 3; i++) {
      const sx = 1.0 + i * 0.7;
      const st = F(b, sx, -2.35, 0);
      st.cyl(0.19, 0.19, 0.06, [0, 0.66, 0], { color: '#ffffff', tile: 'cane', rep: 0.3, collide: { wall: false, name: 'stool' } });
      st.cyl(0.03, 0.03, 0.64, [0, 0.33, 0], { color: C.steel, radial: 6 });
      st.cyl(0.17, 0.17, 0.03, [0, 0.015, 0], { color: C.steel, outline: false });
      st.blob(0, 0, 0.26, 0.26);
    }
    yield 'conveyor';
    // ── a conveyor belt across the middle with chocolate bars on it ──
    const cv = F(b, -1.4, 0.1, 0);
    cv.box(3.6, 0.7, 0.8, [0, 0.35, 0], { color: C.mintD, collide: { wall: true, name: 'conveyor' } });
    cv.box(3.5, 0.02, 0.62, [0, 0.71, 0], { color: '#ffffff', tile: 'belt', rep: 0.3, outline: false });
    for (const sx of [-1.75, 1.75]) cv.cyl(0.12, 0.12, 0.64, [sx, 0.71, 0], { rot: [Math.PI / 2, 0, 0], color: C.steel, radial: 10 });
    for (let i = 0; i < 7; i++) { const bx = -1.5 + i * 0.5; cv.box(0.36, 0.06, 0.22, [bx, 0.76, (i % 3 - 1) * 0.1], { color: '#ffffff', tile: 'choc', rep: 0.18, yaw: (i % 3 - 1) * 0.2, outline: true }); }
    for (const sx of [-1.6, 1.6]) for (const sz of [-0.34, 0.34]) cv.box(0.08, 0.12, 0.08, [sx, 0.06, sz], { color: C.steel, outline: false });
    cv.blob(0, 0, 2.0, 0.55, { a: 0.24 });
    yield 'chocolate fountain';
    // ── a chocolate fountain on a table ──
    const ft = F(b, 3.1, 1.0, 0);
    table(ft, 1.1, 1.1, 0.8, { top: '#fff4e0', tile: null, leg: C.mintD, legW: 0.07 });
    ft.lathe([[0.34, 0.0], [0.3, 0.12], [0.1, 0.2], [0.22, 0.34], [0.07, 0.44], [0.16, 0.56], [0.04, 0.66], [0.07, 0.8]], [0, 0.8, 0], { color: '#ffffff', tile: 'choc', rep: 0.5, collide: { wall: true, name: 'fountain' } });
    ft.sph(0.06, 0.06, 0.06, [0, 1.62, 0], { color: C.choc });
    ft.blob(0, 0, 0.7, 0.7, { a: 0.2 });
    yield 'lollipops';
    // ── the lollipop forest: a big pot and a dozen swirl discs on poles ──
    const lp = F(b, -3.3, 2.4, 0);
    lp.lathe([[0.3, 0], [0.4, 0.3], [0.42, 0.5], [0.36, 0.5]], [0, 0, 0], { color: C.mintD, tile: 'rings', rep: [0.5, 0.5], collide: { wall: true, name: 'lolly-pot' } });
    const tiles = ['swirlA', 'swirlB', 'swirlC', 'swirlD'];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2; const rr = 0.1 + (i % 3) * 0.06; const hh = 1.0 + (i % 4) * 0.22;
      const px = Math.cos(a) * rr; const pz = Math.sin(a) * rr;
      lp.cyl(0.011, 0.011, hh, [px, 0.5 + hh / 2, pz], { color: '#ffffff', radial: 5, outline: false });
      lp.cyl(0.17, 0.17, 0.025, [px, 0.5 + hh + 0.12, pz], { rot: [Math.PI / 2, a * 0.5, 0], color: '#ffffff', tile: tiles[i % 4], rep: 1, fit: true, radial: 18 });
    }
    lp.collide(-0.3, 0.5, -0.3, 0.3, 2.05, 0.3, { wall: false, climb: false, name: 'lolly-forest' });
    lp.blob(0, 0, 0.55, 0.55, { a: 0.24 });
    yield 'gumball machines';
    // ── gumball machines along the right wall ──
    [0, 1, 2].forEach((i) => {
      const g = F(b, w / 2 - 0.45, 0.4 + i * 1.15, -Math.PI / 2);
      g.box(0.46, 0.85, 0.46, [0, 0.425, 0], { color: [C.red, C.blue, C.yellow][i], collide: { wall: true, name: 'gum-base' } });
      g.cyl(0.26, 0.2, 0.05, [0, 0.875, 0], { color: C.steel });
      g.sph(0.27, 0.27, 0.27, [0, 1.15, 0], { color: '#ffffff', tile: 'gum', rep: 0.22, w: 14, h: 9, collide: { wall: false, name: 'gum-globe' } });
      g.cyl(0.09, 0.12, 0.08, [0, 1.46, 0], { color: [C.red, C.blue, C.yellow][i], radial: 10 });
      g.box(0.16, 0.12, 0.04, [0, 0.45, 0.24], { color: C.ink });
      g.blob(0, 0, 0.36, 0.36, { a: 0.24 });
    });
    yield 'barrels and crates';
    // ── barrels of sprinkles and a crate staircase up to the jar shelf ──
    [[-3.6, 1.0, 0.3], [-4.05, 1.55, 0.26]].forEach(([x, z, rad], i) => {
      b.add(cylGeo(rad, rad, 0.8, { radial: 14 }), { at: [x, 0.4, z], color: i ? C.blue : C.rose, tile: 'rings', rep: [0.5, 0.6], collide: { wall: true, name: 'barrel' } });
      b.add(cylGeo(rad - 0.03, rad - 0.03, 0.02, { radial: 14 }), { at: [x, 0.81, z], color: '#ffffff', tile: 'sprinkles', rep: 0.5, outline: false });
      b.blob(x, z, rad + 0.1, rad + 0.1, { a: 0.24 });
    });
    const crate = (x, z, h, yaw = 0, col = C.yellow) => { const cr = F(b, x, z, yaw); cr.box(0.7, h, 0.5, [0, h / 2, 0], { color: col, tile: 'wood', rep: 0.6, collide: { wall: true, name: 'crate' } }); cr.blob(0, 0, 0.5, 0.4); };
    crate(-4.2, 3.0, 0.4, 0.1); crate(-4.25, 2.35, 0.8, -0.05, C.orange);
    yield 'overhead';
    // ── overhead: a candy-cane rail and a gumdrop chandelier, both in reach of a hanging chameleon ──
    b.add(cylGeo(0.035, 0.035, 5.6, { radial: 8 }), { at: [0.3, 2.05, 2.2], rot: [0, 0, Math.PI / 2], color: '#ffffff', tile: 'cane', rep: [0.5, 0.15] });
    b.collide(-2.5, 2.0, 2.16, 3.1, 2.1, 2.24, { wall: false, perch: true, name: 'perch:cane' });
    for (const x of [-2.4, 3.0]) b.add(cylGeo(0.006, 0.006, 0.55, { radial: 4, caps: false }), { at: [x, 2.33, 2.2], color: C.ink, outline: false });
    b.add(cylGeo(0.006, 0.006, 0.6, { radial: 4, caps: false }), { at: [-0.4, 2.3, -0.6], color: C.ink, outline: false });
    b.add(cylGeo(0.45, 0.45, 0.05, { radial: 14 }), { at: [-0.4, 1.98, -0.6], color: C.rose });
    b.collide(-0.85, 1.9, -1.05, 0.05, 2.06, -0.15, { wall: false, perch: true, name: 'perch:chandelier' });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.add(sphereGeo(0.09, 0.07, 0.09, { w: 8, h: 6 }), { at: [-0.4 + Math.cos(a) * 0.4, 1.9, -0.6 + Math.sin(a) * 0.4], color: [C.red, C.yellow, C.blue, C.mintD, C.purple][i % 5] }); }

    yield 'spots';
    b.spot('lobby', { x: 1.0, z: 2.9 });
    b.spot('hiderSpawn', { x: 0.0, z: 2.0, yaw: Math.PI });
    b.spot('seekerSpawn', { x: 0.2, z: 3.4, yaw: Math.PI });
    b.spot('spawnA', { x: -2.2, z: 3.3, yaw: Math.PI });
    b.spot('spawnB', { x: 3.1, z: 3.2, yaw: Math.PI });
    b.spot('hiderSpawns', [{ x: 0.0, z: 2.0, yaw: Math.PI }, { x: -2.6, z: -2.4, yaw: 0 }, { x: 1.2, z: -0.9, yaw: Math.PI }]);
    b.spot('seekerSpawns', [{ x: 0.2, z: 3.4, yaw: Math.PI }, { x: -2.2, z: 3.3, yaw: Math.PI }, { x: 3.1, z: 3.2, yaw: Math.PI }]);
    b.spot('camo', { x: -2.9, z: -d / 2 + 0.3, y: 0.5, wallNormal: [0, 0, 1], note: 'the open stretch of pink candy stripes' });
    b.spot('rug', { x: 0.3, z: 0.9, yaw: 0 });
    b.probe('counter-top', [2.5, 1.0, -3.35], [0, 1, 0], '#ffffff');
  };
}

export const CANDY = {
  id: 'candy', name: 'Candy Works', blurb: 'Jar shelves, a conveyor of chocolate and a lollipop forest.',
  build: (a, kit) => build(a, kit), size: 'S', rooms: 1, climbs: 2,
  info: { w: 10, d: 8, rooms: [{ name: 'Candy Works', x0: -5, z0: -4, x1: 5, z1: 4 }] },
};
