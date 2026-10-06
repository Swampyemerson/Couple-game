// Shared building blocks for the big Blend & Seek maps (house, market, greenhouse, museum).
// Everything is axis-aligned, data-driven and cheap: plain boxes for walls (no hulls on big
// faces, an ink cap on top), thin treads for stairs (you can walk underneath the high ones),
// thin railings you can see through, and a y-offset frame helper so upper floors are as easy
// to furnish as the ground floor.
//
// Collider conventions (read by the engine as flags, mirrored in names for debugging):
//   { ceil: true }   an overhead surface a chameleon can hang from (slab undersides, lids)
//   { perch: true }  thin things to perch on (rails, beams, poles, rods, pot racks)
//   names 'back' | 'left' | 'right' | 'front' on the outer walls (map bounds)
import { boxGeo, cylGeo, sphereGeo, latheGeo } from '../geo.js';

export const INK = '#2a2730';

/** Local frame at (x, z, yaw) and floor height oy. Mirrors maps.js frame() with a y offset. */
export function F(b, x, z, yaw = 0, oy = 0) {
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  const W = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const at = (p) => { const [wx, wz] = W(p[0], p[2]); return [wx, p[1] + oy, wz]; };
  const R = (o) => (o.rot ? [o.rot[0], yaw + o.rot[1], o.rot[2]] : undefined);
  return {
    W, oy,
    box(w, h, d, p, o = {}) { return b.add(boxGeo(w, h, d, { round: o.round || 0, seg: o.seg || 1, fit: o.fit, faces: o.faces }), { ...o, at: at(p), yaw: yaw + (o.yaw || 0), rot: R(o) }); },
    cyl(rt, rb, h, p, o = {}) { return b.add(cylGeo(rt, rb, h, { radial: o.radial || 12, fit: o.fit, caps: o.caps !== false }), { ...o, at: at(p), yaw: yaw + (o.yaw || 0), rot: R(o) }); },
    sph(rx, ry, rz, p, o = {}) { return b.add(sphereGeo(rx, ry, rz, { w: o.w || 12, h: o.h || 8, thetaMax: o.thetaMax }), { ...o, at: at(p), yaw: yaw + (o.yaw || 0), rot: R(o) }); },
    lathe(prof, p, o = {}) { return b.add(latheGeo(prof, { radial: o.radial || 14 }), { ...o, at: at(p), yaw: yaw + (o.yaw || 0) }); },
    blob(lx, lz, rx, rz, o = {}) { const [wx, wz] = W(lx, lz); b.blob(wx, wz, rx, rz, { y: oy + 0.004, ...o, yaw: yaw + (o.yaw || 0) }); },
    collide(lx0, y0, lz0, lx1, y1, lz1, f) {
      const [ax, az] = W(lx0, lz0); const [bx, bz] = W(lx1, lz1);
      b.collide(Math.min(ax, bx), y0 + oy, Math.min(az, bz), Math.max(ax, bx), y1 + oy, Math.max(az, bz), f);
    },
  };
}

/** Axis-aligned box from min/max corners. */
export function aabb(b, x0, y0, z0, x1, y1, z1, o = {}) {
  const g = boxGeo(x1 - x0, y1 - y0, z1 - z0, { faces: o.faces, fit: o.fit, round: o.round || 0 });
  return b.add(g, { ...o, at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] });
}

/**
 * A straight interior/exterior wall with openings, two independently dressed sides.
 *   wall(b, { x0, z0, x1, z1, y, h, t, n: {color,tile,rep}, p: {…}, open: [{ c, w, top, bottom }] })
 * Runs along x (z0 === z1) or along z (x0 === x1). Side `n` faces −z / −x, side `p` faces +z / +x.
 * Openings: c = centre along the run, w = width, bottom (sill, default 0), top (default 2.1).
 * A sill > 0 makes a peek window; bottom 0 + low top makes a squeeze gap.
 */
