// The dioramas, as deterministic data + builder calls. Each map paints its own pattern atlas,
// merges every prop into chunked meshes (with baked outlines), and lists colliders, blob
// shadows, spawns, good hiding spots and eyedropper probe points (used by the tests).
//
// ── MAP FORMAT (v2, backward compatible) ─────────────────────────────────────────────────
// MAPS = BASE_MAPS + EXTRA_MAPS (js/games/chameleon/maps/index.js, owned by the level designer).
// Entry: {
//   id, name, blurb,
//   build(atlas, kit) → (b) => void   register atlas tiles with atlas.add(key, kit.P.<pattern>(…),
//                                     { size: 'S'|'M'|'L'|'XL', repeat }), then return a fill
//                                     function that adds geometry to the builder b (geo.js).
//                                     kit = { frame, room, plant, books, yarn, P, boxGeo, cylGeo,
//                                     sphereGeo, latheGeo, seeded } (don't import ../maps.js).
//   size: 'S'|'M'|'L'|'XL', rooms: n, climbs: 1..3     lobby preview card
//   info?: { w, d,                                       footprint (m), centred on the origin
//            floors: [{ y, name }],                      floor heights (chunking, minimap)
//            rooms: [{ name, floor, x0, z0, x1, z1, landmark }],   culling chunks, minimap, plan
//            overview: { y, radius },                    title-orbit camera
//            atlasPages: 1|2 }                           2 → one 1024×2048 atlas texture
// }
// Builder: b.add(geo, { at, yaw|rot, color, tile, rep, uvOff, outline, collide: true | flags })
//          b.collide(minX, minY, minZ, maxX, maxY, maxZ, flags)
//            flags: { wall, name, ceil: true (overhead surface), perch: true (thin rail/pole/stem),
//                     climb: false (sticky feet slide off) }; names 'ceil:…' / 'perch:…' work too;
//                     boxes < 0.16 m across are perches automatically. Every other face is crawlable.
//          b.blob(x, z, rx, rz, { y, a, yaw }) · b.probe(name, point, normal, hex) · b.room(name, x0, z0, x1, z1, { floor })
//          b.spot(name, value): 'lobby' {x,z}; 'hiderSpawns' / 'seekerSpawns' [{x, y?, z, yaw}] (random,
//            fair: the seeker spawn is picked at seek time away from the hider); legacy 'hiderSpawn',
//            'seekerSpawn', 'spawnA', 'spawnB' {x,z,yaw}; 'camo' {x, z, y, wallNormal}.
// Ceilings: draw only the downward face (boxGeo(..., { faces: ['ny'] }), outline: false) so the
// third-person camera above sees in, plus a { ceil: true } collider ≥ 0.08 m thick. The ground
// (y = 0) needs no collider; upper floors are collider slabs. Outer walls are named
// 'back' / 'front' / 'left' / 'right' (map bounds), else info.w/d is used.
// Sizes: radius 0.24 × size (0.14–0.43 m), head 0.34 × size, step max(0.2, 0.24 × size); the
// squeeze pose is 0.08 m × 0.15 m at every size (fits 0.18 m gaps).
import { boxGeo, cylGeo, sphereGeo, latheGeo, createBuilder } from './geo.js';
import { createAtlas, P } from './atlas.js';
import { seeded } from './util.js';
import { EXTRA_MAPS } from './maps/index.js';

const BASE_MAPS = [
  { id: 'living', name: 'Living Room', blurb: 'Rugs, stripes and a very full bookshelf.', build: (a) => living(a), size: 'S', rooms: 1, climbs: 3, info: { w: 10, d: 8, rooms: [{ name: 'Living room', x0: -5, z0: -4, x1: 5, z1: 4 }] } },
  { id: 'garden', name: 'Garden', blurb: 'Hedges, flower beds and a striped deck chair.', build: (a) => garden(a), size: 'S', rooms: 1, climbs: 1, info: { w: 12, d: 10, rooms: [{ name: 'Garden', x0: -6, z0: -5, x1: 6, z1: 5 }], overview: { y: 5.4, radius: 10.5 } } },
  { id: 'studio', name: 'Art Studio', blurb: 'Splatters, swatches and wet canvases.', build: (a) => studio(a), size: 'S', rooms: 1, climbs: 2, info: { w: 10, d: 8, rooms: [{ name: 'Studio', x0: -5, z0: -4, x1: 5, z1: 4 }] } },
];
const seen = new Set();
/** Every selectable map: the three originals, then the level designer's EXTRA_MAPS (bad entries skipped). */
export const MAPS = [...BASE_MAPS, ...(Array.isArray(EXTRA_MAPS) ? EXTRA_MAPS : [])].filter((m) => {
  if (!m || typeof m.id !== 'string' || typeof m.build !== 'function' || seen.has(m.id)) {
    if (m && typeof console !== 'undefined') console.warn('chameleon: skipping bad map entry', m && m.id);
    return false;
  }
  seen.add(m.id); return true;
});

// Local frame helper: place parts relative to (x, z, yaw).
function frame(b, x, z, yaw = 0) {
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  const W = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const at = (p) => { const [wx, wz] = W(p[0], p[2]); return [wx, p[1], wz]; };
  return {
    W,
    box(w, h, d, p, o = {}) { return b.add(boxGeo(w, h, d, { round: o.round || 0, seg: o.seg || 1, fit: o.fit, faces: o.faces }), { ...o, at: at(p), yaw: yaw + (o.yaw || 0), rot: o.rot ? [o.rot[0], yaw + o.rot[1], o.rot[2]] : undefined }); },
    cyl(rt, rb, h, p, o = {}) { return b.add(cylGeo(rt, rb, h, { radial: o.radial || 14, fit: o.fit }), { ...o, at: at(p), yaw: yaw + (o.yaw || 0), rot: o.rot ? [o.rot[0], yaw + o.rot[1], o.rot[2]] : undefined }); },
    sph(rx, ry, rz, p, o = {}) { return b.add(sphereGeo(rx, ry, rz, { w: o.w || 14, h: o.h || 9, thetaMax: o.thetaMax }), { ...o, at: at(p), yaw: yaw + (o.yaw || 0), rot: o.rot ? [o.rot[0], yaw + o.rot[1], o.rot[2]] : undefined }); },
    lathe(prof, p, o = {}) { return b.add(latheGeo(prof, { radial: o.radial || 16 }), { ...o, at: at(p), yaw: yaw + (o.yaw || 0) }); },
    blob(lx, lz, rx, rz, o = {}) { const [wx, wz] = W(lx, lz); b.blob(wx, wz, rx, rz, { ...o, yaw: yaw + (o.yaw || 0) }); },
    collide(lx0, y0, lz0, lx1, y1, lz1, f) {
      const [ax, az] = W(lx0, lz0); const [bx, bz] = W(lx1, lz1);
      b.collide(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), f);
    },
  };
}

// ── shared furniture ──
function room(b, { w, d, h = 2.5, front = 0.7, t = 0.16, floorTile, floorRep = 1.2, floorColor = '#ffffff', walls, plinth = '#5a3d2b' }) {
  // floor slab (diorama plinth)
  b.add(boxGeo(w + t * 2, 0.32, d + t * 2, { faces: ['py'] }), { at: [0, -0.16, 0], tile: floorTile, rep: floorRep, color: floorColor, outline: false });
  b.add(boxGeo(w + t * 2 + 0.24, 0.3, d + t * 2 + 0.24, { round: 0.04 }), { at: [0, -0.2, 0], color: plinth });
  // walls: back (-z), left (-x), right (+x), front (+z, low)
  const W = walls || {};
  const wall = (cfg, at, sw, sh, sd, axis) => {
    b.add(boxGeo(sw, sh, sd, {}), { at, color: cfg.color || '#ffffff', tile: cfg.tile, rep: cfg.rep || 1, uvOff: cfg.uvOff, outline: axis === 'front', collide: { wall: true, name: axis } });
    // a crisp ink cap along the top edge instead of a full hull (cheap)
    if (axis !== 'front') b.add(boxGeo(sw + 0.002, 0.03, sd + 0.002, { faces: ['py', 'px', 'nx', 'pz', 'nz'] }), { at: [at[0], sh - 0.015, at[2]], color: W.cap || '#3a2f2a', outline: false });
  };
  wall(W.back || {}, [0, h / 2, -d / 2 - t / 2], w + t * 2, h, t, 'back');
  wall(W.left || {}, [-w / 2 - t / 2, h / 2, 0], t, h, d, 'left');
  wall(W.right || {}, [w / 2 + t / 2, h / 2, 0], t, h, d, 'right');
  wall(W.front || {}, [0, front / 2, d / 2 + t / 2], w + t * 2, front, t, 'front');
  // skirting
  if (W.skirt) {
    b.add(boxGeo(w, 0.1, 0.03), { at: [0, 0.05, -d / 2 + 0.015], color: W.skirt });
    b.add(boxGeo(0.03, 0.1, d), { at: [-w / 2 + 0.015, 0.05, 0], color: W.skirt });
    b.add(boxGeo(0.03, 0.1, d), { at: [w / 2 - 0.015, 0.05, 0], color: W.skirt });
  }
}

