// Rail Rush districts (scenery biomes): per-district palettes derived from the theme palette P (so
// light AND dark follow the tokens), the district gate (an arch over the track at the first chunk
// of a zone, with the name in baked pixel letters: no extra draw call), and the scenery generators
// that replace the building rows beside the track. Everything here only runs while a chunk is
// built (once per 100 m), never per frame, and only writes into the chunk's merged buffer.
// The track, trains, barriers, gaps and coins are never touched.
import { FX_PLAIN, FX_GLOW, M_BRICK, M_PLANK, M_COBBLE, M_CORR, M_GRASS, M_WATER, M_GRAVEL, M_BLOCK, M_TILE, M_PLASTER, mix } from './gfx.js';
import { CHUNK } from './tune.js';
import { DISTRICT_FIRST, DISTRICT_ZONE } from './track.js';

// ── builders (all coordinates: x, y, track distance d; world z = -d) ──
export function bx(b, T, x0, y0, d0, x1, y1, d1, rgb, fx, ol, ink) {
  b.add(T.box, (x0 + x1) / 2, (y0 + y1) / 2, -(d0 + d1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(d1 - d0), 0, rgb, fx, ol, ink);
}
/** Quad facing the runner (+z) centred at (x, y, d). */
export function qz(b, T, x, y, d, w, h, rgb, fx) { b.add(T.quad, x, y, -d, w, h, 1, 0, rgb, fx, 0, rgb); }
/** Quad facing ±x (side = +1 faces +x) centred at (x, y, d), `len` along the track. */
export function qx(b, T, side, x, y, d, len, h, rgb, fx) { b.add(T.quad, x, y, -d, len, h, 1, side * Math.PI / 2, rgb, fx, 0, rgb); }
/** Quad facing up centred at (x, y, d). */
export function qu(b, T, x, y, d, w, len, rgb, fx = FX_PLAIN) { b.add(T.quadUp, x, y, -d, w, 1, len, 0, rgb, fx, 0, rgb); }
/** Diagonal stripes across a front face (local coords, z = face plane). */
export function stripes(b, T, x0, y0, x1, y1, z, rgb, n) {
  const w = (x1 - x0) / n;
  const h = y1 - y0;
  for (let i = 0; i < n; i++) b.add(T.stripe, x0 + (i + 0.5) * w, (y0 + y1) / 2, z, w * 0.95, h, 1, 0, rgb, FX_PLAIN, 0, rgb);
}

/**
 * A stepped light pool on a surface at night (a no-op by day): nested discs, each a step warmer than the last
 * (unlit, so they glow like the lamp above them). `base` is the surface colour, `tint` the lamp colour; rx / rz the
 * outer radii. About 40 vertices; baked into the chunk mesh, no draw call.
 */
export function lightPool(b, T, P, x, y, d, rx, rz, base, tint, rings = 2, step = 0.006) {
  if (!P.dark) return;
  const g = mix(base, [0, 0, 0], 0.17);
  for (let i = 0; i < rings; i++) {
    const k = 1 - i * (0.6 / rings);
    b.add(T.fan, x, y + i * step, -d, rx * 2 * k, 1, rz * 2 * k, 0, mix(g, tint, 0.28 + 0.2 * i), FX_GLOW, 0, tint);
  }
}

/** Windows on a facade. Facing ±x (side) along d, or facing +z across x. Lit ones (night) are warm white. */
export function windows(b, T, r, P, facing, fixed, a0, a1, y0, y1, pat, prob = 0.42) {
  const night = P.dark;
  const lit = P.warm; const glass = P.glass;
  const put = (u, v, w, h) => {
    const on = night && r() < prob;
    const col = on ? lit : glass;
    const fx = on ? FX_GLOW : FX_PLAIN;
    if (facing === 0) qz(b, T, u, v, fixed, w, h, col, fx);
    else qx(b, T, facing, fixed, v, u, w, h, col, fx);
  };
  const span = a1 - a0;
  if (span < 2.5 || y1 - y0 < 2) return;
  if (pat === 0) {
    for (let y = y0 + 1.1; y < y1 - 0.7; y += 3.2) put((a0 + a1) / 2, y, span - 1.2, 1.25);
  } else if (pat === 1) {
    const n = Math.max(1, Math.floor((span - 0.8) / 2.4));
    const st = (span - 0.8) / n;
    for (let i = 0; i < n; i++) put(a0 + 0.4 + (i + 0.5) * st, (y0 + 0.6 + y1 - 0.9) / 2, 0.95, y1 - y0 - 1.5);
  } else {
    const n = Math.max(1, Math.floor((span - 0.8) / 2.4));
    const st = (span - 0.8) / n;
    for (let y = y0 + 1.2; y < y1 - 0.8; y += 3.2) for (let i = 0; i < n; i++) put(a0 + 0.4 + (i + 0.5) * st, y, 1.15, 1.45);
  }
}

// ── palettes ──
/**
 * One entry per district, every colour a mix of the theme palette P (light and dark both derive from
 * the tokens). Downtown is today's look. Fields: bld (building bodies), awn (awnings), deck / bed /
 * parapet (track surroundings), street (the far layer under the viaduct: water in the harbour),
 * sky: [horizon, zenith] tint the sky is pulled toward (null = none), plus the generator colours.
 */
export function makeBio(P) {
  const dk = P.dark;
  const bT = dk ? 0.55 : 0;
  const m = mix;
  const tone = (c, k) => m(m(P.card, c, k), P.bg, bT);   // building body: paper tinted with an ink, dimmed at night
  const dim = (c, k = 0.3) => (dk ? m(c, P.bg, k) : c);  // saturated things: a little darker at night
  const pas = (c, k = 0.3) => (dk ? c : m(c, P.card, k)); // ... and pastel by day
  const orange = m(P.bad, P.hl, 0.5);
  const grey = m(P.card, P.muted, 0.4);
  const downtown = ({
    name: 'Downtown', bld: P.buildings, awn: [P.a, P.b, P.hl, P.good], deck: P.deck, bed: P.bed, parapet: P.parapet, street: P.street,
    sky: null, acc: P.a,
  });
  const harbour = ({
    name: 'Harbour',
    bld: [tone(P.a, 0.22), tone(P.muted, 0.34), tone(P.a, 0.1), tone(P.good, 0.14)],
    cont: [dim(P.a, 0.2), dim(P.bad, 0.2), dim(P.good, 0.2), dim(orange, 0.2), dim(m(P.b, P.card, 0.2), 0.2)],
    roof: dk ? m(P.muted, P.bg, 0.5) : m(P.muted, P.card, 0.2),
    deck: m(P.deck, P.a, dk ? 0.16 : 0.1), bed: m(P.bed, P.a, 0.08), parapet: m(P.parapet, P.a, 0.2),
    street: dk ? m(P.a, P.bg, 0.72) : m(P.a, P.card, 0.5),
    water: dk ? m(P.a, P.bg, 0.62) : m(P.a, P.card, 0.42),
    foam: dk ? m(P.a, P.white, 0.45) : m(P.a, P.white, 0.7),
    ground: dk ? m(P.muted, P.bg, 0.7) : m(P.card, P.muted, 0.22),
    quay: m(P.deck, P.ink, dk ? 0.0 : 0.1),
    crane: P.bad, trim: P.white,
    sky: dk ? [m(P.bg, P.a, 0.3), m(P.bg, P.a, 0.1)] : [m(P.bg, P.a, 0.34), m(m(P.bg, P.a, 0.55), P.card, 0.1)],
    acc: P.a,
  });
  const green = ({
    name: 'Greenway',
    bld: [tone(P.b, 0.22), tone(P.card, 0), tone(P.a, 0.16), tone(P.good, 0.2)],
    roof: [dim(m(P.bad, P.ink, 0.1), 0.15), dim(m(P.a, P.ink, 0.35), 0.1), dim(m(P.b, P.bad, 0.5), 0.2)],
    crown: [dim(m(P.good, P.card, 0.08), 0.1), dim(m(P.good, P.hl, 0.3), 0.15), dim(m(P.good, P.a, 0.3), 0.1)],
    blossom: dim(m(P.b, P.card, 0.2), 0.1),
    trunk: P.sleeper,
    lawn: dk ? m(P.good, P.bg, 0.6) : m(P.good, P.card, 0.4),
    hedge: dk ? m(P.good, P.bg, 0.45) : m(P.good, P.ink, 0.15),
    deck: m(P.deck, P.good, dk ? 0.12 : 0.1), bed: m(P.bed, P.good, 0.06), parapet: m(P.parapet, P.good, 0.2),
    street: dk ? m(P.good, P.bg, 0.7) : m(P.good, P.card, 0.45),
    water: dk ? m(P.a, P.bg, 0.6) : m(P.a, P.card, 0.45),
    sky: dk ? [m(P.bg, P.good, 0.24), m(m(P.bg, P.good, 0.07), [0, 0, 0], 0.25)] : [m(P.bg, P.good, 0.28), m(m(P.bg, P.good, 0.2), P.a, 0.35)],
    acc: P.good,
  });
  const old = ({
    name: 'Old Town',
    bld: [tone(P.bad, 0.2), tone(P.b, 0.18), tone(P.hl, 0.3), tone(P.card, 0), tone(P.a, 0.16), tone(P.good, 0.15)],
    roof: [dim(m(P.bad, P.ink, 0.22), 0.1), dim(m(P.a, P.ink, 0.5), 0.1), dim(m(P.muted, P.ink, 0.2), 0.1), dim(m(P.bad, P.muted, 0.5), 0.15)],
    beam: dk ? m(P.ink, P.bg, 0.55) : m(P.ink, P.card, 0.2),
    bunt: [P.b, P.a, P.white, P.bad, P.good],
    deck: m(P.deck, P.bad, dk ? 0.1 : 0.09), bed: m(P.bed, P.bad, 0.08), parapet: m(P.parapet, P.bad, dk ? 0.14 : 0.16),
    street: dk ? m(m(P.bad, P.bg, 0.8), P.hl, 0.04) : m(m(P.bad, P.card, 0.5), P.muted, 0.1),
    sky: dk ? [m(m(P.bg, P.hl, 0.1), P.bad, 0.1), m(P.bg, P.b, 0.1)] : [m(m(P.bg, P.hl, 0.3), P.bad, 0.1), m(m(P.bg, P.b, 0.26), P.hl, 0.1)],
    acc: P.bad,
  });
  const neon = ({
    name: 'Neon Market',
    bld: dk ? [m(P.bg, P.a, 0.12), m(P.bg, P.b, 0.1), m(P.bg, P.good, 0.08), m(P.card, P.b, 0.08)] : [tone(P.b, 0.28), tone(P.a, 0.24), tone(P.good, 0.22), tone(m(P.b, P.a, 0.5), 0.24)],
    glow: [pas(P.b, 0.25), pas(P.a, 0.25), pas(P.good, 0.25), pas(m(P.b, P.a, 0.5), 0.2), pas(orange, 0.25)],
    wood: dk ? m(P.sleeper, P.bg, 0.45) : m(P.sleeper, P.card, 0.2),
    deck: m(P.deck, P.b, dk ? 0.12 : 0.1), bed: m(P.bed, P.b, 0.06), parapet: m(P.parapet, P.b, dk ? 0.16 : 0.2),
    ground: dk ? m(P.bg, P.b, 0.1) : m(P.card, P.b, 0.16),
    street: dk ? m(P.b, P.bg, 0.8) : m(P.b, P.card, 0.5),
    sky: dk ? [m(P.bg, P.b, 0.4), m(m(P.bg, P.a, 0.2), P.b, 0.1)] : [m(P.bg, P.b, 0.3), m(m(P.bg, P.b, 0.28), P.a, 0.12)],
    acc: P.b,
  });
  const rust = m(P.bad, P.muted, 0.5);
  const yard = ({
    name: 'Freight Yard',
    bld: [tone(rust, 0.34), tone(P.muted, 0.36), tone(P.a, 0.12), tone(rust, 0.2)],
    cont: [dim(m(rust, P.card, 0.1), 0.2), dim(m(P.muted, P.a, 0.3), 0.2), dim(m(rust, P.ink, 0.25), 0.15), dim(m(P.a, P.muted, 0.5), 0.2), dim(m(rust, orange, 0.4), 0.2)],
    roof: dk ? m(P.muted, P.bg, 0.5) : m(rust, P.card, 0.1),
    silo: [dk ? m(P.card, P.muted, 0.35) : m(P.card, P.muted, 0.2), dk ? m(P.card, P.a, 0.2) : m(P.card, P.a, 0.16)],
    band: [P.bad, P.white],
    pipe: [dim(rust, 0.15), dim(m(P.muted, P.a, 0.25), 0.15)],
    deck: m(P.deck, rust, dk ? 0.14 : 0.1), bed: m(P.bed, rust, 0.1), parapet: m(P.parapet, rust, dk ? 0.2 : 0.22),
    ground: dk ? m(rust, P.bg, 0.78) : m(P.card, rust, 0.22),
    street: dk ? m(rust, P.bg, 0.8) : m(P.card, rust, 0.4),
    crane: dim(m(P.bad, orange, 0.3), 0.1),
    sky: dk ? [m(m(P.bg, P.muted, 0.2), P.bad, 0.08), m(P.bg, [0, 0, 0], 0.3)] : [m(m(P.bg, P.muted, 0.3), P.bad, 0.08), m(m(P.bg, P.muted, 0.4), P.a, 0.1)],
    acc: rust,
  });
  downtown.top = m(P.card, P.good, 0.42); // roof of a tunnel
  harbour.top = harbour.ground; green.top = green.lawn; old.top = old.roof[0]; neon.top = neon.ground; yard.top = yard.ground;
  const list = [downtown, harbour, green, old, neon, yard];
  for (const B of list) {
    // gate colours: a coloured face with the name in it (dark ink on light panels, paper on dark ones)
    const face = dk ? m(B.acc, P.bg, 0.35) : B.acc;
    const l = 0.2126 * face[0] + 0.7152 * face[1] + 0.0722 * face[2];
    B.gateFace = face;
    B.gateInk = l > 0.55 ? m(P.ink, [0, 0, 0], 0.2) : P.white;
    B.gateInk = dk ? P.warm : B.gateInk;
    B.sign = null; // pixel-letter runs, built once below
  }
  for (const B of list) B.sign = signRuns(B.name.toUpperCase());
  // surfaces (material ids, see gfx.js): what the deck beside the track and the ground are made of
  downtown.deckMat = M_BLOCK; harbour.deckMat = M_PLANK; green.deckMat = M_COBBLE; old.deckMat = M_COBBLE; neon.deckMat = M_TILE; yard.deckMat = M_GRAVEL;
  harbour.groundMat = M_TILE; green.groundMat = M_GRASS; neon.groundMat = M_TILE; yard.groundMat = M_GRAVEL;
  lightRigs(P, list, rust);
  return list;
}

/**
 * Per-district light rig, blended at zone boundaries (uniforms only): sun direction, hemisphere / key intensities,
 * the key light's colour and the shadow band's tint (split toning: shadows lean toward a district ink instead
 * of just getting darker), wall ambient occlusion, and the sky's cloud layer. Every colour is a mix of the
 * theme inks (so light and dark both follow); lights are normalised to luminance ~1 so exposure stays put.
 */
function lightRigs(P, list, rust) {
  const dk = P.dark; const m = mix;
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const unit = (c) => { const k = 1 / Math.max(0.25, lum(c)); return [Math.min(1.4, c[0] * k), Math.min(1.4, c[1] * k), Math.min(1.4, c[2] * k)]; };
  const tint = (c, k) => unit(m([1, 1, 1], c, k));
  const W = P.white;
  const orange = m(P.bad, P.hl, 0.5);
  // [sun x,y,z] [ambient, sky, key] key colour, shadow tint, ao [ground y, strength, height], sky: cloud colour, offset colour, [band centre, width, glow, strength], [az freq, el freq, threshold, drift]
  const R = dk ? [
    { sun: [-0.42, 0.8, 0.43], lk: [0.62, 0.2, 0.26], key: tint(P.a, 0.14), shd: tint(P.a, 0.12), ao: [-4, 0.44, 12], cl: [m(P.bg, P.a, 0.12), m(P.bg, P.a, 0.05), [0.2, 0.2, 0, 0], [3, 12, 0.5, 0.004]] },
    { sun: [-0.6, 0.42, 0.55], lk: [0.58, 0.2, 0.3], key: tint(m(P.a, P.hl, 0.35), 0.22), shd: tint(P.a, 0.4), ao: [-2.6, 0.42, 4], cl: [m(P.bg, P.a, 0.22), m(P.bg, P.a, 0.1), [0.18, 0.15, 0.25, 1], [2, 26, 0.5, 0.004]] },
    { sun: [-0.28, 0.92, 0.3], lk: [0.64, 0.2, 0.24], key: tint(m(P.a, P.good, 0.5), 0.18), shd: tint(P.good, 0.34), ao: [-1.6, 0.36, 3.2], cl: [m(P.bg, P.good, 0.2), m(P.bg, P.good, 0.08), [0.3, 0.28, 0, 1], [3, 9, 0.52, 0.004]] },
    { sun: [0.56, 0.52, 0.5], lk: [0.6, 0.2, 0.28], key: tint(m(P.hl, P.bad, 0.4), 0.2), shd: tint(m(P.b, P.a, 0.5), 0.34), ao: [-4, 0.4, 10], cl: [m(P.bg, P.bad, 0.22), m(P.bg, P.b, 0.1), [0.2, 0.2, 0.2, 1], [2, 20, 0.52, 0.004]] },
    { sun: [-0.5, 0.3, 0.62], lk: [0.55, 0.22, 0.3], key: tint(m(P.b, P.a, 0.4), 0.34), shd: tint(m(P.a, P.b, 0.5), 0.5), ao: [-1.2, 0.42, 3.6], cl: [m(P.bg, P.b, 0.3), m(P.bg, P.a, 0.12), [0.14, 0.12, 0.6, 1], [2, 22, 0.5, 0.004]] },
    { sun: [-0.35, 0.62, 0.5], lk: [0.64, 0.2, 0.26], key: tint(m(P.hl, P.bad, 0.4), 0.2), shd: tint(rust, 0.36), ao: [-2.6, 0.42, 4.2], cl: [m(P.bg, rust, 0.22), m(P.bg, rust, 0.1), [0.14, 0.22, 0.2, 1], [2, 14, 0.4, 0.004]] },
  ] : [
    { sun: [-0.42, 0.8, 0.43], lk: [0.6, 0.22, 0.3], key: tint(P.hl, 0.1), shd: tint(P.a, 0.1), ao: [-4, 0.4, 12], cl: [W, m(P.bg, P.b, 0.42), [0.3, 0.3, 0, 0], [3, 9, 0.5, 0.004]] },
    { sun: [-0.64, 0.4, 0.55], lk: [0.5, 0.2, 0.42], key: tint(m(P.hl, P.bad, 0.25), 0.42), shd: tint(P.a, 0.46), ao: [-2.6, 0.38, 4], cl: [m(W, P.a, 0.06), m(P.card, P.a, 0.3), [0.2, 0.17, 0, 1], [2, 26, 0.5, 0.004]] },
    { sun: [-0.28, 0.92, 0.3], lk: [0.68, 0.24, 0.22], key: tint(P.hl, 0.14), shd: tint(m(P.good, P.a, 0.4), 0.3), ao: [-1.6, 0.3, 3.2], cl: [W, m(P.card, P.good, 0.4), [0.3, 0.3, 0, 1], [3, 9, 0.5, 0.004]] },
    { sun: [0.58, 0.52, 0.5], lk: [0.54, 0.2, 0.38], key: tint(m(P.hl, P.bad, 0.4), 0.4), shd: tint(m(P.b, P.a, 0.5), 0.32), ao: [-4, 0.34, 10], cl: [m(W, P.hl, 0.22), m(P.card, P.b, 0.4), [0.22, 0.2, 0, 1], [2, 20, 0.52, 0.004]] },
    { sun: [-0.5, 0.3, 0.62], lk: [0.48, 0.22, 0.4], key: tint(m(P.b, P.hl, 0.35), 0.3), shd: tint(m(P.a, P.b, 0.4), 0.5), ao: [-1.2, 0.38, 3.6], cl: [m(W, P.b, 0.18), m(P.card, P.a, 0.4), [0.16, 0.14, 0.5, 1], [2, 22, 0.5, 0.004]] },
    { sun: [-0.35, 0.62, 0.5], lk: [0.66, 0.2, 0.26], key: tint(m(P.hl, P.bad, 0.35), 0.22), shd: tint(rust, 0.3), ao: [-2.6, 0.38, 4.2], cl: [m(m(P.muted, W, 0.5), rust, 0.15), m(rust, P.card, 0.45), [0.15, 0.24, 0, 1], [2, 14, 0.38, 0.004]] },
  ];
  for (let i = 0; i < list.length; i++) {
    const r = R[i];
    const sl = Math.hypot(r.sun[0], r.sun[1], r.sun[2]);
    list[i].rig = {
      sun: [r.sun[0] / sl, r.sun[1] / sl, r.sun[2] / sl], lk: r.lk, key: r.key, shd: r.shd, ao: r.ao,
      cl: r.cl[0], cm: r.cl[1], cs: r.cl[2], sh: r.cl[3],
    };
  }
}

// ── district gate: pixel letters baked as quads ──
const FONT = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111', M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 11001 10101 10011 10001 10001 10001', O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', W: '10001 10001 10001 10101 10101 11011 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
};
/** Text → { w, h, runs: [x, y, w, h, ...] } in letter cells (5 x 7 glyphs, 1 cell gap), vertical runs merged. Two lines when long. */
function signRuns(text) {
  const words = text.split(' ');
  const lines = text.length > 9 && words.length > 1 ? words : [text];
  const runs = [];
  let w = 0;
  for (const ln of lines) w = Math.max(w, ln.length * 6 - 1);
  const h = lines.length * 8 - 1;
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    const x0 = Math.floor((w - (ln.length * 6 - 1)) / 2);
    const y0 = li * 8;
    const open = []; // runs still growing downward: [x, y, w, h]
    for (let row = 0; row < 7; row++) {
      const cur = [];
      for (let ci = 0; ci < ln.length; ci++) {
        const g = FONT[ln[ci]];
        if (!g) continue;
        const bits = g.split(' ')[row];
        let k = 0;
        while (k < 5) {
          if (bits[k] !== '1') { k++; continue; }
          let e = k; while (e < 5 && bits[e] === '1') e++;
          cur.push([x0 + ci * 6 + k, y0 + row, e - k, 1]);
          k = e;
        }
      }
      const nextOpen = [];
      for (const c of cur) {
        const up = open.find((o) => o[0] === c[0] && o[2] === c[2] && o[1] + o[3] === c[1]);
        if (up) { up[3]++; nextOpen.push(up); } else { const o = c; runs.push(o); nextOpen.push(o); }
      }
      open.length = 0; for (const o of nextOpen) open.push(o);
    }
  }
  const flat = [];
  for (const o of runs) flat.push(o[0], o[1], o[2], o[3]);
  return { w, h, runs: flat };
}

