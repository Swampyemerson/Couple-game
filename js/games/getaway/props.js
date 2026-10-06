// Getaway props: the engine draws every solid that the map didn't (`drawn` not set). Small
// breakables (trees, lamps, signals, hydrants…) are written into the chunk's merged geometry with
// their vertex range recorded, so a knock-over collapses them there and spawns a falling copy.
// drawProp(b, s, y0, P) writes one solid at its world position into Builder b.
import { FX_GLOW, FX_WINDOWS, cssRGB, mix } from './gfx.js';

const C = {
  bark: [0.45, 0.32, 0.22], darkBark: [0.33, 0.24, 0.17], leaf: [0.36, 0.6, 0.3], leafLight: [0.52, 0.72, 0.34],
  pineLeaf: [0.18, 0.42, 0.3], aspenLeaf: [0.72, 0.78, 0.3], aspenBark: [0.92, 0.9, 0.84], palmLeaf: [0.3, 0.62, 0.32],
  jacaranda: [0.6, 0.45, 0.85], metal: [0.42, 0.44, 0.48], lampGlow: [1, 0.9, 0.6], yellow: [0.98, 0.8, 0.2],
  red: [0.86, 0.2, 0.2], green: [0.2, 0.75, 0.35], amber: [1, 0.66, 0.15], wood: [0.5, 0.36, 0.24],
  signGreen: [0.12, 0.5, 0.32], white: [0.96, 0.96, 0.94], blue: [0.2, 0.32, 0.66], cactus: [0.36, 0.58, 0.32],
  shrub: [0.34, 0.55, 0.3], rock: [0.6, 0.56, 0.52], concrete: [0.78, 0.76, 0.72],
};
export const STYLE_H = { cottonwood: 13, pine: 12, aspen: 9, palm: 13, jacaranda: 8, tree: 9, lamp: 8, signal: 6.5, bollard: 1, hydrant: 0.9, pole: 10, sign: 3, mailbox: 1.3, cactus: 3.2, shrub: 1.3 };

export function styleOf(s) {
  const st = s.style;
  if (st && STYLE_H[st]) return st;
  switch (s.kind) {
    case 'tree': return 'tree';
    case 'bollard': return 'bollard';
    case 'hydrant': return 'hydrant';
    case 'lamp': return 'lamp';
    case 'signal': return 'signal';
    case 'sign': return 'sign';
    case 'mailbox': return 'mailbox';
    case 'cactus': return 'cactus';
    case 'shrub': return 'shrub';
    default: return 'pole';
  }
}