function plant(b, x, z, s, { pot = '#c8693f', leaf = '#4f7d4f', leaf2 = '#6a9a55', seed = 'p' } = {}) {
  const f = frame(b, x, z);
  const r = seeded(seed);
  const ph = 0.42 * s;
  f.lathe([[0.15 * s, 0], [0.21 * s, ph * 0.8], [0.23 * s, ph], [0.2 * s, ph], [0.18 * s, ph * 0.86]], [0, 0, 0], { color: pot, tile: 'rings', rep: [0.4, ph * 1.05], collide: true });
  f.cyl(0.18 * s, 0.18 * s, 0.02, [0, ph * 0.84, 0], { color: '#5b3a28', outline: false });
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.5;
    const L = (0.45 + r() * 0.3) * s;
    const tilt = 0.55 + r() * 0.5;
    f.sph(0.1 * s, 0.025 * s, L * 0.5, [Math.sin(a) * L * 0.42, ph + 0.28 * s + r() * 0.3 * s, Math.cos(a) * L * 0.42], { color: i % 2 ? leaf : leaf2, rot: [-tilt, a, 0], w: 10, h: 6 });
  }
  for (let i = 0; i < 3; i++) f.cyl(0.012 * s, 0.015 * s, 0.4 * s, [0, ph + 0.15 * s, 0], { color: leaf, rot: [0.2 * (i - 1), i, 0.2 * (i - 1)], outline: false, radial: 5 });
  f.blob(0, 0, 0.32 * s, 0.32 * s);
}

function books(b, f, x0, x1, y, z, depth, cols, r, { gapAt = [], minH = 0.22, maxH = 0.36 } = {}) {
  let x = x0;
  let k = 0;
  while (x < x1 - 0.03) {
    if (gapAt.some(([g0, g1]) => x >= g0 && x < g1)) { x += 0.05; continue; }
    const w = 0.035 + r() * 0.035;
    if (x + w > x1) break;
    const h = minH + r() * (maxH - minH);
    const lean = r() < 0.08 ? 0.18 : 0;
    const col = cols[k++ % cols.length];
    f.box(w, h, depth * (0.8 + r() * 0.18), [x + w / 2, y + h / 2, z], { color: col, tile: 'spine', rep: [w, h], rot: [0, 0, lean], fit: false });
    x += w + 0.004;
  }
}

function yarn(b, x, y, z, r, col, seed) {
  b.add(sphereGeo(r, r, r, { w: 12, h: 8 }), { at: [x, y + r, z], color: col, tile: 'yarn', rep: 0.08, collide: false });
  void seed;
}