/** Print a district name on a face at depth d (facing the runner), centred at (cx, cy), in a w x h box. */
export function printSign(b, T, B, d, cx, cy, maxW, maxH, rgb, fx) {
  const s = B.sign;
  const cell = Math.min(maxW / s.w, maxH / s.h);
  const x0 = cx - (s.w * cell) / 2; const y1 = cy + (s.h * cell) / 2;
  const a = s.runs;
  for (let i = 0; i < a.length; i += 4) qz(b, T, x0 + (a[i] + a[i + 2] / 2) * cell, y1 - (a[i + 1] + a[i + 3] / 2) * cell, d, a[i + 2] * cell, a[i + 3] * cell, rgb, fx);
}

/** The gate over the track at the start of a district zone (the tunnel portal's lintel carries the name instead). */
export function bioGate(X) {
  const { b, T, P, B, c, d0, ink, tun } = X;
  if (!c.zoneStart) return;
  if (tun) {
    // the tunnel's entry lintel (6.0 .. 11.5 m, 24 m wide) is the sign
    qz(b, T, 0, 9.1, tun[0] - 0.04, 17, 4.4, B.gateFace, FX_PLAIN);
    printSign(b, T, B, tun[0] - 0.06, 0, 9.1, 15, 3.6, B.gateInk, FX_GLOW);
    return;
  }
  const dg = d0 + 1.6;
  const post = mix(P.portal, B.gateFace, 0.25);
  for (const sd of [-1, 1]) {
    bx(b, T, sd * 5.1, -8, dg - 0.6, sd * 6.5, 7.6, dg + 0.6, post, FX_PLAIN, 0.07, ink);
    stripes(b, T, sd * 5.1, 0.3, sd * 6.5, 1.5, -(dg - 0.62), P.ink, 3);
  }
  bx(b, T, -6.8, 7.4, dg - 0.7, 6.8, 11.8, dg + 0.7, post, FX_PLAIN, 0.08, ink);
  qz(b, T, 0, 9.6, dg - 0.72, 12.8, 4.0, B.gateFace, FX_PLAIN);
  qz(b, T, 0, 11.5, dg - 0.73, 12.8, 0.3, B.gateInk, FX_PLAIN);
  qz(b, T, 0, 7.7, dg - 0.73, 12.8, 0.3, B.gateInk, FX_PLAIN);
  printSign(b, T, B, dg - 0.74, 0, 9.6, 11.4, 3.2, B.gateInk, FX_GLOW);
}