/** Write solid s standing at ground y0 into builder b (world coordinates). Returns nothing. */
export function drawProp(b, s, y0, P, ox = s.x, oz = s.z, rot = s.rot) {
  const st = s.breakable ? styleOf(s) : null;
  const tint = s.color ? cssRGB(s.color) : null;
  const ol = 0.06;
  const dark = P.dark;
  const lit = (c) => (dark ? mix(c, [1, 0.95, 0.75], 0.2) : c);
  if (!st) return drawBlock(b, s, y0, P, tint);
  const h = Number.isFinite(s.hRaw) ? s.hRaw : (STYLE_H[st] || 6);
  const x = ox; const z = oz;
  switch (st) {
    case 'cottonwood': case 'tree': case 'jacaranda': {
      const leaf = tint || (st === 'jacaranda' ? C.jacaranda : st === 'cottonwood' ? C.leafLight : C.leaf);
      const tr = st === 'cottonwood' ? 0.32 : 0.24;
      b.cyl(x, y0, z, tr, h * 0.5, C.bark, ol, 0, true);
      const r = h * (st === 'cottonwood' ? 0.3 : 0.28);
      b.sphere(x, y0 + h * 0.62, z, r, leaf, ol, 0, 0.85);
      b.sphere(x + r * 0.55, y0 + h * 0.5, z + r * 0.2, r * 0.68, mix(leaf, [0, 0, 0], 0.08), ol, 0, 0.85);
      b.sphere(x - r * 0.45, y0 + h * 0.52, z - r * 0.35, r * 0.62, mix(leaf, [1, 1, 1], 0.08), ol, 0, 0.85);
      break;
    }
    case 'pine': {
      const leaf = tint || C.pineLeaf;
      b.cyl(x, y0, z, 0.22, h * 0.3, C.darkBark, ol, 0, true);
      b.cone(x, y0 + h * 0.18, z, h * 0.23, h * 0.42, leaf, ol);
      b.cone(x, y0 + h * 0.42, z, h * 0.18, h * 0.36, mix(leaf, [1, 1, 1], 0.06), ol);
      b.cone(x, y0 + h * 0.64, z, h * 0.12, h * 0.36, mix(leaf, [1, 1, 1], 0.12), ol);
      break;
    }
    case 'aspen': {
      const leaf = tint || C.aspenLeaf;
      b.cyl(x, y0, z, 0.15, h * 0.62, C.aspenBark, ol, 0, true);
      b.sphere(x, y0 + h * 0.66, z, h * 0.17, leaf, ol, 0, 1.7);
      break;
    }
    case 'palm': {
      const leaf = tint || C.palmLeaf;
      // a gently leaning trunk in three pieces
      for (let k = 0; k < 3; k++) b.cyl(x + k * 0.12, y0 + (h * k) / 3, z, 0.2 - k * 0.025, h / 3 + 0.05, C.wood, ol, 0, true);
      const tx = x + 0.36; const ty = y0 + h;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.3;
        b.add(b.T.wedge, tx + Math.sin(a) * 1.5, ty - 0.35, z + Math.cos(a) * 1.5, 0.7, 0.5, 3.2, a, mix(leaf, [0, 0, 0], (k % 2) * 0.1), ol);
      }
      b.sphere(tx, ty, z, 0.45, mix(leaf, [0, 0, 0], 0.25), 0);
      break;
    }
    case 'lamp': {
      const c = tint || C.metal;
      b.cyl(x, y0, z, 0.12, h, c, ol, 0, true);
      // arm towards the street (local −x after rot)
      const ax = -Math.cos(rot); const az = Math.sin(rot);
      b.add(b.T.box, x + ax * 0.9, y0 + h - 0.1, z + az * 0.9, 1.9, 0.14, 0.14, rot, c, ol);
      b.add(b.T.box, x + ax * 1.7, y0 + h - 0.25, z + az * 1.7, 0.7, 0.18, 0.36, rot, lit(C.lampGlow), 0.04, FX_GLOW);
      break;
    }
    case 'signal': {
      const c = tint || [0.3, 0.32, 0.34];
      b.cyl(x, y0, z, 0.14, h, c, ol, 0, true);
      const ax = -Math.cos(rot); const az = Math.sin(rot);
      b.add(b.T.box, x + ax * 2.4, y0 + h - 0.15, z + az * 2.4, 4.8, 0.16, 0.16, rot, c, ol);
      const hx = x + ax * 4.2; const hz = z + az * 4.2;
      b.add(b.T.box, hx, y0 + h - 1.0, hz, 0.42, 1.35, 0.42, rot, C.yellow, ol);
      const fx = Math.sin(rot) * 0.22; const fz = Math.cos(rot) * 0.22;
      b.add(b.T.box, hx + fx, y0 + h - 0.6, hz + fz, 0.24, 0.24, 0.06, rot, C.red, 0, FX_GLOW);
      b.add(b.T.box, hx + fx, y0 + h - 1.0, hz + fz, 0.24, 0.24, 0.06, rot, C.amber, 0, dark ? FX_GLOW : 0);
      b.add(b.T.box, hx + fx, y0 + h - 1.4, hz + fz, 0.24, 0.24, 0.06, rot, C.green, 0, FX_GLOW);
      break;
    }
    case 'bollard': {
      b.cyl(x, y0, z, 0.16, 0.95, tint || C.yellow, 0.04);
      b.cyl(x, y0 + 0.55, z, 0.165, 0.16, P.outline, 0);
      break;
    }
    case 'hydrant': {
      const c = tint || C.red;
      b.cyl(x, y0, z, 0.2, 0.62, c, 0.04);
      b.sphere(x, y0 + 0.66, z, 0.2, c, 0.04);
      b.add(b.T.box, x, y0 + 0.42, z, 0.62, 0.14, 0.14, rot, c, 0.03);
      break;
    }
    case 'pole': {
      b.cyl(x, y0, z, 0.15, h, tint || C.wood, ol, 0, true);
      b.add(b.T.box, x, y0 + h - 0.8, z, 2.4, 0.16, 0.16, rot, tint || C.wood, ol);
      break;
    }
    case 'sign': {
      b.cyl(x, y0, z, 0.06, h, C.metal, 0.03, 0, true);
      b.add(b.T.box, x, y0 + h - 0.4, z, 0.9, 0.7, 0.06, rot, tint || C.signGreen, 0.04);
      break;
    }
    case 'mailbox': {
      b.add(b.T.box, x, y0 + 0.5, z, 0.12, 1.0, 0.12, rot, C.wood, 0.03);
      b.add(b.T.box, x, y0 + 1.1, z, 0.4, 0.4, 0.6, rot, tint || C.blue, 0.04);
      break;
    }
    case 'cactus': {
      const c = tint || C.cactus;
      b.cyl(x, y0, z, 0.32, h, c, ol, 0, true);
      b.cyl(x + 0.62, y0 + h * 0.35, z, 0.2, h * 0.38, c, ol, 0, true);
      b.add(b.T.box, x + 0.38, y0 + h * 0.36, z, 0.5, 0.28, 0.28, 0, c, 0);
      b.cyl(x - 0.58, y0 + h * 0.5, z, 0.18, h * 0.3, c, ol, 0, true);
      b.add(b.T.box, x - 0.36, y0 + h * 0.52, z, 0.46, 0.26, 0.26, 0, c, 0);
      break;
    }
    case 'shrub': {
      const c = tint || C.shrub; const r = Math.max(0.6, Math.min(2.2, (s.hw + s.hd) * 0.6));
      b.sphere(x, y0 + r * 0.55, z, r, c, ol, 0, 0.7);
      b.sphere(x + r * 0.6, y0 + r * 0.4, z + r * 0.2, r * 0.65, mix(c, [1, 1, 1], 0.1), ol, 0, 0.7);
      break;
    }
    default:
      b.cyl(x, y0, z, 0.15, h, tint || C.metal, ol, 0, true);
  }
}