// ── LIVING ROOM ─────────────────────────────────────────────────────────
function living(atlas) {
  const C = {
    floor: '#c99a6b', floorAlt: '#b8875b', seam: '#8a5d3b',
    cream: '#efe2c8', sage: '#7fa89a', terracotta: '#c86f5b', mustard: '#e0a43d', leaf: '#5f8a6e',
    teal: '#2f5d73', brick: '#b84a3a', ink: '#3a2a2a', rose: '#e8b4a0', powder: '#cfe0e6', plum: '#7b5ea7', coral: '#e07a5f', sky: '#8fb3c9', olive: '#8a8f3c',
  };
  atlas.add('planks', P.planks({ base: C.floor, alt: C.floorAlt, seam: C.seam, rows: 6 }), { size: 'L' });
  atlas.add('wallpaper', P.wallpaper({ bg: C.cream, stripe: C.sage, thin: C.terracotta, sprig: C.mustard, leaf: C.leaf }), { size: 'L' });
  atlas.add('dotwall', P.dots({ bg: C.powder, fg: '#f7f3ea', n: 4, r: 0.2 }), { size: 'M' });
  atlas.add('kilim', P.kilim({ field: C.brick, border: '#f0d9a8', a: C.teal, b: C.mustard, c: '#f3e7cf', ink: C.ink }), { size: 'XL', repeat: false });
  atlas.add('weave', P.weave({ n: 8, lo: 0.82 }), { size: 'M' });
  atlas.add('wood', P.wood({ n: 6 }), { size: 'M' });
  atlas.add('pdots', P.dots({ bg: C.teal, fg: '#f3e7cf', n: 3, r: 0.2 }), { size: 'M' });
  atlas.add('pstripe', P.stripes({ cols: [C.coral, '#f3e7cf'], n: 3 }), { size: 'M' });
  atlas.add('hounds', P.houndstooth({ a: '#f3e7cf', b: C.brick, n: 6 }), { size: 'M' });
  atlas.add('spine', P.spine({ band: '#f6e7b8' }), { size: 'S', repeat: false });
  atlas.add('rings', P.rings({ n: 3 }), { size: 'S' });
  atlas.add('screen', P.screen({ bg: '#232a33', glare: '#323c48' }), { size: 'M', repeat: false });
  atlas.add('window', P.window({ sky: '#a9d2e6', cloud: '#ffffff', frame: '#f4efe6', hill: '#8fbf7a' }), { size: 'L', repeat: false });
  atlas.add('art1', P.art({ style: 'blocks', cols: [C.brick, C.teal, C.mustard] }), { size: 'M', repeat: false });
  atlas.add('art2', P.art({ style: 'circles', cols: [C.coral, C.mustard, C.teal, C.sage], bg: '#f3ece0' }), { size: 'M', repeat: false });
  atlas.add('chevron', P.chevron({ cols: [C.mustard, '#f3e7cf', C.teal], n: 2 }), { size: 'M' });
  atlas.add('yarn', P.bands({ cols: ['#ffffff', '#d6d6d6'], n: 4 }), { size: 'S' });
  atlas.add('gingham', P.check({ a: '#f7f3ea', b: C.sage, n: 4 }), { size: 'M' });
  atlas.add('curtain', P.stripes({ cols: [C.rose, '#f7f3ea', C.terracotta, '#f7f3ea'], widths: [3, 1, 1, 1], n: 2 }), { size: 'M' });
  atlas.add('wains', P.stripes({ cols: ['#6f8f7a', '#5f7f6a'], widths: [5, 1], n: 4 }), { size: 'M' });

  return (b) => {
    const w = 10; const d = 8;
    room(b, {
      w, d, h: 2.5, front: 0.7, floorTile: 'planks', floorRep: 1.3,
      walls: {
        back: { tile: 'wallpaper', rep: 0.8 },
        left: { tile: 'dotwall', rep: 0.5 },
        right: { color: '#e9cdb1' },
        front: { color: '#e9cdb1' },
        skirt: '#f4ead8',
      },
    });
    // right-wall wainscot panel
    b.add(boxGeo(0.03, 0.9, d - 0.4), { at: [w / 2 - 0.02, 0.45, 0], tile: 'wains', rep: 0.6, color: '#ffffff', collide: { wall: true } });
    const r = seeded('living');

    // Rug + coffee table
    b.add(boxGeo(3.6, 0.012, 2.6, { fit: true }), { at: [-0.5, 0.006, -1.1], tile: 'kilim', rep: 1, outline: true });
    const ct = frame(b, -0.5, -1.25);
    ct.box(1.25, 0.05, 0.65, [0, 0.47, 0], { color: '#8d5a3b', tile: 'wood', rep: 0.5, round: 0.015, collide: true });
    for (const [lx, lz] of [[-0.55, -0.26], [0.55, -0.26], [-0.55, 0.26], [0.55, 0.26]]) ct.box(0.05, 0.45, 0.05, [lx, 0.225, lz], { color: '#6b4430' });
    ct.box(1.1, 0.03, 0.52, [0, 0.12, 0], { color: '#8d5a3b', tile: 'wood', rep: 0.5 }); // lower shelf
    ct.blob(0, 0, 0.75, 0.42, { a: 0.22 });
    // mug + book stack on the table
    ct.cyl(0.045, 0.04, 0.1, [0.32, 0.545, 0.1], { color: C.coral });
    ct.box(0.28, 0.04, 0.2, [-0.3, 0.515, -0.05], { color: C.teal });
    ct.box(0.25, 0.035, 0.18, [-0.29, 0.552, -0.04], { color: C.mustard, yaw: 0.2 });

    // Sofa against the back wall, with a hiding gap behind it
    const sf = frame(b, -0.5, -3.05);
    const fab = { color: C.mustard, tile: 'weave', rep: 0.3 };
    sf.box(2.5, 0.28, 0.95, [0, 0.2, 0], { ...fab, round: 0.05, collide: { wall: true } });
    sf.box(2.5, 0.55, 0.22, [0, 0.62, -0.38], { ...fab, round: 0.07, collide: { wall: true } });
    for (const sx of [-1, 1]) sf.box(0.22, 0.6, 0.95, [sx * 1.25, 0.3, 0], { ...fab, round: 0.07, collide: { wall: true } });
    for (let i = 0; i < 3; i++) sf.box(0.74, 0.14, 0.7, [(i - 1) * 0.77, 0.41, 0.08], { ...fab, round: 0.05, collide: true });
    sf.box(0.42, 0.4, 0.14, [-0.75, 0.68, -0.18], { color: '#ffffff', tile: 'pdots', rep: 0.42, round: 0.06, rot: [-0.25, 0, 0.05] });
    sf.box(0.42, 0.4, 0.14, [0.78, 0.68, -0.18], { color: '#ffffff', tile: 'pstripe', rep: 0.42, round: 0.06, rot: [-0.25, 0, -0.08] });
    for (const sx of [-1.2, 1.2]) for (const sz of [-0.4, 0.4]) sf.cyl(0.03, 0.02, 0.06, [sx, 0.03, sz], { color: '#3a2a2a', outline: false });
    sf.blob(0, 0.05, 1.45, 0.62, { a: 0.3 });

    // Side table + lamp
    const stb = frame(b, -2.35, -3.4);
    stb.cyl(0.26, 0.26, 0.04, [0, 0.55, 0], { color: C.teal, collide: true });
    stb.cyl(0.03, 0.05, 0.53, [0, 0.27, 0], { color: C.ink });
    stb.cyl(0.18, 0.18, 0.02, [0, 0.01, 0], { color: C.ink });
    stb.lathe([[0.05, 0], [0.09, 0.08], [0.06, 0.2]], [0, 0.57, 0], { color: C.coral });
    stb.cyl(0.11, 0.17, 0.18, [0, 0.86, 0], { color: '#f3e7cf', tile: 'gingham', rep: 0.2 });
    stb.blob(0, 0, 0.3, 0.3);

    // Floor lamp
    const fl = frame(b, -4.3, -3.4);
    fl.cyl(0.2, 0.22, 0.04, [0, 0.02, 0], { color: C.ink });
    fl.cyl(0.018, 0.018, 1.55, [0, 0.8, 0], { color: C.ink, radial: 8 });
    fl.cyl(0.18, 0.28, 0.32, [0, 1.62, 0], { color: '#f3e7cf', tile: 'curtain', rep: 0.3 });
    fl.collide(-0.08, 0, -0.08, 0.08, 1.8, 0.08, { wall: false });
    fl.blob(0, 0, 0.26, 0.26);

    // Big plant by the sofa + one in the front corner
    plant(b, 1.45, -3.45, 1.35, { seed: 'liv1', leaf: '#4f7d4f', leaf2: '#7aa35a' });
    plant(b, 4.35, 3.35, 1.0, { seed: 'liv2', pot: '#2f5d73', leaf: '#5f8a6e', leaf2: '#86b06a' });
    plant(b, -4.4, 3.4, 0.8, { seed: 'liv3', pot: '#e0a43d' });

    // Window + curtains + art on the back wall
    b.add(boxGeo(1.6, 1.1, 0.04, { fit: true }), { at: [2.75, 1.45, -d / 2 + 0.02], tile: 'window', rep: 1 });
    b.add(boxGeo(1.8, 0.07, 0.12), { at: [2.75, 0.88, -d / 2 + 0.06], color: '#f4efe6', collide: true });
    for (const sx of [-1, 1]) b.add(boxGeo(0.4, 1.7, 0.06, { round: 0.02 }), { at: [2.75 + sx * 1.0, 1.25, -d / 2 + 0.09], color: '#ffffff', tile: 'curtain', rep: 0.5 });
    b.add(boxGeo(0.7, 0.55, 0.03, { fit: true }), { at: [-1.1, 1.55, -d / 2 + 0.015], tile: 'art1', rep: 1 });
    b.add(boxGeo(0.5, 0.5, 0.03, { fit: true }), { at: [0.2, 1.62, -d / 2 + 0.015], tile: 'art2', rep: 1 });

    // Bookshelf on the left wall
    const bs = frame(b, -4.78, -1.0, Math.PI / 2); // local +z faces into the room
    const shelfW = 1.9; const shelfD = 0.42; const sh = 2.05;
    const woodS = { color: '#7a4e35', tile: 'wood', rep: 0.6 };
    bs.box(shelfW, sh, 0.03, [0, sh / 2, -shelfD / 2 + 0.015], woodS);
    for (const sx of [-1, 1]) bs.box(0.04, sh, shelfD, [sx * (shelfW / 2 - 0.02), sh / 2, 0], { ...woodS, collide: { wall: true } });
    const levels = [0.02, 0.52, 1.02, 1.52, 2.03];
    for (const y of levels) bs.box(shelfW, 0.04, shelfD, [0, y, 0], { ...woodS, collide: { wall: false } });
    const bookCols = [C.teal, C.brick, C.mustard, C.leaf, C.plum, C.coral, '#f3e7cf', C.ink, C.terracotta, C.sky, C.olive];
    books(b, bs, -0.9, 0.9, 0.04, -0.02, 0.3, bookCols, r, { gapAt: [[-0.2, 0.42]] });
    books(b, bs, -0.9, 0.9, 0.54, -0.02, 0.3, [...bookCols].reverse(), r, { gapAt: [[0.25, 0.85]] });
    books(b, bs, -0.9, 0.9, 1.04, -0.02, 0.3, bookCols.slice(3).concat(bookCols.slice(0, 3)), r, { gapAt: [[-0.9, -0.35]] });
    books(b, bs, -0.9, 0.9, 1.54, -0.02, 0.3, bookCols.slice(5).concat(bookCols.slice(0, 5)), r, { gapAt: [[-0.1, 0.3]] });
    bs.blob(0, 0, 1.0, 0.3, { a: 0.25 });
    // step stool beside it
    const stool = frame(b, -4.45, 0.4);
    stool.box(0.42, 0.06, 0.36, [0, 0.42, 0], { color: C.coral, round: 0.02, collide: true });
    for (const [lx, lz] of [[-0.17, -0.14], [0.17, -0.14], [-0.17, 0.14], [0.17, 0.14]]) stool.box(0.04, 0.4, 0.04, [lx, 0.2, lz], { color: C.coral });
    stool.blob(0, 0, 0.3, 0.26);

    // Armchair (facing the coffee table)
    const ac = frame(b, 2.3, -1.4, -Math.PI / 2 - 0.3);
    const hf = { color: '#ffffff', tile: 'hounds', rep: 0.3 };
    ac.box(0.95, 0.28, 0.85, [0, 0.22, 0], { ...hf, round: 0.05, collide: { wall: true } });
    ac.box(0.95, 0.6, 0.2, [0, 0.66, -0.33], { ...hf, round: 0.07, collide: { wall: true } });
    for (const sx of [-1, 1]) ac.box(0.18, 0.55, 0.85, [sx * 0.48, 0.32, 0], { ...hf, round: 0.06, collide: { wall: true } });
    ac.box(0.66, 0.12, 0.62, [0, 0.42, 0.06], { ...hf, round: 0.04, collide: true });
    ac.blob(0, 0, 0.62, 0.55, { a: 0.3 });

    // TV unit on the right wall
    const tv = frame(b, 4.7, -0.3, -Math.PI / 2);
    tv.box(1.7, 0.5, 0.45, [0, 0.29, 0], { color: '#f0e6d6', round: 0.02, collide: { wall: true } });
    tv.box(0.78, 0.36, 0.02, [-0.42, 0.29, 0.226], { color: '#d9cbb4', faces: ['pz'] });
    tv.box(0.78, 0.36, 0.02, [0.42, 0.29, 0.226], { color: '#d9cbb4', faces: ['pz'] });
    for (const sx of [-0.75, 0.75]) tv.cyl(0.02, 0.02, 0.06, [sx, 0.02, 0], { color: C.ink, outline: false });
    tv.box(1.2, 0.7, 0.05, [0, 0.95, -0.05], { color: '#2a2f36', round: 0.015 });
    tv.box(1.12, 0.62, 0.01, [0, 0.95, -0.02], { tile: 'screen', rep: 1, fit: true, faces: ['pz'] });
    tv.box(0.3, 0.05, 0.2, [0, 0.565, -0.05], { color: '#2a2f36' });
    tv.blob(0, 0, 0.95, 0.32, { a: 0.24 });
    // game boxes stacked beside it
    const gb = frame(b, 4.55, 1.05, -Math.PI / 2);
    [[C.brick, 0.4, 0.08], [C.teal, 0.36, 0.1], [C.mustard, 0.42, 0.07], [C.plum, 0.34, 0.09]].reduce((y, [col, sz, hh], i) => {
      gb.box(sz, hh, sz * 0.7, [0, y + hh / 2, 0], { color: col, yaw: i * 0.12 - 0.15, collide: true }); return y + hh;
    }, 0);
    gb.blob(0, 0, 0.3, 0.25);

    // Yarn basket
    const yb = frame(b, 1.3, 0.9);
    yb.lathe([[0.3, 0], [0.36, 0.3], [0.38, 0.32], [0.35, 0.32]], [0, 0, 0], { color: '#c99a5b', tile: 'weave', rep: 0.12, collide: true });
    const yc = [C.coral, C.teal, C.mustard, C.plum, C.sage, C.rose];
    [[-0.12, 0.25, -0.05, 0.13], [0.12, 0.22, 0.08, 0.12], [0.02, 0.3, 0.14, 0.11], [0.1, 0.27, -0.14, 0.1], [-0.16, 0.22, 0.14, 0.1]].forEach(([lx, ly, lz, rr], i) => yarn(b, 1.3 + lx, ly, 0.9 + lz, rr, yc[i % yc.length]));
    yarn(b, 1.85, 0, 1.15, 0.12, C.plum);
    yarn(b, 0.95, 0, 1.45, 0.1, C.mustard);
    yb.blob(0, 0, 0.45, 0.45);

    // Pouf + floor cushions
    b.add(cylGeo(0.36, 0.38, 0.4, { radial: 18 }), { at: [-0.2, 0.2, 1.3], color: '#ffffff', tile: 'chevron', rep: 0.45, collide: true });
    b.blob(-0.2, 1.3, 0.45, 0.45);
    b.add(boxGeo(0.62, 0.14, 0.62, { round: 0.06 }), { at: [2.6, 0.07, 1.9], color: '#ffffff', tile: 'pdots', rep: 0.35, yaw: 0.4, collide: true });
    b.add(boxGeo(0.62, 0.14, 0.62, { round: 0.06 }), { at: [2.75, 0.21, 1.85], color: '#ffffff', tile: 'gingham', rep: 0.35, yaw: 0.1, collide: true });
    b.blob(2.65, 1.9, 0.45, 0.45);

    // Dining nook: table + chairs (walk under)
    const dt = frame(b, -2.9, 2.35);
    dt.box(1.5, 0.05, 0.9, [0, 0.76, 0], { color: '#a8754d', tile: 'wood', rep: 0.6, round: 0.015, collide: true });
    for (const [lx, lz] of [[-0.68, -0.38], [0.68, -0.38], [-0.68, 0.38], [0.68, 0.38]]) dt.box(0.06, 0.74, 0.06, [lx, 0.37, lz], { color: '#7a4e35' });
    dt.box(1.3, 0.008, 0.6, [0, 0.79, 0], { color: '#ffffff', tile: 'gingham', rep: 0.3 });
    dt.cyl(0.08, 0.06, 0.18, [0.3, 0.88, 0], { color: C.sky });
    dt.sph(0.07, 0.06, 0.07, [0.3, 1.02, 0], { color: C.coral });
    for (const [lx, yaw] of [[-0.95, Math.PI / 2], [0.95, -Math.PI / 2]]) {
      const ch = frame(b, ...dt.W(lx, 0), yaw);
      ch.box(0.46, 0.05, 0.44, [0, 0.46, 0], { color: C.teal, round: 0.015, collide: true });
      ch.box(0.46, 0.5, 0.05, [0, 0.72, -0.2], { color: C.teal, round: 0.015, collide: true });
      for (const [a, c] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) ch.box(0.04, 0.44, 0.04, [a, 0.22, c], { color: '#244a5b' });
      ch.blob(0, 0, 0.32, 0.3);
    }
    dt.blob(0, 0, 0.95, 0.6, { a: 0.22 });

    // Toy chest by the front wall
    const tc = frame(b, 0.9, 3.55);
    tc.box(1.0, 0.5, 0.5, [0, 0.25, 0], { color: '#ffffff', tile: 'gingham', rep: 0.25, round: 0.03, collide: { wall: true } });
    tc.box(1.04, 0.06, 0.54, [0, 0.52, 0], { color: C.brick, round: 0.02, collide: true });
    tc.blob(0, 0, 0.6, 0.32);

    // v2 climbing: an exposed rafter across the room (crawl up a wall, then along under it),
    // a pendant lamp hanging from it over the dining table (hang from the shade, perch on the
    // cord), a floating shelf on the right wall (its underside) and a curtain rail (a perch).
    const beamZ = 2.35;
    b.add(boxGeo(w, 0.14, 0.16, { round: 0.01 }), { at: [0, 2.43, beamZ], color: '#7a4e35', tile: 'wood', rep: 0.8, collide: { wall: true, name: 'ceil:rafter', ceil: true } });
    b.add(cylGeo(0.012, 0.012, 0.62, { radial: 6 }), { at: [-2.9, 2.05, beamZ], color: C.ink, outline: false });
    b.collide(-2.915, 1.74, beamZ - 0.015, -2.885, 2.36, beamZ + 0.015, { wall: false, name: 'perch:cord', perch: true });
    b.add(cylGeo(0.12, 0.26, 0.24, { radial: 18 }), { at: [-2.9, 1.62, beamZ], color: '#ffffff', tile: 'chevron', rep: 0.35 });
    b.collide(-3.16, 1.5, beamZ - 0.26, -2.64, 1.74, beamZ + 0.26, { wall: false, name: 'lampshade' });
    b.add(sphereGeo(0.06, 0.06, 0.06, { w: 10, h: 6 }), { at: [-2.9, 1.5, beamZ], color: '#fff3c4', outline: false });
    const fs = frame(b, w / 2 - 0.16, -0.3, -Math.PI / 2);
    fs.box(1.4, 0.05, 0.3, [0, 1.75, 0], { color: '#f4efe6', round: 0.01, collide: { wall: false, name: 'wallshelf' } });
    for (const sx of [-0.55, 0.55]) fs.box(0.03, 0.14, 0.24, [sx, 1.66, -0.02], { color: '#7a4e35' });
    fs.cyl(0.07, 0.06, 0.14, [-0.35, 1.845, 0], { color: C.terracotta, collide: true });
    fs.sph(0.1, 0.08, 0.1, [-0.35, 1.97, 0], { color: C.leaf });
    books(b, fs, 0.05, 0.5, 1.775, 0, 0.2, [C.teal, C.mustard, C.plum, C.coral, '#f3e7cf'], r, { minH: 0.16, maxH: 0.24 });
    b.add(cylGeo(0.015, 0.015, 2.1, { radial: 8 }), { at: [2.75, 2.08, -d / 2 + 0.14], rot: [0, 0, Math.PI / 2], color: C.ink });
    b.collide(1.7, 2.065, -d / 2 + 0.125, 3.8, 2.095, -d / 2 + 0.155, { wall: false, name: 'perch:rail', perch: true });

    // Spawns + spots
    b.spot('lobby', { x: -1.15, z: 1.25 });
    b.spot('hiderSpawn', { x: 0, z: 0.3, yaw: Math.PI });
    b.spot('seekerSpawn', { x: 0.2, z: 3.3, yaw: Math.PI });
    b.spot('spawnA', { x: -3.6, z: 0.6, yaw: Math.PI / 2 });
    b.spot('spawnB', { x: 3.4, z: 0.6, yaw: -Math.PI / 2 });
    b.spot('camo', { x: -3.15, z: -3.7, wallNormal: [0, 0, 1], y: 0.42, note: 'open stretch of the back wallpaper' });
    b.spot('rug', { x: -1.5, z: -0.45, yaw: 0 });
    // Probes for the eyedropper test: a wallpaper stripe centre, a plain wall, the teal side table top.
    b.probe('wallpaper-sage-stripe', [-5.16 + 8.095 * 0.8, 2.0, -d / 2 + 0.001], [0, 0, 1], C.sage);
    b.probe('right-wall-paint', [w / 2 - 0.001, 1.6, 2.0], [-1, 0, 0], '#e9cdb1');
    b.probe('side-table-teal', [-2.35 + 0.17, 0.571, -3.4 + 0.05], [0, 1, 0], C.teal);
  };
}