export function wall(b, cfg) {
  const { y = 0, h = 2.6, t = 0.14, open = [], cap = '#3a2f2a', outline = false, name = '', flags = {} } = cfg;
  const alongX = Math.abs(cfg.z0 - cfg.z1) < 1e-6;
  const s0 = alongX ? Math.min(cfg.x0, cfg.x1) : Math.min(cfg.z0, cfg.z1);
  const s1 = alongX ? Math.max(cfg.x0, cfg.x1) : Math.max(cfg.z0, cfg.z1);
  const fixed = alongX ? cfg.z0 : cfg.x0;
  const sides = { n: cfg.n || cfg.both || {}, p: cfg.p || cfg.both || {} };
  const ops = open.map((o) => ({ a: o.c - o.w / 2, b: o.c + o.w / 2, bottom: o.bottom || 0, top: o.top == null ? 2.1 : o.top })).sort((u, v) => u.a - v.a);
  const pieces = [];
  let s = s0;
  for (const o of ops) {
    if (o.a > s + 0.001) pieces.push([s, o.a, 0, h]);
    if (o.bottom > 0.001) pieces.push([o.a, o.b, 0, o.bottom]);
    if (o.top < h - 0.001) pieces.push([o.a, o.b, o.top, h]);
    s = o.b;
  }
  if (s < s1 - 0.001) pieces.push([s, s1, 0, h]);
  for (const [sa, sb, ya, yb] of pieces) {
    const L = sb - sa; const H = yb - ya; const mid = (sa + sb) / 2;
    for (const side of ['n', 'p']) {
      const d = sides[side];
      const sgn = side === 'n' ? -1 : 1;
      const off = sgn * t / 4;
      const faceOut = alongX ? (side === 'n' ? 'nz' : 'pz') : (side === 'n' ? 'nx' : 'px');
      const ends = alongX ? ['px', 'nx'] : ['pz', 'nz'];
      const faces = [faceOut, ...ends, 'py']; if (ya > 0.001) faces.push('ny');
      const rep = d.rep || 1;
      // continuous pattern along the run (see boxGeo face axes)
      const uFwd = alongX ? side === 'p' : side === 'n';
      const uo = uFwd ? sa / rep : -sb / rep;
      const geo = alongX ? boxGeo(L, H, t / 2, { faces }) : boxGeo(t / 2, H, L, { faces });
      b.add(geo, {
        at: alongX ? [mid, y + ya + H / 2, fixed + off] : [fixed + off, y + ya + H / 2, mid],
        color: d.color || '#ffffff', tile: d.tile, rep, uvOff: [uo, ya / rep + (d.v || 0)], outline,
      });
    }
    const hx = alongX ? L / 2 : t / 2; const hz = alongX ? t / 2 : L / 2;
    const cx = alongX ? mid : fixed; const cz = alongX ? fixed : mid;
    b.collide(cx - hx, y + ya, cz - hz, cx + hx, y + yb, cz + hz, { wall: H > 0.4, name, ...flags, ...(ya > 0.001 ? { ceil: true } : {}) });
    if (cap && yb >= h - 0.001) {
      const g = alongX ? boxGeo(L + 0.002, 0.03, t + 0.004, { faces: ['py', 'pz', 'nz'] }) : boxGeo(t + 0.004, 0.03, L + 0.002, { faces: ['py', 'px', 'nx'] });
      b.add(g, { at: [cx, y + h - 0.014, cz], color: cap, outline: false });
    }
    // door/window frames: thin painted trim around openings
  }
  for (const o of ops) {
    if (!cfg.trim) continue;
    const tw = 0.06; const td = t + 0.03;
    const post = (sv) => (alongX ? aabb(b, sv - tw / 2, y + o.bottom, fixed - td / 2, sv + tw / 2, y + o.top, fixed + td / 2, { color: cfg.trim, outline: true })
      : aabb(b, fixed - td / 2, y + o.bottom, sv - tw / 2, fixed + td / 2, y + o.top, sv + tw / 2, { color: cfg.trim, outline: true }));
    post(o.a + tw / 2); post(o.b - tw / 2);
    if (o.top < h - 0.01) {
      if (alongX) aabb(b, o.a, y + o.top - tw, fixed - td / 2, o.b, y + o.top, fixed + td / 2, { color: cfg.trim, outline: true });
      else aabb(b, fixed - td / 2, y + o.top - tw, o.a, fixed + td / 2, y + o.top, o.b, { color: cfg.trim, outline: true });
    }
    if (o.bottom > 0.01) {
      if (alongX) aabb(b, o.a - 0.04, y + o.bottom, fixed - td / 2 - 0.03, o.b + 0.04, y + o.bottom + 0.04, fixed + td / 2 + 0.03, { color: cfg.trim, outline: true, collide: { wall: false, perch: true, name: 'perch:sill' } });
      else aabb(b, fixed - td / 2 - 0.03, y + o.bottom, o.a - 0.04, fixed + td / 2 + 0.03, y + o.bottom + 0.04, o.b + 0.04, { color: cfg.trim, outline: true, collide: { wall: false, perch: true, name: 'perch:sill' } });
    }
  }
}