function drawBlock(b, s, y0, P, tint) {
  const w = s.hw * 2; const d = s.hd * 2; const h = s.h;
  const yb = s.y != null ? s.y : y0;
  switch (s.kind) {
    case 'building': {
      const c = tint || mix(P.card, [0.75, 0.6, 0.5], 0.4);
      b.add(b.T.box, s.x, yb + h / 2 - 0.5, s.z, w, h + 1, d, s.rot, c, 0.12, FX_WINDOWS);
      b.add(b.T.box, s.x, yb + h + 0.15, s.z, w + 0.4, 0.3, d + 0.4, s.rot, mix(c, [0, 0, 0], 0.25), 0.08);
      break;
    }
    case 'rock':
      b.add(b.T.ico, s.x, yb + h * 0.4, s.z, w * 1.1, h * 1.1, d * 1.1, s.rot, tint || C.rock, 0.08);
      break;
    case 'barrier':
      b.add(b.T.box, s.x, yb + Math.min(h, 1.1) / 2, s.z, w, Math.min(h, 1.1), d, s.rot, tint || C.concrete, 0.05);
      break;
    default: // wall and anything else
      b.add(b.T.box, s.x, yb + h / 2 - 0.3, s.z, w, h + 0.3, d, s.rot, tint || mix(P.card, P.ink, 0.15), 0.06);
  }
}