// ── generators ──
const rr = (r, a, e) => a + r() * (e - a);
const pk = (r, a) => a[Math.floor(r() * a.length)];

/** Ground slab beside the track (top at y1), from the parapet outward. */
function ground(X, side, x1, y1, col) { bx(X.b, X.T, side * 4.7, -8, X.d0, side * x1, y1, X.d1, col, FX_PLAIN | (X.B.groundMat || 0), 0, X.ink); }

/** A row of back buildings: simple boxes (base y0, heights hmin..hmax) with windows. */
function backRow(X, side, x0, x1, y0, hmin, hmax, cols, wmin, wmax, roofCol) {
  const { b, T, P, r, d0, d1, ink } = X;
  let e = d0 + r() * 8;
  while (e < d1) {
    const ee = Math.min(e + rr(r, wmin, wmax), d1);
    if (ee - e > 4) {
      const inner = x0 + r() * (x1 - x0);
      const h = hmin + r() * (hmax - hmin);
      const col = mix(pk(r, cols), P.bg, 0.2);
      const xa = side > 0 ? inner : -inner - 14; const xb = side > 0 ? inner + 14 : -inner;
      bx(b, T, xa, y0, e, xb, h, ee, col, FX_PLAIN | M_BLOCK, 0.12, ink);
      if (roofCol) b.add(T.roof, (xa + xb) / 2, h + 1.6, -(e + ee) / 2, ee - e + 0.4, 3.2, 14.4, Math.PI / 2, roofCol, FX_PLAIN, 0.06, ink);
      windows(b, T, r, P, -side, side > 0 ? xa - 0.02 : xb + 0.02, e + 1, ee - 1, y0 > -3 ? y0 : -2, h, 0);
    }
    e = ee + 2 + r() * 6;
  }
}