/**
 * A floor skin (no collider; ground level) or a structural slab (collider, ceiling underneath).
 *   floor(b, x0, z0, x1, z1, y, { tile, rep, color })
 */
export function floor(b, x0, z0, x1, z1, y, o = {}) {
  aabb(b, x0, y, z0, x1, y + 0.006, z1, { faces: ['py'], tile: o.tile, rep: o.rep || 1, color: o.color || '#ffffff', outline: false, uvOff: o.uvOff });
}
export function slab(b, x0, z0, x1, z1, yTop, o = {}) {
  const th = o.thick || 0.2;
  const under = o.under || {};
  // lids (no floor above) draw only their underside so the third-person camera sees in from above
  aabb(b, x0, yTop - th, z0, x1, yTop - 0.002, z1, { faces: o.lid ? ['ny'] : ['ny', 'px', 'nx', 'pz', 'nz'], color: under.color || '#f4efe6', tile: under.tile, rep: under.rep || 1, outline: false });
  if (o.top) floor(b, x0, z0, x1, z1, yTop - 0.006, o.top);
  if (o.edge && !o.lid) aabb(b, x0 - 0.004, yTop - th, z0 - 0.004, x1 + 0.004, yTop - th + 0.025, z1 + 0.004, { faces: ['px', 'nx', 'pz', 'nz'], color: o.edge, outline: false });
  b.collide(x0, yTop - th, z0, x1, yTop, z1, { wall: false, ceil: true, name: o.name || 'ceil:slab' });
  // a lid's top is out of the seeker's sight: keep chameleons off it (invisible, not climbable)
  if (o.lid) b.collide(x0 - 0.2, yTop, z0 - 0.2, x1 + 0.2, yTop + 2.5, z1 + 0.2, { wall: false, climb: false, name: 'roof-guard' });
}

/**
 * Open-riser stairs. dir: 'x+' | 'x-' | 'z+' | 'z-' (the climbing direction).
 * (x, z) = centre of the bottom edge; treads are thin, so the space under high treads is a hideout.
 */
export function stairs(b, { x, z, dir = 'x-', width = 1.1, n = 16, rise = 0.175, run = 0.27, y0 = 0, tread = {}, stringer = '#6b4430', railSide = 0, rail = '#3a2a2a', name = 'stairs' }) {
  const ax = dir[0] === 'x'; const sg = dir[1] === '+' ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const top = y0 + (i + 1) * rise;
    const a = (i * run) * sg; const c = ((i + 1) * run + 0.02) * sg;
    const lo = Math.min(a, c); const hi = Math.max(a, c);
    const [x0, x1, z0, z1] = ax ? [x + lo, x + hi, z - width / 2, z + width / 2] : [x - width / 2, x + width / 2, z + lo, z + hi];
    aabb(b, x0, top - 0.05, z0, x1, top, z1, { color: tread.color || '#b07a4f', tile: tread.tile, rep: tread.rep || 0.5, outline: true, collide: { wall: false, ceil: true, name: `${name}:${i}` } });
  }
  // stringers (visual) along both sides, sloped
  const L = n * run; const H = n * rise; const ang = Math.atan2(H, L); const len = Math.hypot(L, H);
  for (const side of [-1, 1]) {
    const cxL = (L / 2) * sg; const off = side * (width / 2 + 0.03);
    const at = ax ? [x + cxL, y0 + H / 2 - 0.08, z + off] : [x + off, y0 + H / 2 - 0.08, z + cxL];
    const rot = ax ? [0, 0, sg * ang] : [-sg * ang, 0, 0];
    b.add(boxGeo(ax ? len : 0.05, 0.22, ax ? 0.05 : len), { at, rot, color: stringer, outline: true });
    if (railSide === side || railSide === 2) {
      // handrail + a few balusters
      const hr = 0.85;
      const at2 = ax ? [x + cxL, y0 + H / 2 + hr, z + off] : [x + off, y0 + H / 2 + hr, z + cxL];
      b.add(boxGeo(ax ? len : 0.05, 0.05, ax ? 0.05 : len), { at: at2, rot, color: rail, outline: true });
      for (let i = 1; i < n; i += 2) {
        const top = y0 + (i + 1) * rise; const along = ((i + 0.5) * run) * sg;
        const at3 = ax ? [x + along, top + hr / 2, z + off] : [x + off, top + hr / 2, z + along];
        b.add(boxGeo(0.03, hr, 0.03), { at: at3, color: rail, outline: true });
      }
    }
  }
  return { length: L, height: H };
}