// ── GARDEN ──────────────────────────────────────────────────────────────
function garden(atlas) {
  const C = {
    grassA: '#8cbf63', grassB: '#7bb156', fleck: '#a9d47e', hedge: '#4c7f3c', hedgeL: '#6ea44f', hedgeD: '#335f2b',
    soil: '#7a5236', speck: '#5e3d27', stone: '#a89b8c', fence: '#f4f1e8', path: '#c9bcab',
    red: '#d9534f', yellow: '#f2c14e', pink: '#f08aa8', purple: '#8e6bbf', orange: '#f28c38', blue: '#5b8fd1', white: '#fbf7ee',
    wood: '#a8754d', woodD: '#7a4e35', shed: '#6f9fb0', teal: '#2f6f73',
  };
  atlas.add('lawn', P.lawn({ a: C.grassA, b: C.grassB, fleck: C.fleck }), { size: 'L' });
  atlas.add('leafy', P.leafy({ base: C.hedge, light: C.hedgeL, dark: C.hedgeD, n: 60 }), { size: 'L' });
  atlas.add('bed', P.blooms({ bg: C.soil, leaf: '#4f7d3c', cols: [C.red, C.yellow, C.pink, C.purple, C.white], n: 34 }), { size: 'L' });
  atlas.add('soil', P.soil({ base: C.soil, speck: C.speck, stone: '#9a8b78' }), { size: 'M' });
  atlas.add('deck', P.stripes({ cols: [C.blue, C.white, C.orange, C.white], widths: [3, 1, 3, 1], n: 1 }), { size: 'M' });
  atlas.add('parasol', P.stripes({ cols: [C.red, C.white], n: 4 }), { size: 'M' });
  atlas.add('wood', P.wood({ n: 6 }), { size: 'M' });
  atlas.add('planksV', P.stripes({ cols: ['#ffffff', '#e4e4e4', '#f2f2f2', '#dadada'], widths: [6, 0.5, 6, 0.5], n: 3 }), { size: 'M' });
  atlas.add('flag', P.flag({ base: C.path, dark: '#8f8273', light: '#d8ccbc' }), { size: 'M', repeat: false });
  atlas.add('bricks', P.bricks({ brick: '#b8563f', alt: '#a14a36', mortar: '#e3d6c3', rows: 8, cols: 4 }), { size: 'M' });
  atlas.add('towel1', P.stripes({ cols: [C.pink, C.white], widths: [2, 1], n: 3 }), { size: 'M' });
  atlas.add('towel2', P.check({ a: C.white, b: C.blue, n: 4 }), { size: 'M' });
  atlas.add('towel3', P.dots({ bg: C.yellow, fg: C.white, n: 4, r: 0.2 }), { size: 'M' });
  atlas.add('rings', P.rings({ n: 2 }), { size: 'S' });
  atlas.add('water', P.dots({ bg: '#6fb2c9', fg: '#8cc7d9', n: 3, r: 0.22 }), { size: 'M' });
  atlas.add('spine', P.spine({}), { size: 'S', repeat: false });
  atlas.add('yarn', P.bands({ cols: ['#ffffff', '#d6d6d6'], n: 4 }), { size: 'S' });
  atlas.add('bark', P.bands({ cols: ['#ffffff', '#cfcfcf', '#e8e8e8'], widths: [3, 1, 2], n: 5 }), { size: 'S' });

  return (b) => {
    const w = 12; const d = 10;
    // ground + plinth (soil sides)
    b.add(boxGeo(w + 0.6, 0.3, d + 0.6, { faces: ['py'] }), { at: [0, -0.15, 0], tile: 'lawn', rep: 1.6, color: '#ffffff', outline: false });
    b.add(boxGeo(w + 0.9, 0.5, d + 0.9, { round: 0.05 }), { at: [0, -0.28, 0], color: '#6b4a32' });
    b.add(boxGeo(w + 0.95, 0.08, d + 0.95, { round: 0.03 }), { at: [0, -0.05, 0], color: '#7bb156' });
    // fence (pickets merged as boxes) around three sides + front, with rails
    const fenceH = 1.05;
    const picket = (x, z, yaw) => b.add(boxGeo(0.09, fenceH, 0.025, { faces: ['px', 'nx', 'pz', 'nz'] }), { at: [x, fenceH / 2, z], yaw, color: C.fence, tile: 'wood', rep: 0.5 });
    const side = (x0, z0, x1, z1, yaw, front) => {
      const L = Math.hypot(x1 - x0, z1 - z0); const n = Math.floor(L / 0.14);
      for (let i = 0; i <= n; i++) { const t = i / n; picket(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, yaw); }
      for (const y of [0.25, 0.8]) b.add(boxGeo(L, 0.07, 0.03), { at: [(x0 + x1) / 2, y, (z0 + z1) / 2 + (front ? 0.03 : -0.03)], yaw, color: C.fence });
    };
    side(-w / 2, -d / 2, w / 2, -d / 2, 0);
    side(-w / 2, -d / 2, -w / 2, d / 2, Math.PI / 2);
    side(w / 2, -d / 2, w / 2, d / 2, Math.PI / 2);
    side(-w / 2, d / 2, -0.9, d / 2, 0, true); side(0.9, d / 2, w / 2, d / 2, 0, true);
    b.collide(-w / 2 - 0.2, 0, -d / 2 - 0.2, w / 2 + 0.2, fenceH, -d / 2 + 0.02, { wall: true, name: 'fence-back' });
    b.collide(-w / 2 - 0.2, 0, -d / 2, -w / 2 + 0.02, fenceH, d / 2, { wall: true, name: 'fence-left' });
    b.collide(w / 2 - 0.02, 0, -d / 2, w / 2 + 0.2, fenceH, d / 2, { wall: true, name: 'fence-right' });
    b.collide(-w / 2, 0, d / 2 - 0.02, w / 2, 3, d / 2 + 0.2, { wall: false, name: 'front' });
    // gate arch
    b.add(boxGeo(0.12, 1.6, 0.12), { at: [-0.95, 0.8, d / 2], color: C.woodD });
    b.add(boxGeo(0.12, 1.6, 0.12), { at: [0.95, 0.8, d / 2], color: C.woodD });
    b.add(boxGeo(2.1, 0.12, 0.16), { at: [0, 1.62, d / 2], color: C.woodD });
    const r = seeded('garden');

    // Back hedge (U-shape) with a gap to crawl into
    const hedge = { color: '#ffffff', tile: 'leafy', rep: 0.9, collide: { wall: true } };
    b.add(boxGeo(4.2, 1.3, 0.8, { round: 0.18, seg: 2 }), { at: [-3.4, 0.65, -4.4], ...hedge });
    b.add(boxGeo(3.0, 1.3, 0.8, { round: 0.18, seg: 2 }), { at: [1.4, 0.65, -4.4], ...hedge });
    b.add(boxGeo(0.8, 1.1, 2.6, { round: 0.18, seg: 2 }), { at: [-5.4, 0.55, -2.4], ...hedge });
    b.blob(-3.4, -4.4, 2.3, 0.6, { a: 0.28 }); b.blob(1.4, -4.4, 1.7, 0.6, { a: 0.28 }); b.blob(-5.4, -2.4, 0.6, 1.5, { a: 0.28 });
    // round topiary balls
    for (const [x, z, s] of [[3.2, -4.45, 0.42], [-1.2, -4.45, 0.38], [5.2, 0.6, 0.45]]) {
      b.add(sphereGeo(s, s, s, { w: 14, h: 10 }), { at: [x, s, z], color: '#ffffff', tile: 'leafy', rep: 0.6, collide: { wall: true } });
      b.blob(x, z, s * 1.05, s * 1.05, { a: 0.3 });
    }

    // Flower beds (raised borders)
    const bed = (x, z, bw, bd) => {
      b.add(boxGeo(bw, 0.24, bd, { faces: ['py'] }), { at: [x, 0.12, z], tile: 'bed', rep: 0.9, color: '#ffffff', collide: true });
      for (const [sx, sz, lw, ld] of [[0, -bd / 2, bw + 0.12, 0.08], [0, bd / 2, bw + 0.12, 0.08], [-bw / 2, 0, 0.08, bd], [bw / 2, 0, 0.08, bd]]) b.add(boxGeo(lw, 0.28, ld), { at: [x + sx, 0.14, z + sz], color: '#b8563f', tile: 'bricks', rep: 0.5 });
      // flower heads sticking up
      for (let i = 0; i < bw * bd * 10; i++) {
        const fx = x + (r() - 0.5) * (bw - 0.2); const fz = z + (r() - 0.5) * (bd - 0.2);
        const col = [C.red, C.yellow, C.pink, C.purple, C.white, C.orange][i % 6];
        const hh = 0.15 + r() * 0.25;
        b.add(cylGeo(0.008, 0.01, hh, { radial: 4, caps: false }), { at: [fx, 0.24 + hh / 2, fz], color: '#4f7d3c', outline: false });
        b.add(sphereGeo(0.05, 0.035, 0.05, { w: 8, h: 5 }), { at: [fx, 0.24 + hh, fz], color: col, outline: i % 3 === 0 });
      }
      b.blob(x, z, bw * 0.55, bd * 0.55, { a: 0.15 });
    };
    bed(-4.6, 2.4, 1.3, 3.4);
    bed(4.7, -2.6, 1.2, 3.0);
    bed(-1.6, -3.4, 2.0, 0.9);

    // Stepping-stone path from the gate to the shed
    const stones = [[0, 4.3], [0.3, 3.5], [0.8, 2.7], [1.5, 2.0], [2.2, 1.2], [2.8, 0.3], [3.2, -0.6], [3.4, -1.6]];
    stones.forEach(([x, z], i) => { b.add(cylGeo(0.3 + (i % 3) * 0.04, 0.32, 0.04, { radial: 10, fit: true }), { at: [x, 0.02, z], yaw: i, tile: 'flag', rep: 1, color: '#ffffff' }); });

    // Shed (back right) — walls collide, door is a panel
    const sh = frame(b, 4.2, -4.0);
    sh.box(2.4, 2.0, 1.6, [0, 1.0, 0], { color: C.shed, tile: 'planksV', rep: 0.9, collide: { wall: true } });
    sh.box(2.7, 0.1, 2.0, [0, 2.1, 0.1], { color: '#5a3d2b', rot: [0.12, 0, 0] });
    sh.box(0.8, 1.5, 0.04, [-0.5, 0.75, 0.81], { color: '#f4efe6' });
    sh.box(0.5, 0.45, 0.04, [0.55, 1.2, 0.81], { color: '#a9d2e6' });
    sh.blob(0, 0.2, 1.4, 1.0, { a: 0.3 });
    // Log pile beside it
    for (let i = 0; i < 6; i++) {
      const row = i < 3 ? 0 : i < 5 ? 1 : 2; const k = i < 3 ? i : i < 5 ? i - 3 : 0;
      b.add(cylGeo(0.13, 0.13, 0.9, { radial: 10 }), { at: [2.3 + k * 0.27 + row * 0.135, 0.13 + row * 0.23, -4.45], rot: [Math.PI / 2, Math.PI / 2, 0], color: '#a87c55', tile: 'bark', rep: 0.3, collide: true });
    }
    b.blob(2.55, -4.45, 0.6, 0.5);

    // Deck chair (striped) + side crate
    const dc = frame(b, -2.2, -0.2, 0.5);
    dc.box(0.62, 0.025, 1.1, [0, 0.42, 0.05], { color: '#ffffff', tile: 'deck', rep: [0.62, 1.1], rot: [-0.55, 0, 0], collide: false, fit: false });
    dc.collide(-0.35, 0, -0.45, 0.35, 0.62, 0.55, { wall: true });
    for (const sx of [-1, 1]) {
      dc.box(0.04, 0.04, 1.25, [sx * 0.33, 0.42, 0.05], { color: C.wood, rot: [-0.55, 0, 0] });
      dc.box(0.04, 0.04, 0.9, [sx * 0.33, 0.3, 0.2], { color: C.wood, rot: [0.6, 0, 0] });
    }
    dc.blob(0, 0.05, 0.5, 0.65, { a: 0.24 });
    const cr = frame(b, -1.35, -0.85, 0.2);
    cr.box(0.5, 0.36, 0.42, [0, 0.18, 0], { color: '#d2a46a', tile: 'wood', rep: 0.4, collide: true });
    cr.cyl(0.07, 0.07, 0.18, [0.08, 0.45, 0], { color: C.white });
    cr.blob(0, 0, 0.36, 0.32);

    // Parasol table set
    const pt = frame(b, 1.4, -1.0);
    pt.cyl(0.55, 0.55, 0.04, [0, 0.72, 0], { color: C.white, collide: true });
    pt.cyl(0.03, 0.05, 0.72, [0, 0.36, 0], { color: '#3a3a3a' });
    pt.cyl(0.035, 0.035, 2.0, [0, 1.15, 0], { color: '#3a3a3a', radial: 8 });
    pt.lathe([[1.15, 0], [0.9, 0.22], [0.4, 0.42], [0.02, 0.5]], [0, 1.68, 0], { color: '#ffffff', tile: 'parasol', rep: [1.2, 1.2], radial: 16 });
    for (const a of [0, 2.1, 4.2]) {
      const ch = frame(b, ...pt.W(Math.sin(a) * 0.95, Math.cos(a) * 0.95), a + Math.PI);
      ch.box(0.42, 0.05, 0.42, [0, 0.44, 0], { color: C.teal, collide: true });
      ch.box(0.42, 0.42, 0.05, [0, 0.68, -0.19], { color: C.teal, collide: true });
      for (const [a2, c2] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) ch.box(0.035, 0.44, 0.035, [a2, 0.22, c2], { color: '#1f4f52' });
      ch.blob(0, 0, 0.3, 0.3);
    }
    pt.blob(0, 0, 1.25, 1.25, { a: 0.16 });

    // Pond with lily pads
    b.add(cylGeo(1.1, 1.1, 0.04, { radial: 24, fit: true }), { at: [-1.6, 0.02, 2.6], tile: 'water', rep: 0.6, color: '#ffffff', outline: true });
    for (let i = 0; i < 9; i++) { const a = i * 0.7; b.add(sphereGeo(0.16, 0.08, 0.16, { w: 10, h: 5, thetaMax: Math.PI / 2 }), { at: [-1.6 + Math.cos(a) * 1.25, 0.02, 2.6 + Math.sin(a) * 1.25], color: '#9a9184', collide: false }); }
    b.add(cylGeo(0.14, 0.14, 0.01, { radial: 10 }), { at: [-1.3, 0.045, 2.4], color: '#5f9a4c', outline: false });
    b.add(cylGeo(0.11, 0.11, 0.01, { radial: 10 }), { at: [-1.9, 0.045, 2.9], color: '#5f9a4c', outline: false });

    // Washing line with towels (front right)
    for (const x of [2.0, 5.0]) b.add(cylGeo(0.04, 0.04, 1.8, { radial: 8 }), { at: [x, 0.9, 3.3], color: C.woodD, collide: true });
    b.add(cylGeo(0.006, 0.006, 3.0, { radial: 4, caps: false }), { at: [3.5, 1.72, 3.3], rot: [0, 0, Math.PI / 2], color: '#555', outline: false });
    [['towel1', 2.5, 0.75], ['towel2', 3.4, 0.9], ['towel3', 4.35, 0.8]].forEach(([t, x, hh]) => b.add(boxGeo(0.7, hh, 0.03), { at: [x, 1.72 - hh / 2, 3.3], tile: t, rep: 0.7, color: '#ffffff' }));
    b.blob(3.5, 3.3, 1.6, 0.4, { a: 0.12 });

    // Wheelbarrow, watering can, gnome, pots, bird bath
    const wb = frame(b, 3.6, 1.8, -0.6);
    wb.box(0.7, 0.3, 0.95, [0, 0.42, 0], { color: '#c94f3d', round: 0.06, collide: { wall: true } });
    wb.cyl(0.15, 0.15, 0.06, [0, 0.15, 0.55], { color: '#2f2f2f', rot: [0, 0, Math.PI / 2] });
    for (const sx of [-1, 1]) wb.box(0.04, 0.04, 0.8, [sx * 0.3, 0.3, -0.6], { color: C.woodD, rot: [0.25, 0, 0] });
    wb.blob(0, 0, 0.5, 0.6);
    const wc = frame(b, -3.3, 1.2);
    wc.cyl(0.13, 0.15, 0.3, [0, 0.15, 0], { color: '#3f8f7f', collide: true });
    wc.cyl(0.02, 0.025, 0.36, [0.2, 0.25, 0], { color: '#3f8f7f', rot: [0, 0, -0.9] });
    wc.blob(0, 0, 0.2, 0.2);
    const gn = frame(b, -0.5, -4.2);
    gn.cyl(0.13, 0.15, 0.3, [0, 0.15, 0], { color: C.blue, collide: true });
    gn.sph(0.1, 0.1, 0.1, [0, 0.38, 0], { color: '#f2c9a8' });
    gn.cyl(0.0, 0.11, 0.28, [0, 0.58, 0], { color: C.red });
    gn.sph(0.07, 0.08, 0.05, [0, 0.31, 0.07], { color: C.white });
    gn.blob(0, 0, 0.2, 0.2);
    for (const [x, z, s, col] of [[-5.2, -0.4, 0.8, '#c8693f'], [5.2, 2.6, 0.9, '#2f6f73'], [0.8, 4.5, 0.7, '#e0a43d']]) plant(b, x, z, s, { seed: 'g' + x, pot: col, leaf: '#4c7f3c', leaf2: '#7bb156' });
    const bb = frame(b, 0.2, 0.6);
    bb.lathe([[0.22, 0], [0.12, 0.08], [0.08, 0.6], [0.3, 0.72], [0.36, 0.82], [0.3, 0.84]], [0, 0, 0], { color: '#cfc6b8', collide: true });
    bb.cyl(0.28, 0.28, 0.01, [0, 0.8, 0], { color: '#8cc7d9', outline: false });
    bb.blob(0, 0, 0.32, 0.32);

    b.spot('lobby', { x: 0.6, z: 2.6 });
    b.spot('hiderSpawn', { x: 0, z: 1.8, yaw: Math.PI });
    b.spot('seekerSpawn', { x: 0, z: 4.3, yaw: Math.PI });
    b.spot('spawnA', { x: -3.8, z: 4.0, yaw: Math.PI });
    b.spot('spawnB', { x: 3.6, z: 4.2, yaw: Math.PI });
    b.spot('camo', { x: -3.4, z: -3.95, wallNormal: [0, 0, 1], y: 0.45, note: 'front of the back hedge' });
    b.spot('rug', { x: -2.2, z: -0.2, yaw: 0.5 });
    b.probe('gate-beam', [0.3, 1.681, d / 2], [0, 1, 0], C.woodD);
  };
}

