// Santee map: small 2D geometry helpers (x = east, z = south, metres). No engine imports.

/** Deterministic PRNG for the map's data layout (mulberry32). kit.seeded is used for visuals. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, v) => { const t = clamp((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** Squared distance from p to segment ab, and the segment parameter. */
export function segD2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return qx * qx + qz * qz;
}

export function polyLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** Point + unit tangent at arc length s along a polyline. */
export function along(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1], bx = pts[i][0], bz = pts[i][1];
    const l = Math.hypot(bx - ax, bz - az);
    if (acc + l >= s || i === pts.length - 1) {
      const t = l > 0 ? clamp((s - acc) / l, 0, 1) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx: (bx - ax) / (l || 1), tz: (bz - az) / (l || 1) };
    }
    acc += l;
  }
  const p = pts[0];
  return { x: p[0], z: p[1], tx: 1, tz: 0 };
}

/** Resample a polyline every `step` metres (keeps the end point). */
export function resample(pts, step) {
  const L = polyLen(pts);
  const n = Math.max(1, Math.round(L / step));
  const out = [];
  for (let i = 0; i <= n; i++) { const a = along(pts, (L * i) / n); out.push([a.x, a.z]); }
  return out;
}

/** Catmull-Rom smoothing (like an engine would do), sampled every ~step metres. */
export function smoothLine(pts, step = 6, closed = false) {
  if (pts.length < 3) return resample(pts, step);
  const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const l = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(l / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(closed ? [pts[0][0], pts[0][1]] : [pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

/** Point in polygon (even-odd). */
export function pip(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polyBox(poly) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, z0, x1, z1 };
}

export function ellipse(cx, cz, rx, rz, n = 16, rot = 0, wob = 0, rnd = null) {
  const out = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rnd ? (rnd() - 0.5) * wob : 0);
    const x = Math.cos(a) * rx * k, z = Math.sin(a) * rz * k;
    out.push([cx + x * c - z * s, cz + x * s + z * c]);
  }
  return out;
}

/** Oriented rectangle as a polygon. rot follows THREE's rotation.y: local +x maps to (cos, -sin). */
export function rectPoly(x, z, w, d, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const ux = c, uz = -s, vx = s, vz = c; // local x axis, local z axis
  const hw = w / 2, hd = d / 2;
  return [
    [x - ux * hw - vx * hd, z - uz * hw - vz * hd],
    [x + ux * hw - vx * hd, z + uz * hw - vz * hd],
    [x + ux * hw + vx * hd, z + uz * hw + vz * hd],
    [x - ux * hw + vx * hd, z - uz * hw + vz * hd],
  ];
}

/** Ribbon polygon around a polyline (for sand / lots along a line). */
export function ribbon(pts, half) {
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const h = typeof half === 'function' ? half(i) : half;
    L.push([pts[i][0] + tz * h, pts[i][1] - tx * h]);
    R.push([pts[i][0] - tz * h, pts[i][1] + tx * h]);
  }
  return L.concat(R.reverse());
}

/** Separating-axis overlap of two oriented boxes {x,z,w,d,rot}, with padding. Allocation-free. */
export function obbHit(a, b, pad = 0) {
  const ca = Math.cos(a.rot || 0), sa = Math.sin(a.rot || 0), cb = Math.cos(b.rot || 0), sb = Math.sin(b.rot || 0);
  const aw = a.w / 2 + pad / 2, ad = a.d / 2 + pad / 2, bw = b.w / 2 + pad / 2, bd = b.d / 2 + pad / 2;
  const dx = b.x - a.x, dz = b.z - a.z;
  // box axes: u = (c, -s), v = (s, c)
  const test = (ax, az) => {
    const ra = Math.abs((ca * ax - sa * az) * aw) + Math.abs((sa * ax + ca * az) * ad);
    const rb = Math.abs((cb * ax - sb * az) * bw) + Math.abs((sb * ax + cb * az) * bd);
    return Math.abs(dx * ax + dz * az) <= ra + rb;
  };
  return test(ca, -sa) && test(sa, ca) && test(cb, -sb) && test(sb, cb);
}

/** Uniform-grid hash of items with an AABB. */
export class Grid {
  constructor(cell = 40) { this.cell = cell; this.m = new Map(); }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  add(item, x0, z0, x1, z1) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++)
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = this.key(i, j);
        let a = this.m.get(k); if (!a) this.m.set(k, (a = []));
        a.push(item);
      }
  }
  query(x0, z0, x1, z1, fn) {
    const c = this.cell, stamp = (this.stamp = (this.stamp || 0) + 1);
    const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c), j0 = Math.floor(z0 / c), j1 = Math.floor(z1 / c);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const a = this.m.get(this.key(i, j)); if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const it = a[k];
          if (it.__q === stamp) continue;
          it.__q = stamp;
          if (fn(it) === false) return;
        }
      }
  }
}

/** Compass bearing (deg, 0 = north, 90 = east) of a direction in map space (north = -z). */
export const bearing = (dx, dz) => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
/** Yaw for a heading: THREE-style rotation.y where yaw 0 faces +z. */
export const yawOf = (dx, dz) => Math.atan2(dx, dz);