/** A flood-light mast: pole plus a glowing lamp head. */
function mast(X, x, y0, d, h) {
  const { b, T, P, ink } = X;
  bx(b, T, x - 0.12, y0, d - 0.12, x + 0.12, y0 + h, d + 0.12, P.pole, FX_PLAIN, 0.025, ink);
  bx(b, T, x - 0.7, y0 + h, d - 0.35, x + 0.7, y0 + h + 0.4, d + 0.35, P.shadeInk, FX_PLAIN, 0.03, ink);
  qz(b, T, x, y0 + h + 0.2, d - 0.37, 1.2, 0.26, P.warm, FX_GLOW);
  lightPool(b, T, P, x * 1.08, y0 + 0.02, d, 3.2, 3.4, X.B.ground || X.B.deck, P.warm);
}

/** A stack of shipping containers (bays of 12 m along d, `lv` levels, 5 m deep). */
function containers(X, side, x0, y0, d, bays, lv, cols) {
  const { b, T, r, ink } = X;
  const xa = side * x0; const xb = side * (x0 + 5);
  for (let k = 0; k < bays; k++) {
    for (let l = 0; l < lv; l++) {
      const col = pk(r, cols);
      const ya = y0 + l * 2.6;
      bx(b, T, xa, ya, d + k * 12 + 0.1, xb, ya + 2.55, d + (k + 1) * 12 - 0.1, col, FX_PLAIN | M_CORR, 0.05, ink);
      const dark = mix(col, X.P.ink, 0.28);
      for (let q = 0; q < 4; q++) qx(b, T, -side, xa - side * 0.01, ya + 1.3, d + k * 12 + 1.6 + q * 3, 0.22, 2.1, dark, FX_PLAIN);
    }
  }
}