// ── ART STUDIO ──────────────────────────────────────────────────────────
function studio(atlas) {
  const C = {
    cloth: '#ece6da', fold: '#d8d0c2', red: '#e2493b', yellow: '#f2c14e', blue: '#3f6fd1', green: '#3fa66b', pink: '#ef7fa8', orange: '#f28c38', purple: '#7d5bc4', ink: '#2a2730', white: '#f8f5ee', concrete: '#bdb6ab', teal: '#2f8f8f',
  };
  const all = [C.red, C.yellow, C.blue, C.green, C.pink, C.orange, C.purple, C.teal];
  atlas.add('splat', P.splatter({ bg: C.cloth, cols: all, n: 30 }), { size: 'L' });
  atlas.add('swatch', P.swatches({ bg: '#f4efe6', cols: [C.red, C.orange, C.yellow, C.green, C.teal, C.blue, C.purple, C.pink, '#8c5a3c', '#2a2730', '#9fb4c7', '#f4b6a6', '#c9d97a', '#5a3d7a', '#e7d3a1', '#3c6e4f'], nx: 4, ny: 4 }), { size: 'L' });
  atlas.add('tape', P.bands({ cols: ['#f4efe6', C.yellow, '#f4efe6', C.pink, '#f4efe6', C.teal], widths: [6, 1, 3, 1, 5, 1], n: 1 }), { size: 'L' });
  atlas.add('bricks', P.bricks({ brick: '#e9e3d8', alt: '#ddd5c7', mortar: '#c7bfb2', rows: 10, cols: 4 }), { size: 'L' });
  atlas.add('checker', P.checker({ a: C.ink, b: C.white, n: 4 }), { size: 'M' });
  atlas.add('art1', P.art({ style: 'waves', cols: [C.blue, C.teal, C.green, C.yellow, C.orange, C.red] }), { size: 'L', repeat: false });
  atlas.add('art2', P.art({ style: 'blocks', cols: [C.red, C.blue, C.yellow] }), { size: 'L', repeat: false });
  atlas.add('art3', P.art({ style: 'sunset', cols: [C.purple, C.pink, C.orange, C.yellow, '#3c6e4f'] }), { size: 'L', repeat: false });
  atlas.add('art4', P.art({ style: 'circles', cols: [C.pink, C.teal, C.yellow, C.red, C.purple], bg: '#1f2a44' }), { size: 'L', repeat: false });
  atlas.add('art5', P.art({ style: 'stripes', cols: [C.green, C.yellow, C.orange, C.pink, C.purple, C.blue] }), { size: 'M', repeat: false });
  atlas.add('wood', P.wood({ n: 6 }), { size: 'M' });
  atlas.add('label1', P.label({ bg: C.white, band: C.red, text: C.ink }), { size: 'M', repeat: false });
  atlas.add('label2', P.label({ bg: C.white, band: C.blue, text: C.ink }), { size: 'M', repeat: false });
  atlas.add('label3', P.label({ bg: C.white, band: C.yellow, text: C.ink }), { size: 'M', repeat: false });
  atlas.add('apron', P.stripes({ cols: [C.teal, C.white], widths: [1, 1], n: 4 }), { size: 'M' });
  atlas.add('spine', P.spine({}), { size: 'S', repeat: false });
  atlas.add('rings', P.rings({ n: 3 }), { size: 'S' });
  atlas.add('dropcloth', P.cloth({ bg: '#e2d7c3', fold: '#cdbfa6', cols: [C.blue, C.red, C.yellow] }), { size: 'M' });
  atlas.add('herring', P.herringbone({ a: '#c99a6b', b: '#b8875b', seam: '#8a5d3b' }), { size: 'M' });

  return (b) => {
    const w = 10; const d = 8;
    room(b, {
      w, d, h: 2.7, front: 0.6, floorTile: 'splat', floorRep: 1.8, plinth: '#6f6a63',
      walls: {
        back: { tile: 'swatch', rep: 1.2 },
        left: { tile: 'tape', rep: 1.6 },
        right: { tile: 'bricks', rep: 1.0 },
        front: { color: '#e9e3d8' },
        skirt: '#d8d0c2',
      },
    });
    const r = seeded('studio');

    // Checker rug and drop cloth
    b.add(boxGeo(2.4, 0.012, 2.4), { at: [1.6, 0.006, 0.9], tile: 'checker', rep: 0.6, color: '#ffffff' });
    b.add(boxGeo(2.8, 0.02, 2.0, { round: 0.008 }), { at: [-2.4, 0.01, -1.4], tile: 'dropcloth', rep: 0.8, color: '#ffffff', yaw: 0.15 });

    // Easels with canvases
    const easel = (x, z, yaw, art, cw, chh) => {
      const e = frame(b, x, z, yaw);
      for (const sx of [-1, 1]) e.box(0.05, 1.7, 0.05, [sx * 0.35, 0.85, 0], { color: '#a8754d', rot: [0.12, 0, sx * -0.08] });
      e.box(0.05, 1.6, 0.05, [0, 0.8, -0.4], { color: '#a8754d', rot: [-0.25, 0, 0] });
      e.box(0.9, 0.05, 0.12, [0, 0.72, 0.1], { color: '#8d5a3b', collide: true });
      e.box(cw, chh, 0.05, [0, 0.75 + chh / 2, 0.06], { tile: art, rep: 1, fit: true, rot: [0.1, 0, 0], color: '#ffffff' });
      e.collide(-0.45, 0, -0.45, 0.45, 1.7, 0.15, { wall: true });
      e.blob(0, -0.1, 0.55, 0.45, { a: 0.22 });
    };
    easel(-1.0, 0.4, 0.3, 'art1', 0.9, 0.7);
    easel(2.9, -1.8, -0.6, 'art3', 0.7, 0.9);
    easel(0.6, -2.4, 0, 'art4', 0.8, 0.8);
    // big canvases leaning on the walls
    b.add(boxGeo(1.6, 1.3, 0.06, { fit: true }), { at: [-3.3, 0.68, -d / 2 + 0.25], rot: [-0.18, 0, 0], tile: 'art2', rep: 1, color: '#ffffff', collide: { wall: true } });
    b.blob(-3.3, -d / 2 + 0.35, 0.9, 0.25);
    b.add(boxGeo(0.06, 1.1, 1.4, {}), { at: [w / 2 - 0.25, 0.58, 1.6], rot: [0, 0, 0.16], tile: 'art5', rep: [1.4, 1.1], color: '#ffffff', collide: { wall: true } });
    b.blob(w / 2 - 0.35, 1.6, 0.25, 0.8);

    // Shelves with jars on the left wall
    const sh = frame(b, -4.75, 1.7, Math.PI / 2);
    for (const y of [0.0, 0.55, 1.1, 1.65]) sh.box(2.2, 0.04, 0.4, [0, y + 0.02, 0], { color: '#a8754d', tile: 'wood', rep: 0.6, collide: { wall: false } });
    for (const sx of [-1, 1]) sh.box(0.04, 1.7, 0.4, [sx * 1.08, 0.85, 0], { color: '#8d5a3b', collide: { wall: true } });
    for (let s = 0; s < 3; s++) {
      let x = -0.95;
      while (x < 0.95) {
        if ((s === 1 && x > -0.3 && x < 0.35) || (s === 0 && x > 0.2 && x < 0.8)) { x += 0.08; continue; }
        const jr = 0.06 + r() * 0.03; const jh = 0.12 + r() * 0.12; const col = all[r.int(all.length)];
        sh.cyl(jr, jr, jh, [x + jr, s * 0.55 + 0.04 + jh / 2, 0], { color: col, radial: 10 });
        sh.cyl(jr * 0.9, jr * 0.9, 0.03, [x + jr, s * 0.55 + 0.04 + jh + 0.015, 0], { color: C.white, radial: 10, outline: false });
        x += jr * 2 + 0.03;
      }
    }
    sh.blob(0, 0, 1.2, 0.3, { a: 0.22 });

    // Paint cans stack + spilled can
    const pc = frame(b, 3.9, 2.9);
    [[0, 0, 0, 'label1'], [0.36, 0, 0.1, 'label2'], [0.18, 0.3, 0.05, 'label3'], [-0.3, 0, -0.25, 'label2']].forEach(([lx, ly, lz, t]) => pc.cyl(0.16, 0.16, 0.3, [lx, ly + 0.15, lz], { tile: t, rep: [1.0, 0.3], color: '#ffffff', fit: false, collide: true }));
    pc.blob(0, 0, 0.6, 0.5);
    b.add(cylGeo(0.16, 0.16, 0.3, { radial: 14 }), { at: [2.6, 0.16, 3.2], rot: [Math.PI / 2, 0.8, 0], tile: 'label3', rep: [1.0, 0.3], color: '#ffffff', collide: true });
    b.add(cylGeo(0.5, 0.55, 0.01, { radial: 18 }), { at: [2.95, 0.006, 3.5], color: C.yellow, outline: false });

    // Plinths with sculptures
    const plinthAt = (x, z, h, col, shape) => {
      b.add(boxGeo(0.5, h, 0.5, { round: 0.02 }), { at: [x, h / 2, z], color: C.white, collide: { wall: true } });
      if (shape === 'ball') b.add(sphereGeo(0.2, 0.2, 0.2), { at: [x, h + 0.2, z], color: col, collide: true });
      else if (shape === 'cone') b.add(cylGeo(0.0, 0.22, 0.5), { at: [x, h + 0.25, z], color: col, collide: true });
      else b.add(boxGeo(0.3, 0.3, 0.3, { round: 0.06 }), { at: [x, h + 0.15, z], color: col, yaw: 0.6, collide: true });
      b.blob(x, z, 0.36, 0.36, { a: 0.3 });
    };
    plinthAt(-0.3, 2.6, 0.7, C.pink, 'ball');
    plinthAt(0.6, 2.9, 0.45, C.blue, 'cube');
    plinthAt(-1.1, 3.1, 0.9, C.yellow, 'cone');

    // Work table with brush pots and paper rolls
    const wt = frame(b, -2.9, -3.3);
    wt.box(2.0, 0.06, 0.85, [0, 0.82, 0], { color: '#c99a6b', tile: 'splat', rep: 0.9, collide: true });
    for (const [lx, lz] of [[-0.92, -0.36], [0.92, -0.36], [-0.92, 0.36], [0.92, 0.36]]) wt.box(0.07, 0.8, 0.07, [lx, 0.4, lz], { color: '#8d5a3b' });
    wt.box(1.8, 0.04, 0.7, [0, 0.2, 0], { color: '#a8754d', collide: true });
    for (let i = 0; i < 4; i++) {
      wt.cyl(0.07, 0.06, 0.15, [-0.6 + i * 0.28, 0.93, 0.1], { color: all[i + 2] });
      for (let k = 0; k < 3; k++) wt.cyl(0.006, 0.008, 0.28, [-0.6 + i * 0.28 + (k - 1) * 0.02, 1.02, 0.1], { color: '#a8754d', rot: [0.1 * (k - 1), 0, 0.15 * (k - 1)], outline: false, radial: 4 });
    }
    for (let i = 0; i < 3; i++) wt.cyl(0.07, 0.07, 0.8, [0.6 + i * 0.05, 0.3, -0.05 + i * 0.12], { rot: [Math.PI / 2, 0, 0], color: [C.white, '#f4b6a6', '#9fb4c7'][i], collide: false });
    wt.blob(0, 0, 1.2, 0.6, { a: 0.22 });
    // stool
    const st = frame(b, -1.6, -2.1);
    st.cyl(0.2, 0.2, 0.05, [0, 0.62, 0], { color: C.red, collide: true });
    for (const a of [0, 2.1, 4.2]) st.box(0.035, 0.62, 0.035, [Math.sin(a) * 0.14, 0.31, Math.cos(a) * 0.14], { color: C.ink, rot: [Math.cos(a) * 0.1, 0, -Math.sin(a) * 0.1] });
    st.blob(0, 0, 0.25, 0.25);

    // Clothes rack with aprons (right wall)
    const cr = frame(b, 4.4, -2.6, -Math.PI / 2);
    for (const sx of [-0.8, 0.8]) cr.box(0.05, 1.6, 0.05, [sx, 0.8, 0], { color: C.ink });
    cr.box(1.7, 0.04, 0.04, [0, 1.58, 0], { color: C.ink });
    cr.box(0.55, 0.85, 0.04, [-0.4, 1.12, 0], { tile: 'apron', rep: 0.55, color: '#ffffff' });
    cr.box(0.55, 0.95, 0.04, [0.3, 1.07, 0], { color: C.orange });
    cr.collide(-0.9, 0.6, -0.1, 0.9, 1.6, 0.1, { wall: true });
    cr.blob(0, 0, 0.9, 0.2, { a: 0.18 });
    // Big drop-cloth pile
    b.add(sphereGeo(0.7, 0.32, 0.55, { w: 14, h: 8, thetaMax: Math.PI / 2 }), { at: [3.6, 0, 0.3], tile: 'dropcloth', rep: 0.5, color: '#ffffff', collide: true });
    b.blob(3.6, 0.3, 0.75, 0.6);

    b.spot('lobby', { x: 1.6, z: 1.0 });
    b.spot('hiderSpawn', { x: 0.3, z: 0.8, yaw: Math.PI });
    b.spot('seekerSpawn', { x: 0, z: 3.4, yaw: Math.PI });
    b.spot('spawnA', { x: -3.5, z: 2.2, yaw: Math.PI / 2 });
    b.spot('spawnB', { x: 3.2, z: 1.2, yaw: -Math.PI / 2 });
    b.spot('camo', { x: 1.6, z: -3.64, wallNormal: [0, 0, 1], y: 0.8, note: 'swatch wall' });
    b.spot('rug', { x: 1.6, z: 0.9, yaw: 0 });
    b.probe('plinth-white', [-0.3, 0.35, 2.851], [0, 0, 1], C.white);
  };
}