/** A see-through railing (posts + top rail) from (x0,z0) to (x1,z1) at floor y. Blocks walking, perchable. */
export function railing(b, x0, z0, x1, z1, y, { h = 0.95, gap = 0.16, color = '#3a2a2a', top = '#7a4e35', name = 'rail' } = {}) {
  const L = Math.hypot(x1 - x0, z1 - z0); const n = Math.max(1, Math.round(L / gap));
  const alongX = Math.abs(z1 - z0) < 1e-6;
  for (let i = 0; i <= n; i++) {
    const t = i / n; const px = x0 + (x1 - x0) * t; const pz = z0 + (z1 - z0) * t;
    const big = i === 0 || i === n;
    b.add(boxGeo(big ? 0.07 : 0.028, h, big ? 0.07 : 0.028, { faces: ['px', 'nx', 'pz', 'nz'] }), { at: [px, y + h / 2, pz], color, outline: big });
  }
  b.add(boxGeo(alongX ? L + 0.06 : 0.08, 0.05, alongX ? 0.08 : L + 0.06), { at: [(x0 + x1) / 2, y + h, (z0 + z1) / 2], color: top, outline: true });
  b.add(boxGeo(alongX ? L : 0.04, 0.035, alongX ? 0.04 : L), { at: [(x0 + x1) / 2, y + 0.08, (z0 + z1) / 2], color, outline: false });
  const hx = alongX ? 0 : 0.05; const hz = alongX ? 0.05 : 0;
  b.collide(Math.min(x0, x1) - hx, y, Math.min(z0, z1) - hz, Math.max(x0, x1) + hx, y + h + 0.03, Math.max(z0, z1) + hz, { wall: false, perch: true, name: 'perch:' + name });
}

/** A framed picture on a wall. normal: 'x+','x-','z+','z-' (direction the picture faces). */
export function picture(b, x, y, z, w, h, normal, tile, { frame = '#3a2a2a', depth = 0.035, mat = null } = {}) {
  const ax = normal[0] === 'x'; const sg = normal[1] === '+' ? 1 : -1;
  const fw = 0.05;
  const geoF = ax ? boxGeo(depth, h + fw * 2, w + fw * 2) : boxGeo(w + fw * 2, h + fw * 2, depth);
  b.add(geoF, { at: ax ? [x + sg * depth / 2, y, z] : [x, y, z + sg * depth / 2], color: frame, outline: true, collide: { wall: true, name: 'frame' } });
  if (mat) {
    const gm = ax ? boxGeo(0.004, h + 0.02, w + 0.02, { faces: [sg > 0 ? 'px' : 'nx'] }) : boxGeo(w + 0.02, h + 0.02, 0.004, { faces: [sg > 0 ? 'pz' : 'nz'] });
    b.add(gm, { at: ax ? [x + sg * (depth + 0.001), y, z] : [x, y, z + sg * (depth + 0.001)], color: mat, outline: false });
  }
  const gi = ax ? boxGeo(0.004, h, w, { faces: [sg > 0 ? 'px' : 'nx'], fit: true }) : boxGeo(w, h, 0.004, { faces: [sg > 0 ? 'pz' : 'nz'], fit: true });
  b.add(gi, { at: ax ? [x + sg * (depth + 0.003), y, z] : [x, y, z + sg * (depth + 0.003)], tile, rep: 1, color: '#ffffff', outline: false });
}