/** A long low shed with a ridge roof (ridge along the track), corrugation ribs and a door. */
function shed(X, side, x0, y0, d, len, depth, h, wall, roof) {
  const { b, T, P, r, ink } = X;
  const xa = side * x0; const xb = side * (x0 + depth);
  bx(b, T, xa, y0, d, xb, y0 + h, d + len, wall, FX_PLAIN | M_CORR, 0.08, ink);
  b.add(T.roof, (xa + xb) / 2, y0 + h + 0.9, -(d + len / 2), depth + 0.8, 1.8, len + 0.4, 0, roof, FX_PLAIN, 0.06, ink);
  const rib = mix(wall, P.ink, 0.2);
  for (let k = d + 0.8; k < d + len - 0.5; k += 1.6) qx(b, T, -side, xa - side * 0.01, y0 + h * 0.5, k, 0.2, h - 0.4, rib, FX_PLAIN);
  const dd = d + len * (0.25 + r() * 0.5);
  qx(b, T, -side, xa - side * 0.02, y0 + 1.5, dd, 3.4, 3.0, mix(wall, P.ink, 0.55), FX_PLAIN);
  qx(b, T, -side, xa - side * 0.03, y0 + h - 0.8, dd, 3.4, 0.25, P.warm, FX_GLOW);
}

// Harbour: quay and water on one side (swaps every zone), sheds and container stacks on the other,
// a quay crane about every 300 m, and now and then a boat or a cargo ship.
function harbour(X) {
  const { b, T, P, B, r, c, d0, d1, ink, tun } = X;
  const G = -2.6;
  const ws = Math.floor((c.i - DISTRICT_FIRST) / DISTRICT_ZONE) % 2 ? 1 : -1;
  const mid = (d0 + d1) / 2;
  for (const side of [-1, 1]) {
    if (side === ws) {
      bx(b, T, side * 4.7, -8, d0, side * 9.4, -1.0, d1, B.quay, FX_PLAIN | M_PLANK, 0.05, ink);
      qu(b, T, side * 9.0, -0.99, mid, 0.3, CHUNK, P.white);
      qu(b, T, side * 50, -3.3, mid, 82, CHUNK, B.water, FX_PLAIN | M_WATER);
      for (let k = 0; k < 5; k++) qu(b, T, side * rr(r, 12, 44), -3.28, d0 + rr(r, 4, 94), 0.4, rr(r, 4, 10), B.foam);
      for (let k = 0; k < 4; k++) b.add(T.cyl6, side * 8.5, -0.55, -(d0 + 12 + k * 25), 0.6, 0.9, 0.6, 0, P.shadeInk, FX_PLAIN, 0.03, ink);
      // boats
      const nb = Math.floor(r() * 3);
      for (let k = 0; k < nb; k++) {
        const bd = d0 + 8 + k * 38 + r() * 14; const bxx = side * rr(r, 13, 20); const len = rr(r, 7, 11);
        const col = pk(r, B.cont);
        bx(b, T, bxx - 1.7, -3.9, bd, bxx + 1.7, -2.2, bd + len, col, FX_PLAIN | M_PLANK, 0.06, ink);
        bx(b, T, bxx - 1.7, -2.2, bd, bxx + 1.7, -1.9, bd + len, P.white, FX_PLAIN, 0.03, ink);
        bx(b, T, bxx - 1.0, -1.9, bd + len * 0.1, bxx + 1.0, -0.2, bd + len * 0.1 + 3, P.white, FX_PLAIN, 0.05, ink);
        qx(b, T, -side, bxx - side * 1.01, -1.0, bd + len * 0.1 + 1.5, 1.8, 0.5, P.glass, FX_PLAIN);
        bx(b, T, bxx - 0.06, -0.2, bd + len * 0.1 + 0.3, bxx + 0.06, 1.6, bd + len * 0.1 + 0.42, P.pole, FX_PLAIN, 0.02, ink);
      }
      // cargo ship
      if (!tun && r() < 0.5) {
        const sd = d0 + rr(r, 4, 30); const L = 52; const sx = side * rr(r, 32, 40);
        bx(b, T, sx - 5, -3.9, sd, sx + 5, 1.6, sd + L, mix(P.muted, P.ink, 0.35), FX_PLAIN | M_CORR, 0.1, ink);
        bx(b, T, sx - 5.05, -3.9, sd, sx + 5.05, -2.4, sd + L, B.crane, FX_PLAIN, 0.02, ink);
        bx(b, T, sx - 3, 1.6, sd + L - 11, sx + 3, 7.2, sd + L - 2, P.white, FX_PLAIN, 0.07, ink);
        qz(b, T, sx, 5.6, sd + L - 11.02, 5, 0.8, P.glass, FX_PLAIN);
        for (const rx of [-2.7, 2.7]) {
          let dd = sd + 2;
          while (dd < sd + L - 14) {
            const n = 1 + Math.floor(r() * 2); const lv = 1 + Math.floor(r() * 2.4);
            for (let l = 0; l < lv; l++) bx(b, T, sx + rx - 2.5, 1.6 + l * 2.6, dd, sx + rx + 2.5, 1.6 + l * 2.6 + 2.55, dd + n * 6 - 0.1, pk(r, B.cont), FX_PLAIN, 0.05, ink);
            dd += n * 6;
          }
        }
      }
    } else {
      ground(X, side, 80, G, B.ground);
      let d = d0 + r() * 3;
      while (d < d1 - 8) {
        const q = r();
        if (q < 0.4) {
          const len = Math.min(rr(r, 14, 24), d1 - d - 1);
          shed(X, side, 7 + r() * 1.2, G, d, len, rr(r, 8, 11), rr(r, 4.6, 6.6), pk(r, B.bld), B.roof);
          d += len + rr(r, 2, 6);
        } else {
          const bays = 1 + Math.floor(r() * 2.6); const lv = 1 + Math.floor(r() * 3.4);
          containers(X, side, 7 + r() * 2, G, d, bays, lv, B.cont);
          d += bays * 12 + rr(r, 1, 5);
        }
      }
      mast(X, side * 6.3, G, d0 + 30 + r() * 40, 8.5);
      backRow(X, side, 20, 30, G, G + 7, G + 13, B.bld, 14, 24, B.roof);
    }
  }
  if (!tun && (c.zi === 1 || (c.zi === 3 && r() < 0.5))) harbourCrane(X, ws, mid);
}