/** Helpers handed to EXTRA_MAPS builders as the 2nd argument (no circular import needed). */
export const KIT = { frame, room, plant, books, yarn, P, boxGeo, cylGeo, sphereGeo, latheGeo, seeded };

/** Map footprint area in m² (from info, else the first room). */
export function mapArea(m) {
  const inf = (m && m.info) || {};
  if (inf.w && inf.d) return inf.w * inf.d * Math.max(1, (inf.floors || []).length);
  return 80;
}

/** Chunk key for a centroid: by room (and floor) when the map lists rooms, else a 6 m grid; small maps stay one chunk. */
function makeChunker(entry) {
  const inf = entry.info || {};
  const rooms = Array.isArray(inf.rooms) ? inf.rooms : [];
  const floors = Array.isArray(inf.floors) ? inf.floors.map((f) => +f.y || 0).sort((a, b) => a - b) : [];
  const floorOf = (y) => { let k = 0; for (let i = 0; i < floors.length; i++) if (y >= floors[i] - 0.05) k = i; return k; };
  if (mapArea(entry) <= 160) return null;
  const G = 6;
  return (x, y, z) => {
    const f = floorOf(y);
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      if ((r.floor || 0) === f && x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) && z >= Math.min(r.z0, r.z1) && z <= Math.max(r.z0, r.z1)) return 1 + f * 100 + i;
    }
    // outside every room (walls between rooms, outdoors): a coarse grid per floor
    return 1000 + f * 400 + (Math.floor(x / G) + 10) * 20 + (Math.floor(z / G) + 10);
  };
}