/** Simple four-legged table. Returns nothing; adds top collider (walk under it). */
export function table(f, w, d, h, { top = '#a8754d', tile = 'wood', rep = 0.6, leg = '#6b4430', legW = 0.06, cloth = null, clothRep = 0.4, drop = 0 } = {}) {
  f.box(w, 0.05, d, [0, h - 0.025, 0], { color: top, tile, rep, collide: { wall: false, ceil: true, name: 'ceil:table' } });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) f.box(legW, h - 0.05, legW, [sx * (w / 2 - legW), (h - 0.05) / 2, sz * (d / 2 - legW)], { color: leg });
  if (cloth) {
    f.box(w + 0.1, 0.006, d + 0.1, [0, h + 0.003, 0], { color: '#ffffff', tile: cloth, rep: clothRep, outline: false });
    if (drop > 0) for (const sz of [-1, 1]) f.box(w + 0.1, drop, 0.006, [0, h - drop / 2, sz * (d / 2 + 0.05)], { color: '#ffffff', tile: cloth, rep: clothRep, outline: true });
  }
  f.blob(0, 0, w * 0.55, d * 0.55, { a: 0.2 });
}

/** A chair facing local +z. */
export function chair(f, { color = '#2f5d73', leg = '#244a5b', seat = 0.46 } = {}) {
  f.box(0.44, 0.05, 0.42, [0, seat, 0], { color, collide: { wall: false, name: 'chair' } });
  f.box(0.44, 0.46, 0.05, [0, seat + 0.25, -0.19], { color, collide: { wall: true, perch: true, name: 'chair-back' } });
  for (const [a, c] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) f.box(0.04, seat - 0.02, 0.04, [a, (seat - 0.02) / 2, c], { color: leg });
  f.blob(0, 0, 0.3, 0.28, { a: 0.22 });
}

/** A bookcase-like shelf unit facing local +z, with `levels` shelves. Each shelf is a ledge. */
export function shelves(f, w, h, d, levels, { color = '#7a4e35', tile = 'wood', rep = 0.6, back = null, backTile = null, backRep = 0.6, name = 'shelf' } = {}) {
  f.box(w, h, 0.03, [0, h / 2, -d / 2 + 0.015], { color: back || color, tile: backTile || tile, rep: backTile ? backRep : rep, collide: { wall: true, name: name + ':back' } });
  for (const sx of [-1, 1]) f.box(0.04, h, d, [sx * (w / 2 - 0.02), h / 2, 0], { color, tile, rep, collide: { wall: true, perch: true, name: name + ':side' } });
  const ys = [];
  for (let i = 0; i < levels; i++) {
    const y = 0.02 + (i * (h - 0.04)) / (levels - 1);
    ys.push(y);
    f.box(w - 0.06, 0.035, d, [0, y, 0], { color, tile, rep, collide: { wall: false, ceil: i > 0, name: name + ':' + i } });
  }
  f.blob(0, 0, w * 0.55, d * 0.6, { a: 0.24 });
  return ys;
}

/** Hanging pendant lamp: cord from the ceiling at yc down to y. */
export function pendant(b, x, z, yc, y, { shade = '#f2c14e', cord = '#2a2730', r = 0.22 } = {}) {
  b.add(cylGeo(0.008, 0.008, yc - y, { radial: 4, caps: false }), { at: [x, (yc + y) / 2, z], color: cord, outline: false });
  b.add(latheGeo([[0.03, 0.12], [r * 0.7, 0.05], [r, 0]], { radial: 14 }), { at: [x, y - 0.12, z], color: shade });
  b.add(sphereGeo(0.05, 0.05, 0.05, { w: 8, h: 6 }), { at: [x, y - 0.13, z], color: '#fff6cc', outline: false });
}

/** Rug: a flat patterned box. */
export function rug(b, x, z, w, d, y, tile, { rep = 1, fit = false, yaw = 0, color = '#ffffff' } = {}) {
  b.add(boxGeo(w, 0.012, d, { fit }), { at: [x, y + 0.006, z], yaw, tile, rep, color, outline: true });
}

/** Stack of boxes (cartons): list of [w, h, d, color, tile?, yaw?]. Returns top y. */
export function stack(f, x, z, items, { tileRep = 0.3, collide = true } = {}) {
  let y = 0;
  for (const it of items) {
    const [w, h, d, color, tile, yaw = 0] = it;
    f.box(w, h, d, [x, y + h / 2, z], { color, tile, rep: tileRep, yaw, collide: collide ? { wall: h > 0.3, name: 'stack' } : false });
    y += h;
  }
  return y;
}