function harbourCrane(X, side, dm) {
  const { b, T, P, B, ink } = X;
  const col = B.crane;
  const top = 15;
  for (const dd of [-4, 4]) for (const xx of [5.7, 8.5]) bx(b, T, side * xx - 0.35, -1.0, dm + dd - 0.35, side * xx + 0.35, top, dm + dd + 0.35, col, FX_PLAIN, 0.05, ink);
  stripes(b, T, side * 5.7, 1.5, side * 8.5, top - 1.5, -(dm - 4.4), mix(col, P.ink, 0.3), 2);
  bx(b, T, side * 5.2, top, dm - 4.6, side * 9.0, top + 1.0, dm + 4.6, col, FX_PLAIN, 0.05, ink);
  bx(b, T, side * 5.5, top + 0.4, dm - 0.7, side * 40, top + 1.5, dm + 0.7, col, FX_PLAIN, 0.05, ink);
  bx(b, T, side * 6, top + 1.5, dm - 1.3, side * 9.5, top + 3.7, dm + 1.3, P.white, FX_PLAIN, 0.05, ink);
  const hx = side * 26;
  bx(b, T, hx - 0.07, top - 6.4, dm - 0.07, hx + 0.07, top + 0.4, dm + 0.07, P.pole, FX_PLAIN, 0.0, ink);
  bx(b, T, hx - 1.3, top - 9.0, dm - 3, hx + 1.3, top - 6.4, dm + 3, pk(X.r, B.cont), FX_PLAIN, 0.06, ink);
  for (let k = 0; k < 3; k++) qz(b, T, side * (10 + k * 10), top + 1.6, dm - 0.72, 0.5, 0.3, P.warm, FX_GLOW);
}

// Greenway: low lawns beside the track with trees (box trunk + octahedron / low-sphere / cone
// crowns), hedges, little cottages and flower beds.
function greenway(X) {
  const { b, T, P, B, r, c, d0, d1, ink, tun } = X;
  const G = -1.6;
  for (const side of [-1, 1]) {
    ground(X, side, 80, G, B.lawn);
    // hedges along the parapet
    let d = d0 + r() * 6;
    while (d < d1 - 4) {
      const len = rr(r, 6, 13);
      const e = Math.min(d + len, d1 - 0.5);
      bx(b, T, side * 5.1, G, d, side * 6.1, G + 1.1, e, B.hedge, FX_PLAIN, 0.05, ink);
      d = e + rr(r, 3, 9);
    }
    // cottages
    d = d0 + r() * 5;
    while (d < d1 - 9) {
      const len = rr(r, 6.5, 9);
      const inner = rr(r, 10.2, 11.6); const depth = 6;
      const xa = side * inner; const xb = side * (inner + depth);
      const wall = pk(r, B.bld); const h = rr(r, 3.2, 4.2);
      bx(b, T, xa, G, d, xb, G + h, d + len, wall, FX_PLAIN | (B.bld.indexOf(wall) % 2 ? M_BRICK : M_PLASTER), 0.07, ink);
      const rh = 2.2;
      b.add(T.roof, (xa + xb) / 2, G + h + rh / 2, -(d + len / 2), len + 0.6, rh, depth + 0.7, Math.PI / 2, pk(r, B.roof), FX_PLAIN, 0.06, ink);
      b.add(T.tri, xa - side * 0.3, G + h + rh / 3, -(d + len / 2), len, rh, 1, -side * Math.PI / 2, wall, FX_PLAIN, 0, wall);
      qx(b, T, -side, xa - side * 0.02, G + 1.1, d + len * 0.3, 1.1, 2.0, mix(wall, P.ink, 0.5), FX_PLAIN);
      windows(b, T, r, P, -side, xa - side * 0.02, d + len * 0.5, d + len - 0.4, G - 1.2, G + h + 0.6, 2, 0.7);
      if (r() < 0.6) bx(b, T, (xa + xb) / 2 - 0.4, G + h + rh * 0.4, d + len * 0.7 - 0.4, (xa + xb) / 2 + 0.4, G + h + rh + 1.0, d + len * 0.7 + 0.4, mix(wall, P.ink, 0.3), FX_PLAIN, 0.04, ink);
      d += len + rr(r, 6, 14);
    }
    // lamp posts along the hedge line (their light pools show at night)
    for (let ld = Math.ceil(d0 / 40) * 40 + 11 + (side > 0 ? 20 : 0); ld < d1; ld += 40) {
      if (ld < d0 + 1 || (tun && ld > tun[0] - 2 && ld < tun[1] + 2)) continue;
      const lx = side * 6.5;
      bx(b, T, lx - 0.07, G, ld - 0.07, lx + 0.07, G + 3.4, ld + 0.07, P.pole, FX_PLAIN, 0.02, ink);
      bx(b, T, lx - 0.3, G + 3.4, ld - 0.3, lx + 0.3, G + 3.62, ld + 0.3, P.shadeInk, FX_PLAIN, 0.025, ink);
      bx(b, T, lx - 0.22, G + 3.26, ld - 0.22, lx + 0.22, G + 3.4, ld + 0.22, P.warm, FX_GLOW, 0, ink);
      lightPool(b, T, P, lx, G + 0.02, ld, 3.2, 3.2, B.lawn, P.warm);
    }
    // trees: a line beside the hedge, a deeper row behind
    for (let row = 0; row < 2; row++) {
      d = d0 + r() * 5;
      while (d < d1 - 1) {
        const kind = r(); const s = row ? rr(r, 1.4, 1.9) : rr(r, 0.9, 1.3);
        const x = side * (row ? rr(r, 15, 28) : rr(r, 6.8, 8.6));
        const col = r() < 0.1 ? B.blossom : pk(r, B.crown);
        const th = 2.0 * s; const base = G;
        bx(b, T, x - 0.25 * s, base, d - 0.25 * s, x + 0.25 * s, base + th + 0.6, d + 0.25 * s, B.trunk, FX_PLAIN | M_CORR, 0, ink);
        if (tun && base + th + 4.4 * s > 6.4) { d += rr(r, 8, 12); continue; }
        if (kind < 0.56) b.add(T.octa, x, base + th + 2.2 * s, -d, 4.4 * s, 5.4 * s, 4.4 * s, r() * 3, col, FX_PLAIN, 0.05, ink);
        else if (kind < 0.68) b.add(T.lowSphere, x, base + th + 1.7 * s, -d, 4.6 * s, 4.0 * s, 4.6 * s, r() * 3, col, FX_PLAIN, 0.05, ink);
        else {
          b.add(T.cone, x, base + th + 1.3 * s, -d, 4.4 * s, 3.4 * s, 4.4 * s, 0, col, FX_PLAIN, 0.05, ink);
          b.add(T.cone, x, base + th + 3.6 * s, -d, 3.2 * s, 3.2 * s, 3.2 * s, 0.5, col, FX_PLAIN, 0.05, ink);
        }
        d += row ? rr(r, 18, 28) : rr(r, 9, 14);
      }
    }
    // flower beds in front of the hedge line
    for (let k = 0; k < 4; k++) if (r() < 0.7) qu(b, T, side * rr(r, 6.4, 7.4), G + 0.02, d0 + rr(r, 4, 96), 1.3, 1.3, pk(r, [P.b, P.white, P.a, B.blossom]));
  }
}