/** Build a map: returns geometry chunks + atlas + gameplay data. */
export function buildMap(THREE, id, { ink = [0.11, 0.1, 0.13] } = {}) {
  const entry = MAPS.find((m) => m.id === id) || MAPS[0];
  const inf = entry.info || {};
  const atlasB = createAtlas(1024, inf.atlasPages === 2 ? 2048 : 1024);
  const fill = entry.build(atlasB, KIT);
  const atlas = atlasB.finish();
  const b = createBuilder({ tiles: atlas.tiles, ink, chunker: makeChunker(entry) });
  fill(b);
  const out = b.finish(THREE);
  const probes = out.probes.filter((p) => p.point && p.hex);
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const c of out.colliders) {
    if (c.name === 'back') bounds.minZ = c.maxZ; if (c.name === 'front') bounds.maxZ = c.minZ;
    if (c.name === 'left') bounds.minX = c.maxX; if (c.name === 'right') bounds.maxX = c.minX;
    if (c.name === 'fence-back') bounds.minZ = c.maxZ; if (c.name === 'fence-left') bounds.minX = c.maxX; if (c.name === 'fence-right') bounds.maxX = c.minX;
  }
  if (inf.w && inf.d) {
    if (!Number.isFinite(bounds.minX)) bounds.minX = -inf.w / 2; if (!Number.isFinite(bounds.maxX)) bounds.maxX = inf.w / 2;
    if (!Number.isFinite(bounds.minZ)) bounds.minZ = -inf.d / 2; if (!Number.isFinite(bounds.maxZ)) bounds.maxZ = inf.d / 2;
  }
  const rooms = out.rooms.length ? out.rooms : (inf.rooms || []).map((r) => ({ name: r.name, floor: r.floor || 0, landmark: r.landmark || '', x0: Math.min(r.x0, r.x1), z0: Math.min(r.z0, r.z1), x1: Math.max(r.x0, r.x1), z1: Math.max(r.z0, r.z1) }));
  const spots = out.spots;
  // spawn lists (fall back to the legacy single spots)
  const asList = (v) => (Array.isArray(v) ? v.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z)) : []);
  spots.hiderSpawns = asList(spots.hiderSpawns); spots.seekerSpawns = asList(spots.seekerSpawns);
  if (!spots.hiderSpawns.length) spots.hiderSpawns = [spots.hiderSpawn || spots.lobby || { x: 0, z: 0, yaw: 0 }];
  if (!spots.seekerSpawns.length) spots.seekerSpawns = [spots.seekerSpawn || spots.lobby || { x: 0, z: 1, yaw: 0 }];
  if (!spots.lobby) spots.lobby = spots.hiderSpawns[0];
  if (!spots.spawnA) spots.spawnA = spots.hiderSpawns[0];
  if (!spots.spawnB) spots.spawnB = spots.seekerSpawns[spots.seekerSpawns.length - 1];
  const overview = inf.overview && Number.isFinite(inf.overview.radius) ? inf.overview : { y: 5.4, radius: Math.max(9.2, Math.hypot(inf.w || 10, inf.d || 8) * 0.72) };
  return { id, entry, info: inf, atlas, ...out, probes, bounds, rooms, overview, area: mapArea(entry), big: mapArea(entry) > 160 };
}