// Old Town: a tight street wall of narrow gabled houses (steep roofs, chimneys, timber beams)
// with bunting strung across the street.
function oldTown(X) {
  const { b, T, P, B, r, c, d0, d1, ink, tun } = X;
  for (const side of [-1, 1]) {
    let d = d0 + r() * 2;
    while (d < d1 - 3) {
      const w = rr(r, 5.4, 8.2);
      const de = Math.min(d + w, d1);
      if (de - d < 3.4) break;
      const inner = 7.2 + r() * 0.5; const depth = rr(r, 6, 8);
      const floors = tun ? 2 : 3 + Math.floor(r() * 3);
      const h = tun ? 4.4 + r() * 1.2 : floors * 3.2 - 0.6;
      const wall = pk(r, B.bld);
      const x0 = side * inner; const x1 = side * (inner + depth);
      const rh = tun ? 1.6 : rr(r, 2.6, 3.6);
      bx(b, T, Math.min(x0, x1), -8, d + 0.12, Math.max(x0, x1), h, de - 0.12, wall, FX_PLAIN | (B.bld.indexOf(wall) % 2 ? M_BRICK : M_PLASTER), 0.07, ink);
      b.add(T.roof, (x0 + x1) / 2, h + rh / 2, -(d + de) / 2, de - d + 0.3, rh, depth + 0.6, Math.PI / 2, pk(r, B.roof), FX_PLAIN, 0.06, ink);
      b.add(T.tri, x0 - side * 0.3, h + rh / 3, -(d + de) / 2, de - d - 0.1, rh, 1, -side * Math.PI / 2, mix(wall, P.card, 0.2), FX_PLAIN, 0, wall);
      windows(b, T, r, P, -side, x0 - side * 0.02, d + 0.9, de - 0.9, -2.2, h, 2, 0.5);
      for (let y = 3.2; y < h - 0.5; y += 3.2) qx(b, T, -side, x0 - side * 0.03, y, (d + de) / 2, de - d - 0.2, 0.22, B.beam, FX_PLAIN);
      if (r() < 0.65) {
        const xc = x0 + side * depth * 0.6; const dc = d + (de - d) * (0.3 + r() * 0.4);
        bx(b, T, xc - 0.4, h + rh * 0.35, dc - 0.4, xc + 0.4, h + rh + 1.5, dc + 0.4, mix(wall, P.ink, 0.35), FX_PLAIN, 0.04, ink);
      }
      d = de + rr(r, 0.1, 0.5);
    }
  }
  // bunting across the street every 25 m
  if (!tun) {
    // (none in the last 24 m of a zone: the next district's gate must stay readable)
    for (let k = c.zoneStart ? 1 : 0; k < 4; k++) {
      const d = d0 + 4 + k * 25;
      if (c.zi === DISTRICT_ZONE - 1 && d > d1 - 24) continue;
      bx(b, T, -7.2, 8.0, d - 0.025, 7.2, 8.08, d + 0.025, B.beam, FX_PLAIN, 0, ink);
      for (let i = 0; i < 13; i++) {
        const x = -6.6 + i * 1.1;
        const sag = 0.9 * (1 - (x / 7.2) * (x / 7.2));
        b.add(T.pen, x, 7.45 - sag * 0.0, -d - 0.02, 0.62, 0.8, 1, 0, B.bunt[(i + k) % B.bunt.length], FX_PLAIN, 0, ink);
      }
    }
  }
  backRow(X, -1, 15, 22, -8, 12, 20, B.bld, 8, 12, B.roof[0]);
  backRow(X, 1, 15, 22, -8, 12, 20, B.bld, 8, 12, B.roof[0]);
}

// Neon Market: a paved night-market strip beside the track (stalls with striped canopies), blade
// signs and lit shop fronts behind it, and lantern strings across the track.
function neonMarket(X) {
  const { b, T, P, B, r, c, d0, d1, ink, tun } = X;
  const G = -1.2;
  for (const side of [-1, 1]) {
    ground(X, side, 11, G, B.ground);
    // stalls
    let d = d0 + 4 + r() * 4;
    while (d < d1 - 4) {
      const col = pk(r, B.glow);
      const x = side * 7.2;
      bx(b, T, x - 1.1, G, d - 1.7, x + 1.1, G + 1.0, d + 1.7, B.wood, FX_PLAIN | M_PLANK, 0, ink);
      lightPool(b, T, P, x + side * 0.4, G + 0.02, d, 3.0, 3.6, B.ground, col);
      bx(b, T, x - 0.6, G + 1.0, d - 1.0, x + 0.2, G + 1.5, d - 0.2, pk(r, B.glow), FX_PLAIN, 0, ink);
      bx(b, T, x + side * 0.9 - 0.06, G, d - 1.6, x + side * 0.9 + 0.06, G + 2.7, d + 1.6, P.pole, FX_PLAIN, 0.0, ink);
      bx(b, T, x - 1.5, G + 2.6, d - 2.1, x + 1.5, G + 2.85, d + 2.1, col, FX_PLAIN, 0.05, ink);
      for (let k = 0; k < 4; k++) qx(b, T, -side, x - side * 1.51, G + 2.4, d - 1.5 + k, 0.9, 0.4, k % 2 ? P.white : col, FX_PLAIN);
      b.add(T.octa, x - side * 1.2, G + 2.1, -(d + 1.0), 0.5, 0.6, 0.5, 0, pk(r, B.glow), FX_GLOW, 0, ink);
      d += rr(r, 17, 23);
    }
    // shop fronts behind the stalls
    d = d0 + r() * 3;
    while (d < d1 - 3) {
      const w = rr(r, 8, 15);
      const de = Math.min(d + w, d1);
      if (de - d > 3.5) {
        const inner = rr(r, 11, 12.2); const depth = rr(r, 7, 10);
        const h = tun ? 3 + r() * 3 : G + rr(r, 6, 13);
        const col = pk(r, B.bld);
        const xa = Math.min(side * inner, side * (inner + depth)); const xb = Math.max(side * inner, side * (inner + depth));
        bx(b, T, xa, -8, d + 0.3, xb, h, de - 0.3, col, FX_PLAIN | M_PLASTER, 0.09, ink);
        bx(b, T, xa - 0.2, h, d + 0.15, xb + 0.2, h + 0.4, de - 0.15, mix(col, P.ink, 0.2), FX_PLAIN, 0.05, ink);
        windows(b, T, r, P, -side, side * inner - side * 0.02, d + 1, de - 1, G - 0.4, h, r() < 0.5 ? 0 : 1, 0.75);
        const nc = pk(r, B.glow);
        bx(b, T, side * inner - side * 0.12 - 0.05, h - 0.7, d + 0.4, side * inner - side * 0.12 + 0.05, h - 0.5, de - 0.4, nc, FX_GLOW, 0, ink);
        if (!tun && r() < 0.75) {
          // blade sign sticking out toward the track (faces the runner)
          const sd = d + (de - d) * rr(r, 0.2, 0.8);
          const sh = rr(r, 3, 4.6);
          const sy1 = h - 0.6; const sy0 = sy1 - sh;
          const sx0 = side * inner - side * 0.1; const sx1 = sx0 - side * 1.7;
          bx(b, T, sx0, sy0, sd - 0.15, sx1, sy1, sd + 0.15, mix(P.ink, P.card, P.dark ? 0.4 : 0.1), FX_PLAIN, 0.04, ink);
          const sc = pk(r, B.glow); const sc2 = pk(r, B.glow);
          qz(b, T, (sx0 + sx1) / 2, (sy0 + sy1) / 2, sd - 0.17, 1.4, sh - 0.4, sc, FX_GLOW);
          for (let k = 0; k < 3; k++) qz(b, T, (sx0 + sx1) / 2, sy0 + 0.6 + k * (sh - 1.2) / 2.2, sd - 0.18, 0.9, 0.35, sc2, FX_GLOW);
        }
      }
      d = de + rr(r, 0.5, 2.5);
    }
    backRow(X, side, 24, 30, -8, 16, 26, B.bld, 12, 22, null);
  }
  if (!tun) {
    // lantern strings across the track
    for (let k = c.zoneStart ? 1 : 0; k < 6; k++) {
      const d = d0 + 6.25 + k * 16.67;
      if (c.zi === DISTRICT_ZONE - 1 && d > d1 - 24) continue;
      bx(b, T, -7.0, 8.4, d - 0.02, 7.0, 8.46, d + 0.02, P.shadeInk, FX_PLAIN, 0, ink);
      for (let i = 0; i < 4; i++) {
        const x = -4.5 + i * 3;
        b.add(T.octa, x, 7.7, -d, 0.6, 0.9, 0.6, i, B.glow[(i + k * 2) % B.glow.length], FX_GLOW, 0, ink);
      }
    }
  }
}

// Freight Yard: rusty sidings, silos, chimney stacks with pipe racks, warehouses and a gantry
// crane over the track every ~300 m.
function freightYard(X) {
  const { b, T, P, B, r, c, d0, d1, ink, tun } = X;
  const G = -2.6;
  let stacks = 0;
  for (const side of [-1, 1]) {
    ground(X, side, 80, G, B.ground);
    // pipe rack along the parapet: posts and two long pipes
    for (let d = d0 + 4; d < d1 - 2; d += 9) bx(b, T, side * 5.3 - 0.14, G, d - 0.14, side * 5.3 + 0.14, 1.9, d + 0.14, P.pole, FX_PLAIN, 0.02, ink);
    bx(b, T, side * 5.0, 1.3, d0, side * 5.7, 1.9, d1, B.pipe[0], FX_PLAIN, 0.04, ink);
    bx(b, T, side * 5.1, 0.3, d0, side * 5.6, 0.8, d1, B.pipe[1], FX_PLAIN, 0.04, ink);
    let d = d0 + r() * 3;
    while (d < d1 - 8) {
      const q = r();
      if (q < 0.28) {
        const len = Math.min(rr(r, 16, 28), d1 - d - 1);
        shed(X, side, 9 + r() * 1.5, G, d, len, rr(r, 9, 12), rr(r, 5, 8), pk(r, B.bld), B.roof);
        d += len + rr(r, 2, 6);
      } else if (q < 0.55) {
        const bays = 1 + Math.floor(r() * 2.6); const lv = 1 + Math.floor(r() * 3);
        containers(X, side, 8.5 + r() * 2, G, d, bays, lv, B.cont);
        d += bays * 12 + rr(r, 1, 4);
      } else if (q < 0.8 && !tun) {
        // silo cluster
        const n = 2 + Math.floor(r() * 2); const x = side * rr(r, 11, 13);
        for (let k = 0; k < n; k++) {
          const h = rr(r, 11, 17); const rad = 3.2;
          const dd = d + 3.4 + k * 6.6;
          const col = pk(r, B.silo);
          b.add(T.cyl, x, G + h / 2, -dd, rad * 2, h, rad * 2, 0, col, FX_PLAIN, 0.07, ink);
          b.add(T.cone, x, G + h + 1.3, -dd, rad * 2.1, 2.6, rad * 2.1, 0, mix(col, P.ink, 0.2), FX_PLAIN, 0.06, ink);
          bx(b, T, x - side * rad - 0.12, G, dd - 0.12, x - side * rad + 0.12, G + h, dd + 0.12, P.pole, FX_PLAIN, 0.0, ink);
        }
        bx(b, T, x - 0.35, G + 13, d + 3.4, x + 0.35, G + 13.5, d + 3.4 + (n - 1) * 6.6, P.pole, FX_PLAIN, 0.02, ink);
        d += n * 6.6 + 3 + rr(r, 1, 4);
      } else if (!tun && stacks < 1) {
        // chimney stack: banded
        stacks++;
        const x = side * rr(r, 11, 14); const dd = d + 3;
        const hs = 7.5;
        for (let k = 0; k < 4; k++) {
          const rad = 1.7 - k * 0.2;
          b.add(T.cyl6, x, G + k * hs + hs / 2, -dd, rad * 2, hs, rad * 2, 0, B.band[k % 2], FX_PLAIN, 0.06, ink);
        }
        b.add(T.octa, x + side * 1.2, G + 4 * hs + 2.2, -dd, 4, 3, 4, 0.4, mix(P.white, P.muted, 0.2), FX_PLAIN, 0.04, ink);
        d += 8;
      } else d += rr(r, 6, 10);
    }
    mast(X, side * 6.6, G, d0 + 35 + r() * 35, 9);
    backRow(X, side, 22, 30, G, G + 7, G + 12, B.bld, 14, 26, B.roof);
  }
  if (!tun && c.zi === 2) {
    const dm = (d0 + d1) / 2;
    const col = B.crane;
    for (const sd of [-1, 1]) {
      bx(b, T, sd * 8.2 - 0.5, G, dm - 3.2, sd * 8.2 + 0.5, 12.0, dm - 2.2, col, FX_PLAIN, 0.06, ink);
      bx(b, T, sd * 8.2 - 0.5, G, dm + 2.2, sd * 8.2 + 0.5, 12.0, dm + 3.2, col, FX_PLAIN, 0.06, ink);
    }
    bx(b, T, -9.2, 12.0, dm - 3.2, 9.2, 13.2, dm + 3.2, col, FX_PLAIN, 0.06, ink);
    stripes(b, T, 5.8, 3, 8.2, 11, -(dm - 3.3), mix(col, P.ink, 0.3), 2);
    stripes(b, T, -8.2, 3, -5.8, 11, -(dm - 3.3), mix(col, P.ink, 0.3), 2);
    bx(b, T, -1.5, 13.2, dm - 1.4, 1.5, 14.8, dm + 1.4, P.white, FX_PLAIN, 0.05, ink);
    qz(b, T, 0, 14.0, dm - 1.42, 2.2, 0.8, P.glass, FX_PLAIN);
  }
}

/** Scenery for district >= 1 (replaces the building rows of Downtown). */
export function bioScenery(X) {
  switch (X.c.bio) {
    case 1: harbour(X); break;
    case 2: greenway(X); break;
    case 3: oldTown(X); break;
    case 4: neonMarket(X); break;
    case 5: freightYard(X); break;
    default: break;
  }
}
